#!/usr/bin/env bash
# Three-way sync of upstream ClipBoardLine Windows changes (windows/) into the
# Linux port (linux/), plus the shared contracts/ directory.
#
# Run it from (or point it at) the clipboardline git repository, e.g.
#   cd ~/Masaüstü/orkunprogram/clipboardline-repo && linux/scripts/sync-upstream.sh
#
# Usage: linux/scripts/sync-upstream.sh [REPO] [--apply] [--force] [--no-fetch]
#                                       [--from SHA] [--to REF]
#
#   REPO        path to the clipboardline git repo (default: two levels above
#               this script, i.e. the repo that contains linux/)
#   --apply     write results: 3-way merges (conflicts keep the usual
#               <<<<<<< / ======= / >>>>>>> markers), new files, and binary
#               files linux/ never changed; without it the script only reports
#   --force     allow --apply although linux/ or contracts/ has uncommitted changes
#   --no-fetch  do not run `git fetch upstream`
#   --from SHA  base commit (default: syncedCommit in linux/UPSTREAM_SYNC.json)
#   --to REF    upstream target (default: upstream/main)
#
# Per file changed between FROM and TO:
#   windows/X   -> linux/X     (base = FROM:windows/X, theirs = TO:windows/X)
#   contracts/X -> contracts/X (shared cross-platform contracts in the repo root)
# Statuses: clean, conflict, new, same, exists (new upstream file that differs
# from a local one; --apply writes upstream's copy to <file>.upstream),
# binary (copied when linux/ kept the base version), binary-conflict, deleted
# (report only; delete by hand after checking nothing uses it), absent,
# skipped (listed in UPSTREAM_SYNC.json "skipped"; windows files by their
# linux-relative path, contracts as contracts/X), error.
# The script never commits, stages, stashes or switches branches.
set -uo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$script_dir/../.." && pwd)"
apply=0
force=0
fetch=1
from=""
to="upstream/main"

while [ $# -gt 0 ]; do
  case "$1" in
    --apply) apply=1 ;;
    --force) force=1 ;;
    --no-fetch) fetch=0 ;;
    --from) from="${2:?--from needs a commit}"; shift ;;
    --to) to="${2:?--to needs a ref}"; shift ;;
    -h|--help) sed -n '2,35p' "$0"; exit 0 ;;
    -*) echo "unknown option: $1" >&2; exit 2 ;;
    *) repo="$(cd "$1" 2>/dev/null && pwd)" || { echo "not a directory: $1" >&2; exit 2; } ;;
  esac
  shift
done

top="$(git -C "$repo" rev-parse --show-toplevel 2>/dev/null)" || top=""
if [ -z "$top" ] || [ "$(cd "$top" && pwd -P)" != "$(cd "$repo" && pwd -P)" ] || [ ! -d "$repo/linux" ]; then
  echo "error: $repo is not the clipboardline git repository root (with linux/ inside)." >&2
  echo "Run this from clipboardline-repo, e.g.: cd clipboardline-repo && linux/scripts/sync-upstream.sh" >&2
  exit 2
fi
cd "$repo" || exit 2

sync_json="$repo/linux/UPSTREAM_SYNC.json"

if [ "$apply" = 1 ] && [ "$force" = 0 ] && [ -n "$(git status --porcelain -- linux contracts)" ]; then
  echo "error: linux/ or contracts/ has uncommitted changes; commit them first or pass --force." >&2
  git status --short -- linux contracts >&2
  exit 3
fi

if [ "$fetch" = 1 ]; then
  git fetch upstream || { echo "error: git fetch upstream failed" >&2; exit 4; }
fi

json_get() {
  node -e '
    const data = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    const key = process.argv[2];
    if (key === "skipped") for (const s of data.skipped || []) console.log(s.file);
    else console.log(data[key] || "");
  ' "$sync_json" "$1"
}

if [ -z "$from" ]; then
  [ -f "$sync_json" ] || { echo "error: missing $sync_json (pass --from SHA)" >&2; exit 2; }
  from="$(json_get syncedCommit)"
fi
skipped=""
[ -f "$sync_json" ] && skipped="$(json_get skipped)"

to_sha="$(git rev-parse --verify "$to^{commit}" 2>/dev/null)" || { echo "error: unknown upstream ref $to" >&2; exit 2; }
git rev-parse --verify "$from^{commit}" >/dev/null 2>&1 || { echo "error: unknown base commit $from" >&2; exit 2; }
echo "upstream ${from:0:12}..${to_sha:0:12} windows/ -> linux/, contracts/ -> contracts/ ($([ "$apply" = 1 ] && echo apply || echo dry-run))"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

clean=0 conflict=0 added=0 deleted=0 skip=0 binary=0 errors=0
declare -A is_binary=()
while IFS=$'\t' read -r adds dels path; do
  [ "$adds" = "-" ] && [ "$dels" = "-" ] && is_binary["$path"]=1
done < <(git diff --numstat "$from" "$to_sha" -- windows contracts)

report() { printf '%-16s %s\n' "$1" "$2"; }

while IFS=$'\t' read -r status path rest; do
  case "$path" in
    windows/*) rel="${path#windows/}"; ours="$repo/linux/$rel"; key="$rel"; shown="linux/$rel" ;;
    contracts/*) rel="$path"; ours="$repo/$path"; key="$path"; shown="$path" ;;
    *) continue ;;
  esac
  if [ -n "$skipped" ] && printf '%s\n' "$skipped" | grep -qxF "$key"; then
    report skipped "$shown"; skip=$((skip + 1)); continue
  fi
  case "$status" in
    A)
      if ! git show "$to_sha:$path" > "$tmp/theirs"; then report error "$shown (cannot read upstream)"; errors=$((errors + 1)); continue; fi
      if [ -e "$ours" ]; then
        if cmp -s "$tmp/theirs" "$ours"; then report same "$shown"; continue; fi
        report exists "$shown (new upstream, differs locally; upstream copy -> $shown.upstream)"; conflict=$((conflict + 1))
        [ "$apply" = 1 ] && cp "$tmp/theirs" "$ours.upstream"
      else
        report new "$shown"; added=$((added + 1))
        if [ "$apply" = 1 ]; then mkdir -p "$(dirname "$ours")" && cp "$tmp/theirs" "$ours"; fi
      fi
      ;;
    D)
      if [ -e "$ours" ]; then report deleted "$shown (removed upstream; check users, delete by hand)"
      else report deleted "$shown (already absent)"; fi
      deleted=$((deleted + 1))
      ;;
    M|T)
      if [ ! -e "$ours" ]; then report absent "$shown (changed upstream, not present locally)"; continue; fi
      if ! git show "$from:$path" > "$tmp/base" || ! git show "$to_sha:$path" > "$tmp/theirs"; then
        report error "$shown (cannot read base or upstream)"; errors=$((errors + 1)); continue
      fi
      if [ -n "${is_binary[$path]:-}" ]; then
        if cmp -s "$ours" "$tmp/theirs"; then report uptodate "$shown"; continue; fi
        if cmp -s "$ours" "$tmp/base"; then
          report binary "$shown (local copy unchanged; takes upstream)"; binary=$((binary + 1))
          [ "$apply" = 1 ] && cp "$tmp/theirs" "$ours"
        else
          report binary-conflict "$shown (both changed; resolve by hand)"; conflict=$((conflict + 1))
        fi
        continue
      fi
      cp "$ours" "$tmp/ours"
      git merge-file -p -L local -L base -L upstream "$tmp/ours" "$tmp/base" "$tmp/theirs" > "$tmp/merged" 2>"$tmp/err"
      rc=$?
      if [ "$rc" -gt 127 ]; then
        if cmp -s "$ours" "$tmp/base"; then
          report binary "$shown (merge-file refused; local unchanged, takes upstream)"; binary=$((binary + 1))
          [ "$apply" = 1 ] && cp "$tmp/theirs" "$ours"
        else
          report error "$shown (merge-file rc=$rc: $(head -c 200 "$tmp/err"))"; errors=$((errors + 1))
        fi
        continue
      fi
      if [ "$rc" = 0 ]; then
        if cmp -s "$tmp/merged" "$ours"; then report uptodate "$shown"; continue; fi
        report clean "$shown"; clean=$((clean + 1))
      else
        report conflict "$shown ($rc hunk(s))"; conflict=$((conflict + 1))
      fi
      [ "$apply" = 1 ] && cp "$tmp/merged" "$ours"
      ;;
    R*|C*)
      report renamed "$path -> $rest (handle by hand)"; conflict=$((conflict + 1))
      ;;
    *) report unknown "$status $path" ;;
  esac
done < <(git diff --name-status "$from" "$to_sha" -- windows contracts)

echo "summary: clean=$clean conflict=$conflict new=$added binary=$binary deleted=$deleted skipped=$skip errors=$errors"
if [ "$apply" = 1 ]; then
  echo "applied. Resolve conflict markers and *.upstream files, run npm test, then set syncedCommit=$to_sha in linux/UPSTREAM_SYNC.json"
fi
[ "$errors" = 0 ]
