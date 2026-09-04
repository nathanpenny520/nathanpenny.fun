#!/usr/bin/env python3
"""Blog pipeline: posts/*.md is the source of truth, this script generates
everything else. stdlib-only and idempotent.

Authoring a new or edited post:

  1. create/edit posts/<slug>.md — frontmatter (title, date, optional
     description / category / tags) plus a Markdown body (raw HTML blocks
     pass through untouched, e.g. for video/audio embeds or images with
     explicit width/height)
  2. run this script from the repo root:  python3 tools/gen_post_pages.py
     (or just push — CI runs it and commits the results)

The script (re)writes:

  - pages/blog.html        the category filter chips (posts:filters) and the
                           post cards (posts:articles) between their marker
                           comments; everything else in the file is untouched.
                           The list shows the chip toolbar (always every
                           category, counts baked in at generation time) plus
                           one summary card per post; full articles live on
                           the single-post pages.
  - blog/<slug>/index.html one static page per post: full <head> with
                           canonical URL, article og tags and BlogPosting
                           JSON-LD; sidebar with the post list; newer/older
                           links. Reading extras (progress bar, reading time,
                           back to top) attach automatically because main.js
                           hooks on .blog-main / .blog-card.
  - feed.xml               regenerated completely, newest post first
  - sitemap.xml            the static pages plus every post

Posts are ordered newest-first everywhere (blog list, TOC, feed, single-page
nav). Slug = the .md filename. Inside a body, asset paths are relative to
pages/ (../images/...) and get pushed one level deeper automatically for the
single-post pages.
"""

import datetime
import email.utils
import html
import json
import re
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BLOG_HTML = ROOT / "pages" / "blog.html"
FEED = ROOT / "feed.xml"
SITEMAP = ROOT / "sitemap.xml"
POSTS_SRC = ROOT / "posts"
POSTS_OUT = ROOT / "blog"

SITE = "https://nathanpenny.fun"
STATIC_PATHS = ["/", "/about", "/blog", "/gallery", "/creations", "/achievements", "/contact", "/privacy"]
PAGE_TITLE_SUFFIX = " | Nathan Penny's blog"

ARTICLES_START = "<!-- posts:articles:start -->"
ARTICLES_END = "<!-- posts:articles:end -->"
FILTERS_START = "<!-- posts:filters:start -->"
FILTERS_END = "<!-- posts:filters:end -->"

# Fixed blog taxonomy: frontmatter `category:` slug -> display name. Dict
# order is the chip order on the blog list; every chip is always rendered,
# even with zero posts.
CATEGORIES = {
    "anime": "Anime",
    "life": "Life",
    "tech": "Tech",
    "fun": "Fun",
    "fiction": "Fiction",
    "travel": "Travel",
    "ai": "AI",
    "sports": "Sports",
    "misc": "Misc",
}

IMG_RE = re.compile(r'<img[^>]+src="\.\./([^"]+)"')
POSTER_RE = re.compile(r'<video[^>]+poster="\.\./([^"]+)"')
DEFAULT_OG_IMAGE = "images/og-image.jpg"


def read(path):
    return path.read_text(encoding="utf-8")


def write(path, text, note=""):
    path.write_text(text, encoding="utf-8")
    print(f"  wrote {path.relative_to(ROOT)} {note}")


# ---------------------------------------------------------------------------
# Markdown rendering (trusted, site-author content; raw HTML passes through)
# ---------------------------------------------------------------------------

def render_inline(text):
    """Inline markdown: code spans, images, links, autolinks, bold, italic,
    strikethrough. Everything else (including inline HTML like <br> or
    <strong>) passes through as-is.
    """
    parts = re.split(r"(`[^`]+`)", text)
    out = []
    for part in parts:
        if part.startswith("`") and part.endswith("`") and len(part) > 2:
            out.append("<code>" + html.escape(part[1:-1]) + "</code>")
            continue
        s = part
        s = re.sub(
            r"!\[([^\]]*)\]\(([^)\s]+)\)",
            r'<img class="blog-img" src="\2" alt="\1" loading="lazy" decoding="async">',
            s,
        )
        s = re.sub(r"\[([^\]]+)\]\(([^)\s]+)\)", r'<a href="\2">\1</a>', s)
        s = re.sub(r"<(https?://[^>\s]+)>", r'<a href="\1">\1</a>', s)
        s = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", s)
        s = re.sub(r"\*([^*]+)\*", r"<em>\1</em>", s)
        s = re.sub(r"~~([^~]+)~~", r"<del>\1</del>", s)
        out.append(s)
    return "".join(out)


# Block starters recognized by the paragraph loop. "|" is included so a table
# can interrupt a paragraph; a "|" line that turns out not to be a table is
# re-consumed as a paragraph (the paragraph branch always consumes >= 1 line).
BLOCK_START = re.compile(r"^(<|```|#{1,4}\s|>\s?|[-*]\s+|\d{1,9}[.)]\s+|\||---\s*$)")

# One list item: leading indent, marker (-, *, 1., 1)), then the text.
LIST_ITEM_RE = re.compile(r"^(\s*)([-*]|\d{1,9}[.)])\s+(.*)$")
TASK_RE = re.compile(r"^\[( |x|X)\]\s+(.*)$")
TABLE_DELIM_RE = re.compile(r"^:?-{3,}:?$")


def list_is_ordered(marker):
    return marker not in ("-", "*")


def render_list(lines, i, indent):
    """Parse a (possibly nested) ul/ol whose first item starts at column
    `indent`. Returns (html, next_i). A less-indented line, any non-item line
    or a blank line ends the list — loose lists (items separated by blank
    lines) are not supported, same as the old flat renderer. A nested list is
    appended inside the previous <li>; task items get a disabled checkbox and
    mark the list with class="task-list".
    """
    ordered = list_is_ordered(LIST_ITEM_RE.match(lines[i]).group(2))
    items = []
    has_task = False
    while i < len(lines):
        m = LIST_ITEM_RE.match(lines[i])
        if not m or len(m.group(1)) < indent:
            break
        if len(m.group(1)) > indent:
            sub, i = render_list(lines, i, len(m.group(1)))
            if items:
                items[-1] += "\n" + sub
            else:  # first item is deeper than `indent` — hoist it up
                items.append(sub)
            continue
        text = m.group(3).strip()
        task = TASK_RE.match(text)
        if task:
            has_task = True
            checked = " checked" if task.group(1).lower() == "x" else ""
            items.append('  <li><input type="checkbox" disabled{}> {}</li>'.format(checked, render_inline(task.group(2))))
        else:
            items.append("  <li>" + render_inline(text) + "</li>")
        i += 1
    tag = "ol" if ordered else "ul"
    cls = ' class="task-list"' if has_task else ""
    return "<{t}{c}>\n{items}\n</{t}>".format(t=tag, c=cls, items="\n".join(items)), i


def table_cells(line):
    """Split a table row into cells, tolerating missing leading/trailing
    pipes. "|" inside backtick code spans does not split — code spans are
    tokenized first, mirroring render_inline's ordering.
    """
    line = line.strip()
    if line.startswith("|"):
        line = line[1:]
    if line.endswith("|"):
        line = line[:-1]
    cells, buf, in_code = [], [], False
    for ch in line:
        if ch == "`":
            in_code = not in_code
            buf.append(ch)
        elif ch == "|" and not in_code:
            cells.append("".join(buf).strip())
            buf = []
        else:
            buf.append(ch)
    cells.append("".join(buf).strip())
    return cells


def is_delimiter_row(line):
    cells = table_cells(line)
    return bool(cells) and all(TABLE_DELIM_RE.match(c) for c in cells)


def table_align_attr(cell):
    left, right = cell.startswith(":"), cell.endswith(":")
    if left and right:
        return ' style="text-align:center"'
    if right:
        return ' style="text-align:right"'
    if left:
        return ' style="text-align:left"'
    return ""


def render_table(lines, i):
    """Parse a pipe table; lines[i] is the header row, lines[i+1] the ---
    delimiter row (already checked by the caller). Body rows continue while
    lines start with "|". Cells are padded/truncated to the header width.
    """
    head = table_cells(lines[i])
    aligns = [table_align_attr(c) for c in table_cells(lines[i + 1])]
    i += 2
    rows = []
    while i < len(lines) and lines[i].strip().startswith("|"):
        cells = table_cells(lines[i])
        rows.append((cells + [""] * len(head))[: len(head)])
        i += 1

    def row_html(tag, cells):
        cells_html = "".join(
            "<{t}{a}>{c}</{t}>".format(t=tag, a=aligns[j] if j < len(aligns) else "", c=render_inline(c))
            for j, c in enumerate(cells)
        )
        return "    <tr>" + cells_html + "</tr>"

    return (
        "<table>\n  <thead>\n{h}\n  </thead>\n  <tbody>\n{b}\n  </tbody>\n</table>"
    ).format(h=row_html("th", head), b="\n".join(row_html("td", r) for r in rows) if rows else ""), i


def render_markdown(text):
    """Block-level markdown. A block whose first line starts with '<' is raw
    HTML and is emitted verbatim (consume until the next blank line), so
    video/audio/table embeds and hand-tuned markup just work.
    """
    lines = text.split("\n")
    out = []
    i = 0
    while i < len(lines):
        stripped = lines[i].strip()
        if not stripped:
            i += 1
            continue

        if stripped.startswith("```"):
            m = re.match(r"^```([^\s`]+)", stripped)
            lang = m.group(1) if m else ""
            cls = ' class="language-{}"'.format(lang) if re.match(r"^[a-zA-Z0-9_+-]+$", lang) else ""
            code = []
            i += 1
            while i < len(lines) and not lines[i].strip().startswith("```"):
                code.append(lines[i])
                i += 1
            i += 1  # closing fence
            out.append("<pre><code{}>{}</code></pre>".format(cls, html.escape("\n".join(code))))
            continue

        m = re.match(r"^(#{1,4})\s+(.*)$", stripped)
        if m:
            # Body headings shift down one level: the post title (h3 on the
            # list, h2-level visually) comes from the frontmatter.
            level = len(m.group(1)) + 1
            out.append("<h{lvl}>{txt}</h{lvl}>".format(lvl=level, txt=render_inline(m.group(2))))
            i += 1
            continue

        if stripped == "---":
            out.append("<hr>")
            i += 1
            continue

        if stripped.startswith(">"):
            quote = []
            while i < len(lines) and lines[i].strip().startswith(">"):
                quote.append(re.sub(r"^\s*>\s?", "", lines[i]))
                i += 1
            out.append("<blockquote>\n  <p>" + render_inline(" ".join(q.strip() for q in quote)) + "</p>\n</blockquote>")
            continue

        if re.match(r"^[-*]\s+", stripped) or re.match(r"^\d{1,9}[.)]\s+", stripped):
            html_list, i = render_list(lines, i, len(lines[i]) - len(lines[i].lstrip()))
            out.append(html_list)
            continue

        if stripped.startswith("|") and i + 1 < len(lines) and is_delimiter_row(lines[i + 1]):
            table_html, i = render_table(lines, i)
            out.append(table_html)
            continue

        if stripped.startswith("<"):
            block = []
            while i < len(lines) and lines[i].strip():
                block.append(lines[i].rstrip())
                i += 1
            out.append("\n".join(block))
            continue

        # Paragraph: consume until a blank line or another block starts. Always
        # consumes at least one line, so a block starter no branch handled
        # (e.g. a "|" line that is not a table) can never loop forever.
        block = []
        while i < len(lines) and lines[i].strip() and not BLOCK_START.match(lines[i].strip()):
            block.append(lines[i].strip())
            i += 1
        if not block:
            block.append(lines[i].strip())
            i += 1
        out.append("<p>" + render_inline(" ".join(block)) + "</p>")

    return "\n".join(out)


# ---------------------------------------------------------------------------
# Post loading
# ---------------------------------------------------------------------------

def parse_post(path):
    text = read(path)
    m = re.match(r"^---\n(.*?)\n---\n(.*)$", text, re.S)
    if not m:
        sys.exit(f"{path.name}: missing frontmatter block (--- title/date/description ---)")
    meta = {}
    for line in m.group(1).split("\n"):
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        meta[key.strip()] = value.strip()
    if not meta.get("title"):
        sys.exit(f"{path.name}: frontmatter needs a title:")
    try:
        date = datetime.date.fromisoformat(meta["date"])
    except (KeyError, ValueError):
        sys.exit(f"{path.name}: frontmatter needs date: YYYY-MM-DD")
    category = meta.get("category", "misc").strip() or "misc"
    if category not in CATEGORIES:
        sys.exit(f"{path.name}: unknown category '{category}' — valid: {', '.join(CATEGORIES)}")
    tags = [t.strip() for t in meta.get("tags", "").split(",") if t.strip()]

    slug = path.stem
    body = render_markdown(m.group(2).strip("\n"))
    return {
        "slug": slug,
        "title": meta["title"],
        "date": date.isoformat(),
        "description": meta.get("description", ""),
        "category": category,
        "tags": tags,
        "body": body,
    }


def load_posts():
    files = sorted(POSTS_SRC.glob("*.md"))
    if not files:
        sys.exit("no posts/*.md files found")
    posts = [parse_post(p) for p in files]
    # Newest first everywhere; ties break by slug so the order is stable.
    posts.sort(key=lambda p: (p["date"], p["slug"]), reverse=True)
    return posts


def excerpt_of(body, limit=165):
    """Fall back to the first <p> as the meta description when the
    frontmatter has none.
    """
    m = re.search(r"<p>(.*?)</p>", body, re.S)
    if not m:
        return ""
    text = html.unescape(re.sub(r"<[^>]+>", " ", m.group(1)))
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) <= limit:
        return text
    cut = text[:limit].rsplit(" ", 1)[0]
    return cut + " …"


# Posts are served from blog/<slug>/ (two levels below the root), but their
# markup is authored relative to pages/ (one level). Push asset URLs one
# level deeper; absolute URLs (the remote video, social links) pass through.
def deepen_paths(body):
    return re.sub(r'((?:src|poster|href)=")\.\./', r"\1../../", body)


def og_image_of(body):
    for pattern in (IMG_RE, POSTER_RE):
        m = pattern.search(body)
        if m:
            return m.group(1)
    return DEFAULT_OG_IMAGE


# ---------------------------------------------------------------------------
# Rendering: blog list, feed, sitemap, single-post pages
# ---------------------------------------------------------------------------

def category_meta_html(post, badge_href):
    """Category pill (+ optional tag chips) shared by the list card and the
    single-post header. The pill links back to the blog list prefiltered.
    """
    tags = "".join(
        '<span class="tag-chip">#{t}</span>'.format(t=html.escape(tag))
        for tag in post["tags"]
    )
    return '<a class="cat-badge" href="{h}">{c}</a>{tags}'.format(
        h=badge_href, c=CATEGORIES[post["category"]], tags=tags,
    )


def render_list_card(post):
    """List-page card: thumbnail + title + category + date + excerpt, linking
    to the single-post page where the full article lives. The thumbnail is the
    post's first image/poster (or the default og image). data-category drives
    the client-side chip filtering in main.js.
    """
    return (
        '<article id="post-{s}" class="blog-card blog-list-card" data-category="{c}" data-reveal>\n'
        '          <a class="post-card-thumb" href="../blog/{s}/" tabindex="-1" aria-hidden="true">\n'
        '            <img src="{thumb}" alt="" loading="lazy" decoding="async">\n'
        "          </a>\n"
        '          <div class="blog-card-body">\n'
        '            <h3><a class="post-link" href="../blog/{s}/" rel="bookmark">{t}</a></h3>\n'
        '            <div class="blog-card-meta">{meta}</div>\n'
        '            <div class="blog-date">Time stamp: {d}</div>\n'
        '            <p class="blog-card-excerpt">{x}</p>\n'
        '            <a class="blog-card-more" href="../blog/{s}/">Read more <i class="fa-solid fa-arrow-right" aria-hidden="true"></i></a>\n'
        "          </div>\n"
        "        </article>"
    ).format(
        s=post["slug"],
        t=html.escape(post["title"]),
        c=post["category"],
        meta=category_meta_html(post, "blog.html?cat=" + post["category"]),
        d=post["date"],
        x=html.escape(post["description"]),
        thumb="../" + post["og_image"],
    )


def render_filter_bar(posts):
    """Category chip toolbar for the blog list: an All chip plus one chip per
    taxonomy category — always all of them, zero counts included. Filtering
    itself is client-side (main.js); only the counts are baked in here.
    """
    counts = {slug: 0 for slug in CATEGORIES}
    for p in posts:
        counts[p["category"]] += 1
    buttons = [
        '          <button type="button" class="blog-filter-btn active" data-cat="all" aria-pressed="true">'
        "All <span class=\"count\">{n}</span></button>".format(n=len(posts))
    ]
    for slug, display in CATEGORIES.items():
        buttons.append(
            '          <button type="button" class="blog-filter-btn" data-cat="{s}" aria-pressed="false">'
            '{d} <span class="count">{n}</span></button>'.format(s=slug, d=display, n=counts[slug])
        )
    return (
        '<div class="blog-filters" role="group" aria-label="Filter posts by category">\n'
        + "\n".join(buttons)
        + "\n          </div>"
    )


def render_toc_li(post, current_slug):
    t = html.escape(post["title"])
    if post["slug"] == current_slug:
        return '            <li><a href="../{s}/" class="active" aria-current="page">{t}</a></li>'.format(s=post["slug"], t=t)
    return '            <li><a href="../{s}/">{t}</a></li>'.format(s=post["slug"], t=t)


def inject_region(source, start, end, content):
    pattern = re.compile(re.escape(start) + r".*?" + re.escape(end), re.S)
    if not pattern.search(source):
        sys.exit(f"marker pair not found in pages/blog.html: {start}")
    return pattern.sub(start + "\n" + content + "\n          " + end, source, count=1)


def update_blog_html(posts):
    source = read(BLOG_HTML)
    cards = "\n\n        ".join(render_list_card(p) for p in posts)
    new_source = inject_region(source, ARTICLES_START, ARTICLES_END, cards)
    new_source = inject_region(new_source, FILTERS_START, FILTERS_END, render_filter_bar(posts))
    if new_source != source:
        write(BLOG_HTML, new_source, "(filters + articles regenerated from posts/)")
    else:
        print("  pages/blog.html already up to date")


def render_feed(posts):
    newest = datetime.date.fromisoformat(posts[0]["date"])
    last_build = email.utils.format_datetime(
        datetime.datetime(newest.year, newest.month, newest.day, tzinfo=datetime.timezone.utc)
    )
    items = []
    for p in posts:
        items.append(
            "    <item>\n"
            "      <title>{t}</title>\n"
            "      <link>{s}/blog/{sl}/</link>\n"
            '      <guid isPermaLink="false">post-{sl}</guid>\n'
            "      <pubDate>{d}</pubDate>\n"
            "      <description>{desc}</description>\n"
            "      <category>{cat}</category>\n"
            "{tagcats}"
            "    </item>".format(
                t=html.escape(p["title"]),
                s=SITE,
                sl=p["slug"],
                d=email.utils.format_datetime(datetime.datetime.fromisoformat(p["date"]).replace(tzinfo=datetime.timezone.utc)),
                desc=html.escape(p["description"]),
                cat=html.escape(CATEGORIES[p["category"]]),
                tagcats="".join(
                    "      <category>{t}</category>\n".format(t=html.escape(tag)) for tag in p["tags"]
                ),
            )
        )
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">\n'
        "  <channel>\n"
        "    <title>Nathan Penny's personal website</title>\n"
        "    <link>{s}/blog</link>\n"
        "    <description>Nathan Penny's blog about anything fun.</description>\n"
        "    <language>en</language>\n"
        '    <atom:link href="{s}/feed.xml" rel="self" type="application/rss+xml"/>\n'
        "    <lastBuildDate>{lb}</lastBuildDate>\n"
        "\n"
        "{items}\n"
        "  </channel>\n"
        "</rss>\n"
    ).format(s=SITE, lb=last_build, items="\n\n".join(items))


def render_sitemap(posts, today):
    entries = ["  <url>\n    <loc>{s}{p}</loc>\n    <lastmod>{d}</lastmod>\n  </url>".format(
        s=SITE, p=p, d=today) for p in STATIC_PATHS]
    entries += ["  <url>\n    <loc>{s}/blog/{sl}/</loc>\n    <lastmod>{d}</lastmod>\n  </url>".format(
        s=SITE, sl=p["slug"], d=p["date"]) for p in posts]
    return ('<?xml version="1.0" encoding="UTF-8"?>\n'
            '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
            + "\n".join(entries) + "\n</urlset>\n")


def render_post_nav(post, posts):
    idx = posts.index(post)
    links = []
    if idx > 0:
        newer = posts[idx - 1]
        links.append('        <a class="post-nav-link" href="../{s}/">&laquo; {t}</a>'.format(
            s=newer["slug"], t=html.escape(newer["title"])))
    else:
        links.append('        <span class="post-nav-placeholder">&laquo; newest post</span>')
    if idx < len(posts) - 1:
        older = posts[idx + 1]
        links.append('        <a class="post-nav-link" href="../{s}/">{t} &raquo;</a>'.format(
            s=older["slug"], t=html.escape(older["title"])))
    else:
        links.append('        <span class="post-nav-placeholder">oldest post &raquo;</span>')
    return "\n".join(links)


def render_related(post, posts):
    """Up to 3 other posts in the same category; the whole section is omitted
    when there are none, so empty categories leave no dead UI. Deliberately
    plain list markup: .blog-card/.blog-date would be picked up by main.js's
    reading-time feature and grow bogus "x min read" spans.
    """
    others = [p for p in posts if p["category"] == post["category"] and p["slug"] != post["slug"]]
    if not others:
        return ""
    items = "\n".join(
        '            <li><a href="../{s}/">{t}</a></li>'.format(s=p["slug"], t=html.escape(p["title"]))
        for p in others[:3]
    )
    return (
        '        <section class="related-posts">\n'
        "          <h3>More in {d}</h3>\n"
        "          <ul>\n{items}\n          </ul>\n"
        "        </section>"
    ).format(d=CATEGORIES[post["category"]], items=items)


def render_post_page(post, posts, og_image):
    slug = post["slug"]
    title = post["title"]
    date = post["date"]
    description = post["description"]
    canonical = "{s}/blog/{sl}/".format(s=SITE, sl=slug)
    esc_desc = html.escape(description, quote=True)
    esc_title = html.escape(title, quote=True)

    jsonld = {
        "@context": "https://schema.org",
        "@type": "BlogPosting",
        "mainEntityOfPage": {"@type": "WebPage", "@id": canonical},
        "headline": title,
        "description": description,
        "image": SITE + "/" + og_image,
        "author": {"@type": "Person", "name": "Nathan Penny", "url": SITE + "/about"},
        "publisher": {"@type": "Person", "name": "Nathan Penny"},
        "datePublished": date,
        "dateModified": date,
        "articleSection": CATEGORIES[post["category"]],
        "keywords": ", ".join([CATEGORIES[post["category"]]] + post["tags"]),
    }

    article_head = (
        "          <h3>{t}</h3>\n"
        '          <div class="post-cats">{meta}</div>\n'
        '          <div class="blog-date">Time stamp: {d}</div>\n'
    ).format(
        t=html.escape(title),
        d=date,
        meta=category_meta_html(post, "../../pages/blog.html?cat=" + post["category"]),
    )

    return """<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <script>
      // Apply the saved color theme before first paint to avoid a flash.
      try {{
        var theme = localStorage.getItem('theme');
        if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
      }} catch (e) {{}}
    </script>
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="color-scheme" content="light dark">
    <link rel="manifest" href="../../manifest.json">
    <meta name="theme-color" content="#f5f7fa" media="(prefers-color-scheme: light)">
    <meta name="theme-color" content="#10161c" media="(prefers-color-scheme: dark)">
    <link rel="apple-touch-icon" href="../../images/icon-180.png">
    <title>{esc_title}{suffix}</title>
    <meta name="description" content="{esc_desc}">
    <meta name="author" content="Nathan Penny">
    <link rel="canonical" href="{canonical}">
    <meta property="og:type" content="article">
    <meta property="og:site_name" content="Nathan Penny's personal website">
    <meta property="og:title" content="{esc_title}">
    <meta property="og:description" content="{esc_desc}">
    <meta property="og:url" content="{canonical}">
    <meta property="og:image" content="{site}/{og_image}">
    <meta property="article:published_time" content="{date}">
    <meta name="twitter:card" content="summary_large_image">
    <link href="../../styles/style.css" rel="stylesheet" type="text/css">
    <link rel="stylesheet" href="../../fonts/fontawesome/css/all.min.css">
    <link rel="icon" type="image/svg+xml" href="../../NP-logo.svg">
    <link rel="alternate" type="application/rss+xml" title="Nathan Penny's blog (RSS)" href="{site}/feed.xml">
    <script type="application/ld+json">
    {jsonld}
    </script>
    <script src="../../scripts/main.js" defer></script>
  </head>
  <body>
    <nav>
      <div class="nav-container">
        <a href="../../index.html" class="nav-brand" aria-label="Go to homepage">
          <img class="site-logo" src="../../NP-logo.svg" alt="Nathan Penny logo">
          <div class="logo">Nathan Penny's personal website <span class="logo-suffix">FOR FUN</span></div>
        </a>

        <ul class="nav-list">
          <li><a href="../../index.html">Home</a></li>
          <li><a href="../../pages/about.html">About</a></li>
          <li><a href="../../pages/blog.html" aria-current="page">Blog</a></li>
          <li><a href="../../pages/gallery.html">Gallery</a></li>
          <li><a href="../../pages/creations.html">Creations</a></li>
          <li><a href="../../pages/achievements.html">Achievements</a></li>
          <li><a href="../../pages/contact.html">Contact</a></li>
        </ul>
        <button id="themeToggle" class="theme-toggle" type="button">
          <i class="fa-solid fa-moon" aria-hidden="true"></i>
        </button>
        <button id="menuToggle" class="menu-toggle" type="button" aria-expanded="false" aria-controls="mobileMenu" aria-label="Open menu">
          <i class="fa-solid fa-bars" aria-hidden="true"></i>
        </button>
      </div>
    </nav>

    <main class="container blog-layout">
      <aside class="blog-sidebar">
        <nav class="blog-toc">
          <h3>Blog Posts</h3>
          <ul>
{toc}
          </ul>
        </nav>
        <p class="back-to-blog"><a href="../../pages/blog.html"><i class="fa-solid fa-chevron-left" aria-hidden="true"></i> All posts</a></p>
      </aside>

      <div class="blog-main">
        <article id="post-{slug}" class="blog-card">
{article_head}{body}
        </article>
{related}
        <nav class="post-nav" aria-label="Adjacent posts">
{post_nav}
        </nav>
      </div>
    </main>

    <!-- Footer content is rendered by main.js initFooter() (single source of truth). -->
    <footer></footer>
  </body>
</html>
""".format(
        esc_title=esc_title,
        esc_desc=esc_desc,
        suffix=PAGE_TITLE_SUFFIX,
        canonical=canonical,
        site=SITE,
        og_image=og_image,
        date=date,
        jsonld=json.dumps(jsonld, indent=4, ensure_ascii=False),
        toc="\n".join(render_toc_li(p, current_slug=slug) for p in posts),
        slug=slug,
        article_head=article_head,
        body=post["page_body"],
        related=render_related(post, posts),
        post_nav=render_post_nav(post, posts),
    )


def main():
    if not BLOG_HTML.exists():
        sys.exit("missing " + str(BLOG_HTML))
    if not POSTS_SRC.exists():
        sys.exit("missing " + str(POSTS_SRC) + " (create posts/<slug>.md files)")

    posts = load_posts()
    for p in posts:
        if not p["description"]:
            p["description"] = excerpt_of(p["body"])
        p["page_body"] = deepen_paths(p["body"])
        p["og_image"] = og_image_of(p["body"])

    today = datetime.date.today().isoformat()
    print("found {} posts: {}".format(len(posts), ", ".join(p["slug"] for p in posts)))

    print("post pages:")
    for p in posts:
        out = POSTS_OUT / p["slug"] / "index.html"
        out.parent.mkdir(parents=True, exist_ok=True)
        write(out, render_post_page(p, posts, p["og_image"]))

    # Prune single-post dirs left behind by deleted posts — blog/ is fully
    # generated, so any dir without a matching post is stale and would stay
    # live out of sync with the feed and sitemap (e.g. a post deleted via the
    # web editor).
    slugs = {p["slug"] for p in posts}
    for child in POSTS_OUT.iterdir():
        if child.is_dir() and child.name not in slugs:
            shutil.rmtree(child)
            print("pruned stale post dir: " + child.name)

    update_blog_html(posts)
    write(SITEMAP, render_sitemap(posts, today))
    write(FEED, render_feed(posts))
    print("done")


if __name__ == "__main__":
    main()
