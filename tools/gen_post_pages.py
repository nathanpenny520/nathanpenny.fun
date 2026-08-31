#!/usr/bin/env python3
"""Generate static single-post pages (blog/<slug>/index.html) from the
articles in pages/blog.html, plus a fresh sitemap.xml.

pages/blog.html stays the single source of truth for post content. Workflow
for a new or edited post:

  1. add/edit the <article id="post-..."> block in pages/blog.html
  2. add/edit its <item> in feed.xml (title, description, pubDate)
  3. run this script from the repo root:  python3 tools/gen_post_pages.py

The script (re)writes:
  - blog/<slug>/index.html  one static page per post: full <head> with
                            canonical URL, article og tags and BlogPosting
                            JSON-LD; sidebar with the post list; prev/next
                            links. Reading extras (progress bar, reading
                            time, back to top) attach automatically because
                            main.js hooks on .blog-main / .blog-card.
  - sitemap.xml             the five static pages plus every post
  - feed.xml                only each item's <link>, upgraded from the old
                            blog#post-... anchor form to the post permalink
  - pages/blog.html         only each post's <h3>, wrapped in a rel=bookmark
                            permalink to the single-post page (idempotent)

Everything else is left untouched. Safe to run repeatedly.
"""

import html
import json
import re
import sys
import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BLOG_HTML = ROOT / "pages" / "blog.html"
FEED = ROOT / "feed.xml"
SITEMAP = ROOT / "sitemap.xml"
POSTS_DIR = ROOT / "blog"

SITE = "https://nathanpenny.fun"
STATIC_PATHS = ["/", "/about", "/blog", "/gallery", "/contact"]
PAGE_TITLE_SUFFIX = " | Nathan Penny's blog"

ARTICLE_RE = re.compile(r'<article id="post-([\w-]+)" class="blog-card">(.*?)</article>', re.S)
H3_RE = re.compile(r"<h3>.*?</h3>", re.S)
DATE_RE = re.compile(r"Time stamp:\s*(\d{4}-\d{2}-\d{2})")
IMG_RE = re.compile(r'<img[^>]+src="\.\./([^"]+)"')
POSTER_RE = re.compile(r'<video[^>]+poster="\.\./([^"]+)"')

DEFAULT_OG_IMAGE = "images/og-image.jpg"


def read(path):
    return path.read_text(encoding="utf-8")


def write(path, text, note=""):
    path.write_text(text, encoding="utf-8")
    print(f"  wrote {path.relative_to(ROOT)} {note}")


def excerpt_of(body, limit=165):
    """Fall back to the first <p> as the meta description when feed.xml has none."""
    m = re.search(r"<p>(.*?)</p>", body, re.S)
    if not m:
        return ""
    text = html.unescape(re.sub(r"<[^>]+>", " ", m.group(1)))
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) <= limit:
        return text
    cut = text[:limit].rsplit(" ", 1)[0]
    return cut + " …"


def feed_descriptions():
    """Pull each item's description out of feed.xml, keyed by its guid."""
    descs = {}
    for item in re.findall(r"<item>.*?</item>", read(FEED), re.S):
        guid = re.search(r"<guid[^>]*>(.*?)</guid>", item)
        desc = re.search(r"<description>(.*?)</description>", item, re.S)
        if guid and desc:
            descs[guid.group(1).strip()] = html.unescape(desc.group(1).strip())
    return descs


def extract_posts(source):
    posts = []
    for m in ARTICLE_RE.finditer(source):
        slug, body = m.group(1), m.group(2)
        h3 = H3_RE.search(body)
        title = html.unescape(re.sub(r"<[^>]+>", "", h3.group(0))).strip() if h3 else slug
        date = DATE_RE.search(body)
        posts.append({
            "slug": slug,
            "title": title,
            # Used as datePublished and sitemap lastmod.
            "date": date.group(1) if date else datetime.date.today().isoformat(),
            "body": body,
        })
    return posts


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


def permalink_h3(post):
    return '<h3><a class="post-link" href="../blog/{s}/" rel="bookmark">{t}</a></h3>'.format(
        s=post["slug"], t=post["title"])


def render_sidebar_toc(posts, current_slug):
    lines = []
    for p in posts:
        if p["slug"] == current_slug:
            lines.append('            <li><a href="../{s}/" class="active" aria-current="page">{t}</a></li>'.format(
                s=p["slug"], t=html.escape(p["title"])))
        else:
            lines.append('            <li><a href="../{s}/">{t}</a></li>'.format(
                s=p["slug"], t=html.escape(p["title"])))
    return "\n".join(lines)


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


def render_post_page(post, posts, description, og_image):
    slug = post["slug"]
    title = post["title"]
    date = post["date"]
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
    }

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
    <meta name="theme-color" content="#2c3e50">
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
          <div class="logo">Nathan Penny's personal website FOR FUN</div>
        </a>

        <ul class="nav-list">
          <li><a href="../../index.html">Home</a></li>
          <li><a href="../../pages/about.html">About</a></li>
          <li><a href="../../pages/blog.html">Blog</a></li>
          <li><a href="../../pages/gallery.html">Gallery</a></li>
          <li><a href="../../pages/contact.html">Contact</a></li>
        </ul>
        <button id="themeToggle" class="theme-toggle" type="button">
          <i class="fa-solid fa-moon" aria-hidden="true"></i>
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
{body}
        </article>

        <nav class="post-nav" aria-label="Adjacent posts">
{post_nav}
        </nav>
      </div>
    </main>

    <footer>
      <img class="footer-logo" src="../../NP-logo.svg" alt="Nathan Penny logo">
      <p>&copy; 2026 Nathan Penny's personal website | based on HTML + CSS + JavaScript</p>
    </footer>
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
        toc=render_sidebar_toc(posts, slug),
        slug=slug,
        body=post["page_body"],
        post_nav=render_post_nav(post, posts),
    )


def render_sitemap(posts, today):
    entries = ["  <url>\n    <loc>{s}{p}</loc>\n    <lastmod>{d}</lastmod>\n  </url>".format(
        s=SITE, p=p, d=today) for p in STATIC_PATHS]
    entries += ["  <url>\n    <loc>{s}/blog/{sl}/</loc>\n    <lastmod>{d}</lastmod>\n  </url>".format(
        s=SITE, sl=p["slug"], d=p["date"]) for p in posts]
    return ('<?xml version="1.0" encoding="UTF-8"?>\n'
            '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
            + "\n".join(entries) + "\n</urlset>\n")


def upgrade_feed_links(feed_xml, posts):
    for p in posts:
        feed_xml = feed_xml.replace(
            "<link>{s}/blog#post-{sl}</link>".format(s=SITE, sl=p["slug"]),
            "<link>{s}/blog/{sl}/</link>".format(s=SITE, sl=p["slug"]),
        )
    return feed_xml


def add_permalinks(blog_source, posts):
    """Wrap each post's <h3> in a permalink on the blog list page.

    Operates on the original body (with ../ paths) so the plain-text replace
    finds its match; the deepened copy for the generated page lives in
    page_body and is untouched here.
    """
    for p in posts:
        new_body = H3_RE.sub(lambda _: permalink_h3(p), p["body"], count=1)
        if new_body != p["body"]:
            blog_source = blog_source.replace(p["body"], new_body, 1)
            p["body"] = new_body
    return blog_source


def main():
    if not BLOG_HTML.exists():
        sys.exit("missing " + str(BLOG_HTML))

    posts = extract_posts(read(BLOG_HTML))
    if not posts:
        sys.exit('no <article id="post-..."> blocks found in pages/blog.html')

    descs = feed_descriptions()
    today = datetime.date.today().isoformat()

    print("found {} posts: {}".format(len(posts), ", ".join(p["slug"] for p in posts)))

    print("post pages:")
    for p in posts:
        p["page_body"] = deepen_paths(p["body"])
        p["description"] = descs.get("post-" + p["slug"]) or excerpt_of(p["body"])
        p["og_image"] = og_image_of(p["body"])
        out = POSTS_DIR / p["slug"] / "index.html"
        out.parent.mkdir(parents=True, exist_ok=True)
        write(out, render_post_page(p, posts, p["description"], p["og_image"]))

    write(SITEMAP, render_sitemap(posts, today))

    old_feed = read(FEED)
    new_feed = upgrade_feed_links(old_feed, posts)
    if new_feed != old_feed:
        write(FEED, new_feed, "(item links upgraded to permalinks)")

    old_blog = read(BLOG_HTML)
    new_blog = add_permalinks(old_blog, posts)
    if new_blog != old_blog:
        write(BLOG_HTML, new_blog, "(post titles now link to their single-post pages)")

    print("done")


if __name__ == "__main__":
    main()
