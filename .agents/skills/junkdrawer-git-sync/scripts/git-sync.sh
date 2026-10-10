#!/usr/bin/env bash
# git-sync.sh — Junkdrawer Git synchronization helper.
#
# origin/main is shared: the Overhead data workflow (.github/workflows/overhead-data.yml) commits to
# it without any local activity, so a checkout can fall behind at any moment.  This helper reports the
# state, fast-forwards when that is unambiguously safe, and gates a push on the outgoing history
# containing upstream.  Policy: see "Git Synchronization" in AGENTS.md.
#
# Usage:
#   git-sync.sh check    [--no-fetch] [--remote NAME]   # report state; exit 1 if behind/diverged
#   git-sync.sh sync     [--allow-dirty] [--remote NAME] # fast-forward only; never discards work
#   git-sync.sh pre-push [--remote NAME]                # is it safe to push right now?
#   git-sync.sh verify   [<rev>] [--remote NAME]        # does the remote contain <rev> (default HEAD)?
#
# Exit codes: 0 = ok / synchronized, 1 = needs attention, 2 = usage error,
#             3 = cannot verify (fetch failed, or not a git working tree).
#
# This script is read-only except for `sync`, which runs `git merge --ff-only` (no merge commit, and
# git itself refuses anything that would overwrite local work).  It never runs push, reset, clean,
# stash, checkout, rebase or a forced update, and it never deletes untracked files.
set -u

COMMAND=""
REMOTE=""
NO_FETCH=0
ALLOW_DIRTY=0
REV=""
FETCH_ERR=""

usage() {
  sed -n '2,20p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

cleanup() { [ -n "$FETCH_ERR" ] && rm -f "$FETCH_ERR"; }
trap cleanup EXIT

while [ $# -gt 0 ]; do
  case "$1" in
    check|sync|pre-push|verify) COMMAND="$1" ;;
    --remote) shift; REMOTE="${1:-}" ;;
    --no-fetch) NO_FETCH=1 ;;
    --allow-dirty) ALLOW_DIRTY=1 ;;
    -h|--help) usage; exit 0 ;;
    -*) echo "error: unknown option $1" >&2; usage >&2; exit 2 ;;
    *) if [ "$COMMAND" = "verify" ] && [ -z "$REV" ]; then REV="$1"
       else echo "error: unexpected argument $1" >&2; usage >&2; exit 2; fi ;;
  esac
  shift
done

if [ -z "$COMMAND" ]; then
  usage >&2
  exit 2
fi
if [ "$COMMAND" != "check" ] && [ "$NO_FETCH" = 1 ]; then
  echo "error: --no-fetch is only valid with check" >&2
  exit 2
fi
if [ "$COMMAND" != "sync" ] && [ "$ALLOW_DIRTY" = 1 ]; then
  echo "error: --allow-dirty is only valid with sync" >&2
  exit 2
fi
if [ -n "$REV" ] && [ "$COMMAND" != "verify" ]; then
  echo "error: a revision argument is only valid with verify" >&2
  exit 2
fi

say()  { printf '%s\n' "$*"; }
note() { printf '  %s\n' "$*"; }
err()  { printf 'error: %s\n' "$*" >&2; }
verdict() { say "== verdict: $* =="; }

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  err "not inside a git working tree"
  exit 3
}
cd "$REPO_ROOT" || exit 3

BRANCH="$(git symbolic-ref --quiet --short HEAD)" || BRANCH=""
if [ -z "$BRANCH" ]; then
  err "HEAD is detached — no branch to synchronize"
  note "check out a branch first (e.g. git switch main); this helper never changes HEAD for you" >&2
  exit 1
fi

UPSTREAM="$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null)" || UPSTREAM=""
if [ -z "$UPSTREAM" ]; then
  say "== git synchronization: $REPO_ROOT =="
  note "branch        $BRANCH"
  note "upstream      (none configured)"
  err "cannot confirm synchronization: $BRANCH has no upstream branch"
  note "set one with: git branch --set-upstream-to=origin/$BRANCH $BRANCH" >&2
  exit 1
fi

REMOTE_NAME="$REMOTE"
if [ -z "$REMOTE_NAME" ]; then
  case "$UPSTREAM" in
    */*) REMOTE_NAME="${UPSTREAM%%/*}" ;;
    *) REMOTE_NAME="origin" ;;
  esac
fi

if [ "$NO_FETCH" = 1 ]; then
  FETCH_STATE="not fetched (--no-fetch: state may be stale)"
else
  FETCH_ERR="$(mktemp)"
  if git fetch --quiet "$REMOTE_NAME" 2>"$FETCH_ERR"; then
    FETCH_STATE="fetched just now from $REMOTE_NAME"
  else
    err "git fetch $REMOTE_NAME failed:"
    sed 's/^/  /' "$FETCH_ERR" >&2
    err "cannot confirm synchronization with $UPSTREAM"
    note "retry the fetch; if the network is unavailable, treat the local remote refs as unverified" >&2
    exit 3
  fi
fi

COUNTS="$(git rev-list --left-right --count "HEAD...$UPSTREAM")"
AHEAD="$(printf '%s' "$COUNTS" | awk '{print $1}')"
BEHIND="$(printf '%s' "$COUNTS" | awk '{print $2}')"

TRACKED_CHANGES="$(git status --porcelain --untracked-files=no | wc -l | tr -d ' ')"
UNTRACKED_CHANGES="$(git status --porcelain --untracked-files=all | grep -c '^??' || true)"

list_paths() {   # $1 = porcelain grep prefix, $2 = limit
  local lines count shown
  lines="$(git status --porcelain --untracked-files=all | grep "^$1" || true)"
  count="$(printf '%s' "$lines" | grep -c . || true)"
  [ "$count" -eq 0 ] && return 0
  shown=0
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    note "  ${line}"
    shown=$((shown + 1))
    [ "$shown" -ge "$2" ] && break
  done <<EOF
$lines
EOF
  [ "$count" -gt "$2" ] && note "  … and $((count - $2)) more"
  return 0
}

report_state() {
  say "== git synchronization: $REPO_ROOT =="
  note "branch        $BRANCH"
  note "upstream      $UPSTREAM"
  note "remote state  $FETCH_STATE"
  if [ "$AHEAD" -eq 0 ] && [ "$BEHIND" -eq 0 ]; then
    note "history       up to date with $UPSTREAM"
  elif [ "$BEHIND" -eq 0 ]; then
    note "history       ahead of $UPSTREAM by $AHEAD commit(s) (nothing to pull)"
  elif [ "$AHEAD" -eq 0 ]; then
    note "history       behind $UPSTREAM by $BEHIND commit(s)"
  else
    note "history       diverged: $AHEAD local commit(s) and $BEHIND incoming commit(s)"
  fi
  if [ "$TRACKED_CHANGES" -eq 0 ]; then
    note "working tree  clean (no tracked modifications)"
  else
    note "working tree  $TRACKED_CHANGES modified/staged tracked file(s):"
    list_paths ' M\|M \|A \| D\|D \|MM\|AM' 5
  fi
  if [ "$UNTRACKED_CHANGES" -gt 0 ]; then
    note "untracked     $UNTRACKED_CHANGES file(s) — reported only, never touched:"
    list_paths '??' 3
  fi
  if [ "$BEHIND" -gt 0 ]; then
    say "== incoming from $UPSTREAM ($BEHIND) =="
    git log --oneline --no-decorate "HEAD..$UPSTREAM" | head -10 | sed 's/^/  /'
    [ "$BEHIND" -gt 10 ] && note "  … and $((BEHIND - 10)) more"
  fi
  if [ "$AHEAD" -gt 0 ]; then
    say "== local commits not on $UPSTREAM ($AHEAD) =="
    git log --oneline --no-decorate "$UPSTREAM..HEAD" | head -10 | sed 's/^/  /'
    [ "$AHEAD" -gt 10 ] && note "  … and $((AHEAD - 10)) more"
  fi
}

case "$COMMAND" in
  check)
    report_state
    if [ "$AHEAD" -gt 0 ] && [ "$BEHIND" -gt 0 ]; then
      verdict "diverged — reconcile deliberately, nothing was changed"
      note "merge:  git pull --no-rebase   (keeps both histories; creates a merge commit)"
      note "rebase: git pull --rebase      (rewrites only your unpushed commits)"
      note "never force-push $BRANCH; resolve conflicts by hand and re-run this check"
      exit 1
    elif [ "$BEHIND" -gt 0 ]; then
      verdict "behind by $BEHIND — run: git-sync.sh sync"
      exit 1
    fi
    verdict "synchronized with $UPSTREAM"
    [ "$AHEAD" -gt 0 ] && note "$AHEAD local commit(s) are not pushed yet"
    exit 0
    ;;

  sync)
    if [ "$BEHIND" -eq 0 ]; then
      say "== git synchronization: $REPO_ROOT =="
      note "already up to date with $UPSTREAM"
      [ "$AHEAD" -gt 0 ] && note "$AHEAD local commit(s) are not pushed yet"
      [ "$UNTRACKED_CHANGES" -gt 0 ] && note "$UNTRACKED_CHANGES untracked file(s) left untouched"
      verdict "nothing to synchronize"
      exit 0
    fi
    if [ "$AHEAD" -gt 0 ]; then
      report_state
      verdict "diverged — refusing to fast-forward, nothing was changed"
      note "merge:  git pull --no-rebase"
      note "rebase: git pull --rebase"
      note "never force-push $BRANCH"
      exit 1
    fi
    if [ "$TRACKED_CHANGES" -gt 0 ] && [ "$ALLOW_DIRTY" != 1 ]; then
      report_state
      verdict "behind by $BEHIND, but the working tree has local changes — nothing was changed"
      note "commit or stash your work yourself, then re-run: git-sync.sh sync"
      note "or, if the incoming commits cannot touch your files: git-sync.sh sync --allow-dirty"
      note "(--allow-dirty still lets git refuse rather than overwrite; it never stashes or resets)"
      exit 1
    fi
    FF_OUT="$(git merge --ff-only --quiet "$UPSTREAM" 2>&1)"
    FF_CODE=$?
    [ -n "$FF_OUT" ] && printf '%s\n' "$FF_OUT" | sed 's/^/  /'
    if [ "$FF_CODE" -eq 0 ]; then
      say "== git synchronization: $REPO_ROOT =="
      note "fast-forwarded $BRANCH to $UPSTREAM ($(git rev-parse --short HEAD), $BEHIND commit(s))"
      [ "$TRACKED_CHANGES" -gt 0 ] && note "local modifications preserved ($TRACKED_CHANGES tracked file(s))"
      [ "$UNTRACKED_CHANGES" -gt 0 ] && note "$UNTRACKED_CHANGES untracked file(s) left untouched"
      verdict "synchronized with $UPSTREAM"
      exit 0
    fi
    verdict "git refused the fast-forward — nothing was discarded"
    note "your local changes and commits are intact; resolve the overlap by hand and re-run this check"
    exit 1
    ;;

  pre-push)
    report_state
    if [ "$BEHIND" -gt 0 ] && [ "$AHEAD" -eq 0 ]; then
      note "no local commits are ahead, so a fast-forward loses nothing:"
      FF_OUT="$(git merge --ff-only --quiet "$UPSTREAM" 2>&1)"
      FF_CODE=$?
      [ -n "$FF_OUT" ] && printf '%s\n' "$FF_OUT" | sed 's/^/  /'
      if [ "$FF_CODE" -eq 0 ]; then
        note "fast-forwarded $BRANCH to $UPSTREAM ($(git rev-parse --short HEAD))"
        verdict "safe to push: outgoing history now includes $UPSTREAM"
        exit 0
      fi
      verdict "cannot fast-forward (git refused) — do not push yet"
      note "commit or stash your own work, then re-run: git-sync.sh pre-push"
      exit 1
    fi
    if [ "$BEHIND" -gt 0 ]; then
      verdict "do not push: diverged from $UPSTREAM — nothing was changed"
      note "reconcile first: git pull --no-rebase (merge) or git pull --rebase"
      note "never force-push $BRANCH"
      exit 1
    fi
    verdict "safe to push: outgoing history includes $UPSTREAM"
    [ "$AHEAD" -gt 0 ] && note "$AHEAD local commit(s) will be published"
    exit 0
    ;;

  verify)
    TARGET="${REV:-HEAD}"
    SHA="$(git rev-parse --verify --quiet "${TARGET}^{commit}")" || {
      err "cannot resolve '$TARGET' to a commit"
      exit 2
    }
    say "== remote verification: $REPO_ROOT =="
    if git merge-base --is-ancestor "$SHA" "$UPSTREAM"; then
      note "$UPSTREAM contains $(git log -1 --format='%h %s' "$SHA")"
      verdict "the remote has this commit"
      exit 0
    fi
    note "$UPSTREAM does not contain $(git log -1 --format='%h %s' "$SHA")"
    err "the commit is not on $UPSTREAM — the push may have been rejected or not run"
    note "run: git-sync.sh pre-push (a non-fast-forward rejection means the remote moved: reconcile)" >&2
    exit 1
    ;;
esac

