# Chronova — auto-deploy (no more manual uploads)

Both sites are static folders that are **built and committed on every push**, so
EdgeOne only has to publish a subfolder. Set each project once with the values
below; after that, every `git push` redeploys both sites automatically.

## First, make this branch the default (one-time, fixes "stuck on Production")

EdgeOne's **Production** environment deploys from the repository's **default
branch**. Right now that default is an old branch with none of the Chronova
work, which is why Production looks stuck/stale.

Point it at our branch in whichever way your console allows:

- **Preferred — set the GitHub default branch.** GitHub → the repo → Settings →
  Branches → change the default branch to
  **`claude/voltra-session-continue-mk95gw`**. EdgeOne Production and Render then
  track it automatically. Nothing else to pick.
- **Or — choose the branch inside EdgeOne.** Project Settings → Git Management /
  Build Deployment Configuration → set the deploy branch to
  `claude/voltra-session-continue-mk95gw`.

The **Edit environment** dialog (name / domain / variables) is *not* where the
branch lives — the greyed-out "Production" name is normal; just close it.

## Connect both EdgeOne projects to the same repo + branch

- Repository: `loganmore282-debug/X-engine-developments`
- Branch: **`claude/voltra-session-continue-mk95gw`** (as the default, per above)

(Every project watches the same repo and branch — each publishes its own
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
  deploys from Render's own Git integration. In the Render service → Settings,
  set the deploy branch to **`claude/voltra-session-continue-mk95gw`** (same
  branch) and enable Auto-Deploy. Then a push updates the backend too; otherwise
  `server.js` is the one file that still needs a manual redeploy there.

## If EdgeOne refuses an empty build command

Some setups insist on a command. Use a no-op:

- Build / compile command: `echo "prebuilt, nothing to build"`
- Everything else exactly as above.

## Cache note

The service worker cache version (`chronova/sw.js` → `chronova-shell-vN`) is
bumped on every change, so phones pull the fresh build after a deploy. Fully
close and reopen the app once after a deploy if an old screen lingers.
