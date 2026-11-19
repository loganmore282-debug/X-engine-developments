# Putting Shule Notes live on a Contabo VPS

What you end up with:

```
students' phones ──► https://api.yourdomain.com   (nginx ──► the Node server, port 4000, this machine only)
you, in a browser ─► https://admin.yourdomain.com  (nginx serves the admin page)
                     MongoDB (Atlas, or on the same VPS)     PDFs on the VPS disk: /var/lib/shule-notes/uploads
```

## Before you start

1. A Contabo VPS with **Ubuntu 22.04 or 24.04**, and its IP address.
2. A domain name. Add two **A records** pointing at the VPS IP: `api` and `admin`
   (for example `api.shulenotes.com` and `admin.shulenotes.com`). Wait a few minutes.
3. MongoDB: nothing to prepare for the on-the-VPS option; for Atlas, see "MongoDB" below.
4. Your Claude API key (console.anthropic.com).

## No domain yet?

You can start without one. Run the script with `--no-domain` and it builds two free
addresses from the server's IP (for example `api.203-0-113-5.sslip.io`), with real HTTPS
certificates, so you can test everything: the admin panel, the app, uploads.

```bash
./setup.sh --no-domain you@email.com
```

Two things to know:
- **Buy a domain before you publish the app on Google Play.** The address is built into
  the app, so changing it later means every student has to update. A `.com` costs roughly
  the price of a lunch per year at Namecheap, Porkbun or Cloudflare. Then add two A records
  (`api` and `admin`) pointing at the VPS IP and run `./setup.sh api.yourdomain.com
  admin.yourdomain.com you@email.com` again; it switches the server over and keeps your data.
- Google Play also asks for a privacy-policy link. The one the server provides
  (`https://api.../privacy`) should be on your permanent address, which is another reason
  to get the domain first.

## Setup (about 5 minutes)

On the VPS, as root (Contabo gives you the root login by email):

```bash
apt-get update && apt-get install -y git
git clone https://github.com/loganmore282-debug/X-engine-developments.git
cd X-engine-developments
git checkout claude/space8-rename-frontend-rebuild-juurd7
cd shule-notes/deploy
./setup.sh api.yourdomain.com admin.yourdomain.com you@yourdomain.com
```

The script installs Node 20, nginx and certificates, creates a locked-down service
user, opens only SSH, HTTP and HTTPS, and writes `/etc/shule-notes/.env` with a freshly
generated admin key (it prints it once, so write it down).

Next, set up MongoDB (next section), then add your Claude key and start the server:

```bash
nano /etc/shule-notes/.env      # ANTHROPIC_API_KEY (and MONGODB_URI if you use Atlas)
systemctl start shule-notes
curl https://api.yourdomain.com/health     # should answer {"status":"success",...}
```

Open `https://admin.yourdomain.com`, sign in with the admin key, then:
**Subjects → Add Uganda's standard subjects**, upload notes, fill in **Settings**
(support phone and the daily AI limit).

## MongoDB

### Option A: on the same VPS (recommended here, nothing extra to pay for)

After `setup.sh`, run:

```bash
cd X-engine-developments/shule-notes/deploy/mongodb
sudo ./setup-mongodb.sh
```

It installs MongoDB 8.0, locks it so only this machine can reach it (127.0.0.1, port 27017
is not opened in the firewall) and requires a login, creates a `shule_app` user that can
only touch the `shule_notes` database, and writes the connection string into
`/etc/shule-notes/.env` for you. The passwords are generated and saved in
`/root/shule-mongodb-credentials.txt` (also holds a full-control `shule_root` login for you,
for example `mongosh "mongodb://shule_root:...@127.0.0.1:27017/admin"`).
Settings are in `mongodb/mongod.conf`; its memory cache is capped at 1 GB, so raise
`cacheSizeGB` if your VPS has plenty of RAM (about a quarter of it is a good value).

Then add your Claude key and start the app:

```bash
sudo nano /etc/shule-notes/.env        # ANTHROPIC_API_KEY=...
sudo systemctl start shule-notes
curl https://api.yourdomain.com/health
```

Install the nightly backup (`backup.sh`, top of the file) so the database and the PDFs are
copied every night. To restore a database backup:
`mongorestore --uri "<shule_root connection string>" --gzip --archive=/var/backups/shule-notes/mongo-YYYY-MM-DD.archive.gz --drop`

### Option B: MongoDB Atlas (hosted by MongoDB)

1. Create a free account and a cluster (M0 is free; it has **no backups**, so keep `backup.sh`).
2. *Database Access* → add a user with *Read and write to any database*.
3. *Network Access* → add the VPS's IP address (not "allow from anywhere").
4. *Connect → Drivers* → copy the string and add the database name before the `?`:
   `mongodb+srv://USER:PASS@cluster.mongodb.net/shule_notes?retryWrites=true&w=majority`
5. Put it on the `MONGODB_URI=` line of `/etc/shule-notes/.env`, then `systemctl start shule-notes`.
   (If the password has special characters such as `@` or `/`, URL-encode them.)

Either way the app creates its own collections and indexes the first time it starts.

## Later

| Task | Command |
|---|---|
| Put new code live | `cd X-engine-developments && git pull && cd shule-notes/deploy && ./update.sh api.yourdomain.com` |
| See what the server is doing | `journalctl -u shule-notes -f` |
| Restart | `systemctl restart shule-notes` |
| Change a setting in `.env` | edit `/etc/shule-notes/.env`, then restart |
| Nightly backup of PDFs and database | see the top of `backup.sh` |

## The Android app

In `android/app/build.gradle.kts`, set the release `API_BASE_URL` to
`https://api.yourdomain.com/`, build the signed bundle in Android Studio, and upload it to
Google Play. The privacy and terms pages the Play Console asks for are already served at
`https://api.yourdomain.com/privacy`, `/terms` and `/account-deletion`.

## Good to know

- The Node server listens on `127.0.0.1` only; the firewall blocks everything but SSH and web
  traffic. nginx passes each visitor's real address through, so the sign-in rate limit counts
  every student separately.
- PDFs live on the VPS disk. Contabo's disk is persistent, but not a backup: use `backup.sh`,
  and consider Contabo's snapshot feature too.
- Keep the admin key long and private. Anyone holding it can delete every note and student.
