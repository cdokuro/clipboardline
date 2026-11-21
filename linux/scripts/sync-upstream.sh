#!/usr/bin/env bash
# Three-way sync of upstream ClipBoardLine Windows changes (windows/) into the
# Linux port (linux/).
#
# Usage: linux/scripts/sync-upstream.sh [REPO] [--apply] [--no-fetch]
#                                       [--from SHA] [--to REF]
#
#   REPO        path to the clipboardline git repo (default: two levels above
#               this script, i.e. the repo that contains linux/)
#   --apply     write merge results into linux/ (conflicts keep the usual
#               <<<<<<< / ======= / >>>>>>> markers) and copy new files;
#               without it the script only reports (dry run)
#   --no-fetch  do not run `git fetch upstream`
#   --from SHA  base commit (default: syncedCommit in linux/UPSTREAM_SYNC.json)
#   --to REF    upstream target (default: upstream/main)
#
# Per file changed in windows/ between FROM and TO:
#   base = FROM:windows/X, theirs = TO:windows/X, ours = linux/X
# Files listed in UPSTREAM_SYNC.json "skipped" are reported as "skipped" and
# never written. Deleted upstream files are only reported; delete them by hand
# after checking nothing in linux/ uses them. The script never commits,
# stages, stashes or switches branches.
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$script_dir/../.." && pwd)"
apply=0
fetch=1
from=""
to="upstream/main"

while [ $# -gt 0 ]; do
  case "$1" in
    --apply) apply=1 ;;
    --no-fetch) fetch=0 ;;
    --from) from="$2"; shift ;;
    --to) to="$2"; shift ;;
    -h|--help) sed -n '2,24p' "$0"; exit 0 ;;
    -*) echo "unknown option: $1" >&2; exit 2 ;;
    *) repo="$(cd "$1" && pwd)" ;;
  esac
  shift
done

sync_json="$repo/linux/UPSTREAM_SYNC.json"
cd "$repo"

if [ "$fetch" = 1 ]; then
  git fetch upstream
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
  [ -f "$sync_json" ] || { echo "missing $sync_json (pass --from SHA)" >&2; exit 2; }
  from="$(json_get syncedCommit)"
fi
skipped=""
[ -f "$sync_json" ] && skipped="$(json_get skipped)"

to_sha="$(git rev-parse "$to")"
echo "upstream windows/ ${from:0:12}..${to_sha:0:12} -> linux/ ($([ "$apply" = 1 ] && echo apply || echo dry-run))"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

clean=0 conflict=0 added=0 deleted=0 skip=0
while IFS=$'\t' read -r status path rest; do
  rel="${path#windows/}"
  ours="$repo/linux/$rel"
  if printf '%s\n' "$skipped" | grep -qxF "$rel"; then
    echo "skipped   $rel"; skip=$((skip + 1)); continue
  fi
  case "$status" in
    A)
      if [ -e "$ours" ]; then
        git show "$to_sha:$path" > "$tmp/theirs"
        if cmp -s "$tmp/theirs" "$ours"; then echo "same      $rel"; continue; fi
        echo "conflict  $rel (new upstream, already exists locally)"; conflict=$((conflict + 1))
      else
        echo "new       $rel"; added=$((added + 1))
        if [ "$apply" = 1 ]; then
          mkdir -p "$(dirname "$ours")"
          git show "$to_sha:$path" > "$ours"
        fi
      fi
      ;;
    D)
      if [ -e "$ours" ]; then echo "deleted   $rel (upstream removed it; check linux/ users, delete by hand)"
      else echo "deleted   $rel (already absent)"; fi
      deleted=$((deleted + 1))
      ;;
    M|T)
      if [ ! -e "$ours" ]; then
        echo "absent    $rel (changed upstream, not present in linux/)"; continue
      fi
      git show "$from:$path" > "$tmp/base"
      git show "$to_sha:$path" > "$tmp/theirs"
      cp "$ours" "$tmp/ours"
      set +e
      git merge-file -p -L linux -L base -L upstream "$tmp/ours" "$tmp/base" "$tmp/theirs" > "$tmp/merged"
      rc=$?
      set -e
      if [ "$rc" -lt 0 ] || [ "$rc" -gt 127 ]; then echo "error     $rel (merge-file rc=$rc)" >&2; exit 1; fi
      if [ "$rc" = 0 ]; then
        if cmp -s "$tmp/merged" "$ours"; then echo "uptodate  $rel"; continue; fi
        echo "clean     $rel"; clean=$((clean + 1))
      else
        echo "conflict  $rel ($rc hunk(s))"; conflict=$((conflict + 1))
      fi
      [ "$apply" = 1 ] && cp "$tmp/merged" "$ours"
      ;;
    R*|C*)
      echo "renamed   $path -> $rest (handle by hand)"; conflict=$((conflict + 1))
      ;;
    *) echo "unknown   $status $path" ;;
  esac
done < <(git diff --name-status "$from" "$to_sha" -- windows)

echo "summary: clean=$clean conflict=$conflict new=$added deleted=$deleted skipped=$skip"
if [ "$apply" = 1 ]; then
  echo "applied. Resolve conflict markers, run npm test, then set syncedCommit=$to_sha in linux/UPSTREAM_SYNC.json"
fi
