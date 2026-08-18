# Space8 — Project Memory (Codex entry point)

This file exists so Codex sessions have a project-memory file under the name they expect.
**The canonical, full project memory is `CLAUDE.md` in this same folder — read it in
full before doing anything else.** It covers: what Space8 is, why it's a full port of
`choco-mcc/` (not a fresh build — don't rebuild features that already exist there), the
build/verify commands, the exact rebrand mapping (colours, tier names, brand strings),
and the known gaps that are still open (product/banner art, app icons, the "Show"
upload-for-reward tab the owner asked for, which does not exist yet).

Keep `CLAUDE.md` and `CODEX.md` pointing at the same reality — if you learn something
that changes the picture in `CLAUDE.md`, update `CLAUDE.md` directly rather than forking
the truth into this file.

## Mandatory: log every fix

After every fix — no matter how small — append an entry to `AGENT_LOG.md` in this folder,
using the format shown at the top of that file. This is the mechanism that lets Claude and
Codex sessions hand off work without re-deriving context: whichever AI works on Space8
next reads `AGENT_LOG.md` first to see what the other one already did, decided, or ruled
out. An unlogged fix is, for coordination purposes, a fix that didn't happen.

## Repo / branch

Repo: `loganmore282-debug/x-engine-developments` (GitHub). This is the **same repo** as
Voltra, ChocoMCC, and the other apps under this account — Space8 lives at `space8/` in
it, same as `voltra/` and `choco-mcc/` are siblings. Current work is on branch
`claude/space8-rename-frontend-rebuild-juurd7` (check `CLAUDE.md`'s own "Repo / branch /
infra" section if this has moved on again — that file is kept current, this note can
drift). Do not touch `choco-mcc/` or `voltra/` from a Space8 task unless explicitly asked to.
