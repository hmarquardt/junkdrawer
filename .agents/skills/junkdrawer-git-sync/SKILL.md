---
name: junkdrawer-git-sync
description: Synchronize a Junkdrawer checkout with origin/main before starting work, while editing, and immediately before pushing. Use at the start of a development session, before any push, when a push is rejected as non-fast-forward, or whenever it is unclear whether the checkout is current — origin/main can advance without any local activity because the Overhead data workflow commits to it. Includes scripts/git-sync.sh (check / sync / pre-push / verify).
---

# Git Synchronization

`origin/main` is shared. The Overhead data workflow (`.github/workflows/overhead-data.yml`) commits
`data/overhead/*.json` and re-pins `tests/fixtures/overhead/horizons-comets.json` on its own schedule,
so a checkout can fall behind while nobody is looking. The canonical policy is the
**Git Synchronization** section of `AGENTS.md`; this skill is the executable part of it.

## Helper

From anywhere inside the repository:

```bash
.agents/skills/junkdrawer-git-sync/scripts/git-sync.sh check      # report state (fetches first)
.agents/skills/junkdrawer-git-sync/scripts/git-sync.sh sync       # fast-forward when unambiguously safe
.agents/skills/junkdrawer-git-sync/scripts/git-sync.sh pre-push   # gate a push
.agents/skills/junkdrawer-git-sync/scripts/git-sync.sh verify     # does origin/main have HEAD?
```

| Command | Does | Exit codes |
|---|---|---|
| `check` | fetches, then reports branch, upstream, ahead/behind, incoming commits, local commits not yet pushed, modified tracked files and untracked files | `0` synchronized, `1` behind/diverged/no upstream, `3` fetch failed |
| `sync` | fetches, then `git merge --ff-only` — only when there is nothing local to lose and the working tree has no tracked modifications (or `--allow-dirty` was given) | `0` synchronized, `1` refused (dirty, diverged, or git refused), `3` fetch failed |
| `pre-push` | fetches, then answers "is the outgoing history built on top of `origin/main`?"; fast-forwards only when no local commit is ahead | `0` safe to push, `1` do not push, `3` cannot verify |
| `verify [rev]` | fetches, then checks whether `origin/main` contains `rev` (default `HEAD`) | `0` contained, `1` not contained, `2` bad revision, `3` fetch failed |

Flags: `--remote NAME` (defaults to the upstream's remote), `check --no-fetch` (offline, reports that
the state is unverified), `sync --allow-dirty` (lets git try the fast-forward; git still refuses
rather than overwrite local work).

## Session workflow

1. **Start:** `git-sync.sh check`. If it says *behind*, run `git-sync.sh sync`. If it says *diverged*
   or *dirty*, reconcile deliberately — never reset, clean, stash or force.
2. **During:** keep editing. Do not pull in the middle of a change; if a fetch shows new commits,
   integrate them at a checkpoint (`git-sync.sh sync` when nothing local is at risk).
3. **Before pushing:** `git-sync.sh pre-push`, then commit, then push, then `git-sync.sh verify`.
   A non-fast-forward rejection means the remote moved: run `check`, reconcile, and push again.

## Safety contract

The helper never runs `push`, `reset`, `clean`, `stash`, `checkout`, `rebase` or a forced update, and
never deletes untracked files. `sync` and `pre-push` are the only commands that change anything, and
only by fast-forwarding. When it cannot decide, it prints diagnostics and exits non-zero.

## Optional pre-push hook

Hooks are not active merely because their files are committed, so this is opt-in. If you want the
gate enforced locally, run this once per clone:

```bash
ln -sf ../../.agents/skills/junkdrawer-git-sync/scripts/git-sync.sh .git/hooks/pre-push
```

A failed fetch inside the hook blocks the push (exit 3) rather than claiming the repository is
synchronized; remove the symlink to disable it.

## Verification

```bash
bash tests/git-sync.sh          # 11 scenarios in disposable repos: fast-forward, dirty tree,
                                # divergence, automated data commit, rejected push, fetch failure,
                                # untracked preservation, collisions, missing upstream, usage, verify
```
