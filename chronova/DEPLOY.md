# Chronova — auto-deploy (no more manual uploads)

Both sites are static folders that are **built and committed on every push**, so
EdgeOne only has to publish a subfolder. Set each project once with the values
below; after that, every `git push` redeploys both sites automatically.

## Connect both EdgeOne projects to the same repo + branch

- Repository: `loganmore282-debug/X-engine-developments`
- Production branch: **`claude/voltra-session-continue-mk95gw`**

(Every project can watch the same repo and branch — each one publishes its own
subfolder, set below.)

## Project A — User app  →  chronovaplatformx.edgeone.dev

Project Settings → Build Deployment Configuration → **Edit**:

| Field                   | Value        |
| ----------------------- | ------------ |
| Preset framework        | **Other** (None / Static) |
| Root directory          | `chronova`   |
| Build output directory  | `dist`       |
| Install command         | *(leave empty)* |
| Compile / build command | *(leave empty)* |

## Project B — Admin  →  chnadm.edgeone.dev

Same repo and branch, its own Build Deployment Configuration:

| Field                   | Value          |
| ----------------------- | -------------- |
| Preset framework        | **Other** (None / Static) |
| Root directory          | `chronova`     |
| Build output directory  | `admin-dist`   |
| Install command         | *(leave empty)* |
| Compile / build command | *(leave empty)* |

That is the whole setup. There is no build step for EdgeOne to run — `dist/` and
`admin-dist/` are already the finished sites, refreshed on every push.

## What still deploys separately

- **Backend (`server.js`)** is not an EdgeOne site. It runs on Render and
  deploys from Render's own Git integration. If Render is connected to this repo
  and branch it also auto-deploys on push; otherwise it is the one file that
  still needs a manual redeploy there.

## If EdgeOne refuses an empty build command

Some setups insist on a command. Use a no-op:

- Build / compile command: `echo "prebuilt, nothing to build"`
- Everything else exactly as above.

## Cache note

The service worker cache version (`chronova/sw.js` → `chronova-shell-vN`) is
bumped on every change, so phones pull the fresh build after a deploy. Fully
close and reopen the app once after a deploy if an old screen lingers.
