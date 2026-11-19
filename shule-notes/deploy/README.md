# Putting Shule Notes live on a Contabo VPS

What you end up with:

```
students' phones ──► https://api.yourdomain.com   (nginx ──► the Node server, port 4000, this machine only)
you, in a browser ─► https://admin.yourdomain.com  (nginx serves the admin page)
                     MongoDB (its own instance on the VPS, or Atlas)     PDFs on the VPS disk: /var/lib/shule-notes/uploads
```

## Before you start

1. A Contabo VPS with **Ubuntu 22.04 or 24.04**, and its IP address.
2. A domain name. Add two **A records** pointing at the VPS IP: `api` and `admin`
   (for example `api.shulenotes.com` and `admin.shulenotes.com`). Wait a few minutes.
3. MongoDB: nothing to prepare for the on-the-VPS option; for Atlas, see "MongoDB" below.
4. Your Claude API key (console.anthropic.com).

## This server already runs other projects

The scripts are written for exactly that: they only **add** things and never remove,
replace or reconfigure what is there.

First, look without changing anything (it only prints; you can send me the output):

```bash
sudo ./preflight.sh
```

| What the setup adds | What it never touches |
|---|---|
| a user `shule`, folders `/opt/shule-notes`, `/etc/shule-notes`, `/var/lib/shule-notes` | your other projects' folders, users, services |
| one service, `shule-notes`, on the first free port from 4000 | whatever already uses port 4000 (it picks another) |
| two new nginx files, `shule-api.conf` and `shule-admin.conf` in `/etc/nginx/conf.d` (other sites stay as they are; if nginx rejects the result, the two files are removed again and nothing is left changed) | your existing nginx sites and certificates |
| its own Node 20 inside `/opt/shule-notes/node`, only if the server has no Node 20+ | the server's Node, pm2, Docker |
| its own MongoDB: service `shule-mongod`, port 27018 (or next free), data `/var/lib/shule-mongodb`, `127.0.0.1` only | any MongoDB you already run, its data and `/etc/mongod.conf` |
| web ports in ufw **only if ufw is already active** | the firewall otherwise (never switched on or reset) |

If something else already owns port 80 or 443 (Apache, Caddy, a Docker proxy), the setup
stops before changing anything. See "Another web server is already running" below.

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

### Option A: its own MongoDB on this server (nothing extra to pay for)

After `setup.sh`:

```bash
cd X-engine-developments/shule-notes/deploy/mongodb
sudo ./setup-mongodb.sh
```

This gives Shule Notes **its own** MongoDB, separate from any you already run: its own
service (`shule-mongod`), config (`/etc/shule-mongod.conf`), data folder
(`/var/lib/shule-mongodb`) and port (27018, or the next free one). It listens on
`127.0.0.1` only, requires a login, and has a `shule_app` user that can touch only the
`shulenotesdb` database. If the server already has the `mongod` program it is used as it is
(not upgraded); otherwise only the MongoDB 8.0 server package is installed and held so a
routine `apt upgrade` never changes its version. The connection string goes into
`/etc/shule-notes/.env` for you; passwords are in `/root/shule-mongodb-credentials.txt`
together with a full-control `shule_root` login for you.
Settings: `mongodb/mongod.conf` (memory cache capped at 1 GB).

Then add your Claude key and start the app:

```bash
sudo nano /etc/shule-notes/.env        # ANTHROPIC_API_KEY=...
sudo systemctl start shule-notes
curl https://<your api address>/health
```

Install the nightly backup (`backup.sh`, top of the file); it uses `mongodump` if the
server has it (`sudo apt-get install mongodb-database-tools` adds just that tool).
To restore: `mongorestore --uri "<shule_root connection string>" --gzip --archive=/var/backups/shule-notes/mongo-YYYY-MM-DD.archive.gz --drop`

### Option B: MongoDB Atlas (hosted by MongoDB)

1. Create a free account and a cluster (M0 is free; it has **no backups**, so keep `backup.sh`).
2. *Database Access* → add a user with *Read and write to any database*.
3. *Network Access* → add the VPS's IP address (not "allow from anywhere").
4. *Connect → Drivers* → copy the string and add the database name before the `?`:
   `mongodb+srv://USER:PASS@cluster.mongodb.net/shulenotesdb?retryWrites=true&w=majority`
5. Put it on the `MONGODB_URI=` line of `/etc/shule-notes/.env`, then `systemctl start shule-notes`.
   (If the password has special characters such as `@` or `/`, URL-encode them.)

Either way the app creates its own collections and indexes the first time it starts.

## Another web server is already running

If Apache, Caddy or a Docker proxy already uses ports 80 and 443, do not stop it. Keep
the Shule Notes server running on its own port (`PORT` in `/etc/shule-notes/.env`) and add
a reverse-proxy entry for your API address in the server you already have, pointing at
`http://127.0.0.1:<PORT>` (with large uploads allowed, 55 MB, and a 120 second timeout), and
serve `/var/www/shule-admin` for the admin address. Send me what `preflight.sh` prints and
I will write the exact entry for that server.

## Later

| Task | Command |
|---|---|
| Put new code live | `cd X-engine-developments && git pull && cd shule-notes/deploy && ./update.sh api.yourdomain.com` |
| See what the server is doing | `journalctl -u shule-notes -f` (database: `journalctl -u shule-mongod`) |
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
