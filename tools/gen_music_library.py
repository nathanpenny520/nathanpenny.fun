#!/usr/bin/env python3
"""Music library pipeline: scans audio/my-music/ (Artist/Album/<Title>-<Album>-<Artist>.ext),
downloads the cover art already looked up in audio/my-music/.task_meta/cover_results.json
into images/music-covers/, and emits data/music-library.json for the creations page.

The media itself is NOT in the repository (audio/my-music/ is gitignored); it is
uploaded to the R2 bucket behind https://storage.nathanpenny.fun with
tools/upload_music_r2.sh and served under /music/<Artist>/<Album>/<file>. The
generated JSON is committed, but CI never regenerates it (no media in the repo):
run this script locally whenever the library changes. stdlib-only and idempotent
(cover downloads are skipped when the target file already exists).
"""

import hashlib
import json
import re
import sys
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MUSIC_SRC = ROOT / "audio" / "my-music"
COVER_META = MUSIC_SRC / ".task_meta" / "cover_results.json"
COVERS_OUT = ROOT / "images" / "music-covers"
LIBRARY_OUT = ROOT / "data" / "music-library.json"
# Path prefix under the storage domain; adjust here if the R2 layout changes.
MUSIC_BASE = "https://storage.nathanpenny.fun/music/"
AUDIO_EXTS = {".mp3", ".flac", ".m4a"}


def slugify(name):
    """Filesystem/URL-safe slug: keep word chars, squeeze the rest."""
    return re.sub(r"[^\w.-]+", "-", name.lower()).strip("-") or "item"


def r2_key(rel):
    """R2 object key for a library-relative path. Cloudflare's WAF blocks API
    requests whose URL path contains `...` (path-traversal heuristic), so keys
    collapse any run of 2+ dots into `…`. MUST stay in sync with the same
    mapping in tools/upload_music_r2.sh — local filenames are untouched."""
    return re.sub(r"\.{2,}", "…", str(rel))


def title_of(stem, artist_dir, album_dir):
    """Filename convention is <Title>-<Album>-<Artist>; artist/album come from
    the directory names (the truth), so strip them off the stem's tail. Dot
    runs are collapsed first and the suffix match tolerates a `…` prefix,
    because filenames and folder names disagree about leading dots (e.g. the
    `...Baby One More Time` file inside `Baby One More Time/`). Falls back to
    the raw stem when the convention doesn't hold.
    """
    collapse = lambda s: re.sub(r"\.{2,}", "…", s)
    title = collapse(stem)
    for part in (artist_dir, album_dir):
        title = re.sub(r"-(…?" + re.escape(collapse(part)) + r")$", "", title)
    title = title.strip("- ").strip()
    return title or collapse(stem)


def download_cover(url, dest):
    request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(request, timeout=30) as response, dest.open("wb") as fh:
        fh.write(response.read())


def main():
    if not MUSIC_SRC.exists():
        sys.exit(f"missing {MUSIC_SRC}")
    covers_meta = {}
    if COVER_META.exists():
        covers_meta = json.loads(COVER_META.read_text(encoding="utf-8"))
    else:
        print(f"  note: no cover metadata at {COVER_META}, songs get no covers")
    COVERS_OUT.mkdir(parents=True, exist_ok=True)

    songs = []
    seen_ids = {}
    for path in sorted(MUSIC_SRC.rglob("*")):
        if path.suffix.lower() not in AUDIO_EXTS:
            continue
        rel = path.relative_to(MUSIC_SRC)
        if len(rel.parts) != 3:  # Artist/Album/file
            print(f"  skip (unexpected depth): {rel}")
            continue
        artist_dir, album_dir, filename = rel.parts
        title = title_of(path.stem, artist_dir, album_dir)

        # Stable, collision-free cover/id slug: readable base + hash of the path.
        digest = hashlib.md5(str(rel).encode("utf-8")).hexdigest()[:8]
        base_slug = slugify(f"{artist_dir}-{album_dir}-{title}")
        id_slug = base_slug
        while id_slug in seen_ids:
            seen_ids[base_slug] += 1
            id_slug = f"{base_slug}-{seen_ids[base_slug] + 1}"
        seen_ids[base_slug] = max(seen_ids.get(base_slug, 0), 1)

        cover = None
        meta = covers_meta.get(filename)
        if meta and meta.get("art"):
            cover_name = f"{base_slug}-{digest}.jpg"
            cover_path = COVERS_OUT / cover_name
            if not cover_path.exists():
                try:
                    download_cover(meta["art"], cover_path)
                    print(f"  cover {cover_name}")
                except Exception as error:  # network flakiness must not kill the run
                    print(f"  cover FAILED for {filename}: {error}")
            if cover_path.exists():
                cover = "../images/music-covers/" + cover_name
        else:
            print(f"  no cover metadata for {filename}")

        src = MUSIC_BASE + urllib.parse.quote(r2_key(f"{artist_dir}/{album_dir}/{filename}"))
        songs.append({
            "id": id_slug,
            "type": "song",
            "title": title,
            "artist": artist_dir.strip(),
            "album": album_dir.strip(),
            "src": src,
            "cover": cover,
        })

    songs.sort(key=lambda s: (s["artist"].lower(), s["album"].lower(), s["title"].lower()))
    LIBRARY_OUT.write_text(json.dumps(songs, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {LIBRARY_OUT.relative_to(ROOT)} ({len(songs)} songs)")


if __name__ == "__main__":
    main()
