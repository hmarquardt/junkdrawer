#!/usr/bin/env bash
# tests/git-sync.sh — behaviour tests for the Junkdrawer Git synchronization helper
# (.agents/skills/junkdrawer-git-sync/scripts/git-sync.sh).
#
#   bash tests/git-sync.sh
#
# Every scenario runs in disposable repositories created under a mktemp -d workspace: a bare
# "origin" plus two clones ("a" = the agent's checkout, "b" = another developer or the Overhead data
# workflow).  This repo's own history, working tree and configuration are never touched, and the
# helper is asserted to be read-only wherever it is supposed to be.
set -u

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SYNC="$REPO_ROOT/.agents/skills/junkdrawer-git-sync/scripts/git-sync.sh"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/junkdrawer-git-sync.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

PASS=0
FAIL=0
ok()  { PASS=$((PASS + 1)); echo "  ok      $1"; }
bad() { FAIL=$((FAIL + 1)); echo "  FAIL    $1"; }

check() { # check <label> <expected> <actual>
  if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (expected '$2', got '$3')"; fi
}

contains() { # contains <label> <needle> <file>
  if grep -q -- "$2" "$3"; then ok "$1"; else bad "$1 (output lacks '$2')"; fi
}

absent() { # absent <label> <needle> <file>
  if grep -q -- "$2" "$3"; then bad "$1 (output unexpectedly has '$2')"; else ok "$1"; fi
}

file_is() { # file_is <label> <file> <expected-content>
  if [ "$(cat "$2" 2>/dev/null)" = "$3" ]; then ok "$1"; else bad "$1 ($2 changed)"; fi
}

snapshot() { # snapshot <dir> — HEAD plus porcelain status, for non-destructiveness checks
  { git -C "$1" rev-parse HEAD; git -C "$1" status --porcelain; } 2>/dev/null
}

same_snapshot() { # same_snapshot <label> <dir> <before-file>
  if [ "$(snapshot "$2")" = "$(cat "$3")" ]; then ok "$1"; else bad "$1 (repository state changed)"; fi
}

run_sync() { # run_sync <dir> [args...] — sets SYNC_OUT (stdout+stderr) and SYNC_CODE
  local dir="$1"
  shift
  SYNC_OUT="$(cd "$dir" && "$SYNC" "$@" 2>&1)"
  SYNC_CODE=$?
}

setup() { # setup <name> — bare origin + clones a and b, seeded with a commit; echoes the dir
  local dir="$WORK/$1"
  mkdir -p "$dir"
  git init -q -b main --bare "$dir/origin.git"
  git clone -q "$dir/origin.git" "$dir/a" 2>/dev/null
  git clone -q "$dir/origin.git" "$dir/b" 2>/dev/null
  local r
  for r in a b; do
    git -C "$dir/$r" config user.email "test@example.invalid"
    git -C "$dir/$r" config user.name "Test $r"
  done
  mkdir -p "$dir/a/data/overhead"
  echo "one" > "$dir/a/file.txt"
  echo '{"comets":[],"generated_at":"seed"}' > "$dir/a/data/overhead/comets.json"
  git -C "$dir/a" add -A
  git -C "$dir/a" commit -qm "seed"
  git -C "$dir/a" push -q origin main
  git -C "$dir/b" pull -q origin main
  printf '%s' "$dir"
}

remote_commit() { # remote_commit <dir> <relative-path> <content> <message>
  mkdir -p "$(dirname "$1/b/$2")"
  printf '%s\n' "$3" > "$1/b/$2"
  git -C "$1/b" add -A
  git -C "$1/b" commit -qm "$4"
  git -C "$1/b" push -q origin main
}

local_commit() { # local_commit <dir> <relative-path> <content> <message>
  mkdir -p "$(dirname "$1/a/$2")"
  printf '%s\n' "$3" > "$1/a/$2"
  git -C "$1/a" add -A
  git -C "$1/a" commit -qm "$4"
}


echo "== 1. clean fast-forward =="
D="$(setup t1)"
remote_commit "$D" "bot.txt" "from b" "b: unrelated change"
run_sync "$D/a" check
check "check reports attention while behind" 1 "$SYNC_CODE"
printf '%s' "$SYNC_OUT" > "$WORK/t1.check"
contains "check says how far behind" "behind origin/main by 1" "$WORK/t1.check"
contains "check lists the incoming commit" "b: unrelated change" "$WORK/t1.check"
run_sync "$D/a" sync
check "sync fast-forwards" 0 "$SYNC_CODE"
printf '%s' "$SYNC_OUT" > "$WORK/t1.sync"
contains "sync says what it did" "fast-forwarded main to origin/main" "$WORK/t1.sync"
file_is "incoming file arrived" "$D/a/bot.txt" "from b"
run_sync "$D/a" check
check "check is clean afterwards" 0 "$SYNC_CODE"

echo "== 2. local modifications with an advanced remote =="
D="$(setup t2)"
printf 'my local edit\n' >> "$D/a/file.txt"
remote_commit "$D" "bot.txt" "from b" "b: unrelated change"
printf '%s' "$(snapshot "$D/a")" > "$WORK/t2.before"
run_sync "$D/a" sync
check "sync refuses to move a dirty tree" 1 "$SYNC_CODE"
printf '%s' "$SYNC_OUT" > "$WORK/t2.sync"
contains "sync explains why" "working tree has local changes" "$WORK/t2.sync"
contains "sync suggests the explicit flag" "sync --allow-dirty" "$WORK/t2.sync"
contains "sync lists the modified file it is protecting" "M file.txt" "$WORK/t2.sync"
same_snapshot "refusal left the tree untouched" "$D/a" "$WORK/t2.before"
file_is "local edit survived the refusal" "$D/a/file.txt" "$(printf 'one\nmy local edit')"
run_sync "$D/a" sync --allow-dirty
check "sync --allow-dirty fast-forwards" 0 "$SYNC_CODE"
printf '%s' "$SYNC_OUT" > "$WORK/t2.dirty"
contains "sync reports preserved modifications" "local modifications preserved" "$WORK/t2.dirty"
file_is "local edit survived the fast-forward" "$D/a/file.txt" "$(printf 'one\nmy local edit')"
file_is "incoming file arrived too" "$D/a/bot.txt" "from b"

echo "== 3. diverged local and remote commits =="
D="$(setup t3)"
local_commit "$D" "a.txt" "from a" "a: local work"
remote_commit "$D" "b.txt" "from b" "b: remote work"
printf '%s' "$(snapshot "$D/a")" > "$WORK/t3.before"
run_sync "$D/a" check
check "check reports divergence" 1 "$SYNC_CODE"
printf '%s' "$SYNC_OUT" > "$WORK/t3.check"
contains "check says diverged" "diverged" "$WORK/t3.check"
contains "check names both reconciliations" "git pull --rebase" "$WORK/t3.check"
contains "check forbids force-pushing" "never force-push main" "$WORK/t3.check"
run_sync "$D/a" pre-push
check "pre-push refuses to publish diverged history" 1 "$SYNC_CODE"
printf '%s' "$SYNC_OUT" > "$WORK/t3.prepush"
contains "pre-push says do not push" "do not push: diverged" "$WORK/t3.prepush"
run_sync "$D/a" sync
check "sync refuses to reconcile automatically" 1 "$SYNC_CODE"

echo "== 4. remote-only automated data commit =="
D="$(setup t4)"
remote_commit "$D" "data/overhead/comets.json" '{"comets":[{"id":"78P"}],"generated_at":"bot"}' "Refresh Overhead celestial data (test)"
run_sync "$D/a" check
check "check sees the automated commit" 1 "$SYNC_CODE"
printf '%s' "$SYNC_OUT" > "$WORK/t4.check"
contains "check lists the data commit" "Refresh Overhead celestial data (test)" "$WORK/t4.check"
run_sync "$D/a" sync
check "sync integrates the automated commit" 0 "$SYNC_CODE"
if cmp -s "$D/a/data/overhead/comets.json" "$D/b/data/overhead/comets.json"; then
  ok "published data matches the automated commit"
else
  bad "published data does not match the automated commit"
fi
file_is "no local work was lost" "$D/a/file.txt" "one"

echo "== 5. non-fast-forward push rejection =="
D="$(setup t5)"
local_commit "$D" "a.txt" "from a" "a: local work"
remote_commit "$D" "b.txt" "from b" "b: remote work"
run_sync "$D/a" pre-push
check "pre-push already blocks the push" 1 "$SYNC_CODE"
PUSH_OUT="$(cd "$D/a" && git push origin main 2>&1)"
PUSH_CODE=$?
if [ "$PUSH_CODE" -ne 0 ]; then ok "the real push is rejected (exit $PUSH_CODE)"; else bad "the push unexpectedly succeeded"; fi
printf '%s' "$PUSH_OUT" > "$WORK/t5.push"
contains "git reports a rejected push" "rejected" "$WORK/t5.push"
if git -C "$D/a" log --oneline | grep -q "a: local work"; then
  ok "the local commit survived the rejection"
else
  bad "the local commit was lost"
fi
run_sync "$D/a" pre-push
check "pre-push still blocks after the rejection" 1 "$SYNC_CODE"
printf '%s' "$SYNC_OUT" > "$WORK/t5.after"
contains "pre-push repeats the safe path" "git pull --rebase" "$WORK/t5.after"

echo "== 6. fetch failure is reported, never glossed over =="
D="$(setup t6)"
git -C "$D/a" remote set-url origin "$D/missing.git"
run_sync "$D/a" check
check "check cannot verify without a fetch" 3 "$SYNC_CODE"
printf '%s' "$SYNC_OUT" > "$WORK/t6.check"
contains "check reports the failed fetch" "git fetch origin failed" "$WORK/t6.check"
contains "check refuses to claim synchronization" "cannot confirm synchronization" "$WORK/t6.check"
absent "check does not claim it is synchronized" "verdict: synchronized" "$WORK/t6.check"
run_sync "$D/a" pre-push
check "pre-push cannot verify either" 3 "$SYNC_CODE"
run_sync "$D/a" sync
check "sync does not act without a fetch" 3 "$SYNC_CODE"
git -C "$D/a" remote set-url origin "$D/origin.git"
run_sync "$D/a" check
check "check recovers once the remote is reachable" 0 "$SYNC_CODE"

echo "== 7. untracked files are preserved =="
D="$(setup t7)"
printf 'my scratch notes\n' > "$D/a/scratch.txt"
remote_commit "$D" "bot.txt" "from b" "b: unrelated change"
run_sync "$D/a" sync
check "untracked files do not block a fast-forward" 0 "$SYNC_CODE"
printf '%s' "$SYNC_OUT" > "$WORK/t7.sync"
contains "sync reports the untracked files it left alone" "untracked file(s) left untouched" "$WORK/t7.sync"
file_is "untracked file survived" "$D/a/scratch.txt" "my scratch notes"

echo "== 8. an incoming file that collides with an untracked file =="
D="$(setup t8)"
printf 'mine\n' > "$D/a/scratch.txt"
remote_commit "$D" "scratch.txt" "theirs" "b: adds scratch.txt"
printf '%s' "$(snapshot "$D/a")" > "$WORK/t8.before"
run_sync "$D/a" sync
check "git refuses rather than overwrite" 1 "$SYNC_CODE"
printf '%s' "$SYNC_OUT" > "$WORK/t8.sync"
contains "sync reports the refusal" "nothing was discarded" "$WORK/t8.sync"
same_snapshot "the refusal changed nothing" "$D/a" "$WORK/t8.before"
file_is "the untracked file still holds local content" "$D/a/scratch.txt" "mine"

echo "== 9. a branch without an upstream =="
D="$(setup t9)"
git -C "$D/a" switch -q -c feature
run_sync "$D/a" check
check "check reports the missing upstream" 1 "$SYNC_CODE"
printf '%s' "$SYNC_OUT" > "$WORK/t9.check"
contains "check explains how to fix it" "set-upstream-to" "$WORK/t9.check"
contains "check says it cannot confirm synchronization" "cannot confirm synchronization" "$WORK/t9.check"

echo "== 10. usage and help =="
run_sync "$REPO_ROOT" --help
check "--help succeeds" 0 "$SYNC_CODE"
run_sync "$REPO_ROOT" check --no-fetch --allow-dirty
check "an unsupported flag combination is a usage error" 2 "$SYNC_CODE"
run_sync "$REPO_ROOT" nonsense
check "an unknown command is a usage error" 2 "$SYNC_CODE"

echo "== 11. verify confirms the remote actually has the commit =="
D="$(setup t11)"
local_commit "$D" "a.txt" "from a" "a: local work"
run_sync "$D/a" verify
check "verify fails for an unpushed commit" 1 "$SYNC_CODE"
printf '%s' "$SYNC_OUT" > "$WORK/t11.before"
contains "verify explains what a failure means" "the push may have been rejected" "$WORK/t11.before"
git -C "$D/a" push -q origin main
run_sync "$D/a" verify
check "verify succeeds after the push" 0 "$SYNC_CODE"
printf '%s' "$SYNC_OUT" > "$WORK/t11.after"
contains "verify names the commit" "a: local work" "$WORK/t11.after"
run_sync "$D/a" verify not-a-ref
check "verify rejects an unresolvable revision" 2 "$SYNC_CODE"

echo
echo "== summary: $PASS passed, $FAIL failed =="
[ "$FAIL" -gt 0 ] && exit 1
exit 0

printf '%s' "$SYNC_OUT" > "$WORK/t3.sync"
contains "sync explains the refusal" "refusing to fast-forward" "$WORK/t3.sync"
same_snapshot "read-only commands changed nothing" "$D/a" "$WORK/t3.before"
file_is "local commit content intact" "$D/a/a.txt" "from a"
file_is "seed file untouched" "$D/a/file.txt" "one"
