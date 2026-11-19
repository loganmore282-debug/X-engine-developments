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
3. A MongoDB database and its connection string (see "MongoDB" below).
4. Your Claude API key (console.anthropic.com).

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

Then fill in the two things only you have:

```bash
nano /etc/shule-notes/.env      # set MONGODB_URI and ANTHROPIC_API_KEY
systemctl start shule-notes
curl https://api.yourdomain.com/health     # should answer {"status":"success",...}
```

Open `https://admin.yourdomain.com`, sign in with the admin key, then:
**Subjects → Add Uganda's standard subjects**, upload notes, fill in **Settings**
(support phone and the daily AI limit).

## MongoDB

- **Atlas** (what the project assumed): create a cluster, a database user, and allow the
  VPS's IP under *Network Access*. Use the connection string with the database name at the
  end: `mongodb+srv://USER:PASS@cluster.mongodb.net/shule_notes?retryWrites=true&w=majority`.
  The free M0 tier has **no backups**, so install the backup script below.
- **On the same VPS**: fine for one school-sized app; install MongoDB 7 from MongoDB's own
  apt repository, bind it to `127.0.0.1` only, turn on authentication, and use
  `mongodb://USER:PASS@127.0.0.1:27017/shule_notes?authSource=admin`. Never open port 27017
  to the internet.

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
