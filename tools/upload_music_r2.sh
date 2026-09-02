#!/usr/bin/env bash
# One-time sync of audio/my-music/ to the R2 bucket behind storage.nathanpenny.fun.
# Usage: tools/upload_music_r2.sh <bucket-name>
# Keys land under music/<Artist>/<Album>/<file>. Re-running only re-puts the same
# objects (harmless), so it also works to top up newly added songs.
# Requires wrangler auth: npx wrangler whoami.
set -euo pipefail

BUCKET="${1:?usage: upload_music_r2.sh <bucket-name>}"
SRC="$(cd "$(dirname "$0")/.." && pwd)/audio/my-music"

content_type_for() {
  case "${1##*.}" in
    mp3) echo "audio/mpeg" ;;
    flac) echo "audio/flac" ;;
    m4a) echo "audio/mp4" ;;
    *) echo "application/octet-stream" ;;
  esac
}

count=0
fails=0
while IFS= read -r -d '' file; do
  rel="${file#"$SRC"/}"
  # Collapse runs of 2+ dots into `…`: Cloudflare WAF 403s API requests whose
  # path contains `...`. MUST stay in sync with r2_key() in
  # tools/gen_music_library.py — local filenames are untouched.
  key="music/$(printf '%s' "$rel" | sed -E 's/\.{2,}/…/g')"
  count=$((count + 1))
  echo "[$count] put $key"
  attempt=1
  # Transient Cloudflare API 5xx happen; retry with backoff instead of dying
  # halfway (set -e must not kill the run on a single flaky put).
  until npx wrangler r2 object put "$BUCKET/$key" \
      --file "$file" \
      --content-type "$(content_type_for "$file")" \
      --remote >/dev/null 2>&1; do
    if [ "$attempt" -ge 5 ]; then
      echo "FAILED after $attempt attempts: $key" >&2
      fails=$((fails + 1))
      break
    fi
    echo "  retry $attempt: $key" >&2
    sleep $((attempt * 3))
    attempt=$((attempt + 1))
  done
done < <(find "$SRC" -type f ! -path "*/.*" \( -name "*.mp3" -o -name "*.flac" -o -name "*.m4a" \) -print0)

echo "done: $count objects under $BUCKET/music/, $fails failed"
[ "$fails" -eq 0 ]
