// Filter blog cards by the active category chip AND the text entered in the
// search bar above the list, and keep the feedback line + clear button in sync.
function filterBlogs() {
  const searchInput = document.getElementById('blogSearch');
  if (!searchInput) return;

  const query = searchInput.value.toLowerCase().trim();
  const blogMain = document.querySelector('.blog-page');
  if (!blogMain) return;

  const activeChip = blogMain.querySelector('.blog-filter-btn.active');
  const cat = (activeChip && activeChip.dataset.cat) || 'all';
  // Chip text is "Anime 1" (name + count span); strip the trailing count.
  const catName = activeChip && cat !== 'all'
    ? activeChip.textContent.replace(/\s*\d+\s*$/, '').trim()
    : '';

  const blogCards = blogMain.querySelectorAll('.blog-card');
  let visible = 0;

  blogCards.forEach(card => {
    const inCat = cat === 'all' || card.dataset.category === cat;
    const show = inCat && card.textContent.toLowerCase().includes(query);
    card.style.display = show ? "" : "none";
    if (show) visible++;
  });

  const clearButton = document.getElementById('blogSearchClear');
  if (clearButton) clearButton.hidden = query === '';

  // Feedback line: hidden normally; otherwise a match count (or an
  // empty-state message) covering the category filter, the search, or both.
  const meta = document.getElementById('blogSearchMeta');
  if (!meta) return;

  if (query === '' && cat === 'all') {
    meta.hidden = true;
  } else {
    meta.hidden = false;
    const q = searchInput.value.trim();
    const scope = cat === 'all' ? '' : ` in ${catName}`;
    const matchClause = query ? ` matching “${q}”` : '';
    if (visible === 0) {
      meta.textContent = cat === 'all'
        ? `No posts match “${q}”.`
        : `No posts${scope}${matchClause}.`;
    } else if (query === '') {
      meta.textContent = `${visible} ${visible === 1 ? 'post' : 'posts'}${scope}.`;
    } else {
      meta.textContent = cat === 'all'
        ? `Found ${visible} ${visible === 1 ? 'post' : 'posts'} matching “${q}”.`
        : `Found ${visible} ${visible === 1 ? 'post' : 'posts'}${scope}${matchClause}.`;
    }
  }
}

// Bind the blog search bar (listeners live here instead of inline handlers).
function initBlogSearch() {
  const searchInput = document.getElementById('blogSearch');
  if (!searchInput) return;

  searchInput.addEventListener('input', filterBlogs);

  const clearButton = document.getElementById('blogSearchClear');
  if (clearButton) {
    clearButton.addEventListener('click', () => {
      searchInput.value = '';
      filterBlogs();
      searchInput.focus();
    });
  }
}

// Category chip toolbar on the blog list: single-select filtering combined
// with the text search, mirrored into the ?cat= query param (replaceState, so
// a filtered state survives a reload; Back simply leaves the page).
function initBlogFilters() {
  const bar = document.querySelector('.blog-filters');
  if (!bar) return;

  const setActive = (chip) => {
    bar.querySelectorAll('.blog-filter-btn').forEach(btn => {
      const on = btn === chip;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    const url = new URL(location.href);
    const cat = chip ? chip.dataset.cat : 'all';
    if (!chip || cat === 'all') url.searchParams.delete('cat');
    else url.searchParams.set('cat', cat);
    history.replaceState(null, '', url);
    filterBlogs();
  };

  bar.addEventListener('click', (event) => {
    const chip = event.target.closest('.blog-filter-btn');
    if (chip) setActive(chip);
  });

  // Deep link: /blog?cat=anime preselects that chip; invalid values fall
  // through to All without touching the URL.
  const requested = new URLSearchParams(location.search).get('cat');
  if (requested) {
    const match = Array.from(bar.querySelectorAll('.blog-filter-btn'))
      .find(btn => btn.dataset.cat === requested);
    if (match) {
      setActive(match);
      return;
    }
  }
  filterBlogs();
}

// Publish the sticky nav's height as a CSS custom property so style.css can
// set scroll-padding-top with it: TOC anchors are plain links and the browser
// does the scrolling natively, no click interception needed.
function initNavScrollPadding() {
  const nav = document.querySelector('nav');
  if (!nav) return;

  const update = () => {
    document.documentElement.style.setProperty('--nav-height', nav.offsetHeight + 'px');
  };
  window.addEventListener('resize', update, { passive: true });
  update();
}

// Load Google Analytics 4 tracking script only after the page has fully
// loaded and the browser is idle. googletagmanager.com is unreachable in
// some regions (e.g. mainland China); loading that late keeps a hanging
// request off the critical path there, while visits that can reach Google
// are still measured normally. (Cloudflare Web Analytics stays instant.)
(function() {
  const GA_ID = 'G-5X78JT0JSQ';

  // Safari lacks requestIdleCallback; a short timeout is an adequate stand-in.
  const whenIdle = window.requestIdleCallback
    ? function(cb) { window.requestIdleCallback(cb, { timeout: 3000 }); }
    : function(cb) { window.setTimeout(cb, 1500); };

  function loadGa() {
    window.dataLayer = window.dataLayer || [];
    function gtag() {
      window.dataLayer.push(arguments);
    }
    gtag('js', new Date());
    gtag('config', GA_ID);

    const script = document.createElement('script');
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`;
    document.head.appendChild(script);
  }

  if (document.readyState === 'complete') {
    whenIdle(loadGa);
  } else {
    window.addEventListener('load', function() { whenIdle(loadGa); }, { once: true });
  }
})();

// Cloudflare Worker endpoint that handles comment submissions.
const API_URL = 'https://workers.nathanpenny.fun';

// Convert special HTML characters to entities so user content cannot inject markup.
function escapeHtml(text) {
  if (text == null) return '';
  const div = document.createElement('div');
  div.textContent = String(text);
  return div.innerHTML;
}

// Update the small status text next to the submit button.
function showStatus(element, message, type) {
  if (!element) return;
  element.textContent = message;
  element.className = 'form-status' + (type ? ' ' + type : '');
}

// ============================================================================
// GALLERY PAGE
// ============================================================================

let galleryImages = [];
let filteredImages = [];
let currentLightboxIndex = -1;

async function loadGallery() {
  const grid = document.getElementById('galleryGrid');
  if (!grid) return;

  try {
    const response = await fetch('../data/gallery.json');
    if (!response.ok) throw new Error('Failed to load gallery data');

    galleryImages = await response.json();
    renderFilters(galleryImages);
    filterGallery();
    initLightbox();
  } catch (error) {
    grid.innerHTML = `<p class="gallery-empty">Failed to load gallery: ${escapeHtml(error.message)}</p>`;
  }
}

function renderFilters(images) {
  const container = document.getElementById('galleryFilters');
  if (!container) return;

  const categories = new Set(images.map(img => img.category).filter(Boolean));
  const sorted = Array.from(categories).sort();

  sorted.forEach(category => {
    const button = document.createElement('button');
    button.className = 'filter-btn';
    button.type = 'button';
    button.dataset.category = category;
    button.textContent = capitalize(category);
    container.appendChild(button);
  });

  container.addEventListener('click', (event) => {
    if (!event.target.classList.contains('filter-btn')) return;

    container.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
    event.target.classList.add('active');
    filterGallery();
  });
}

function filterGallery() {
  const searchInput = document.getElementById('gallerySearch');
  const activeFilter = document.querySelector('.filter-btn.active');
  const category = activeFilter ? activeFilter.dataset.category : 'all';
  const query = searchInput ? searchInput.value.toLowerCase().trim() : '';

  filteredImages = galleryImages.filter(image => {
    const matchesCategory = category === 'all' || image.category === category;
    const matchesSearch = !query ||
      (image.title && image.title.toLowerCase().includes(query)) ||
      (image.description && image.description.toLowerCase().includes(query));
    return matchesCategory && matchesSearch;
  });

  renderGallery(filteredImages);
  updateEmptyState(filteredImages.length === 0);
}

function renderGallery(images) {
  const grid = document.getElementById('galleryGrid');
  if (!grid) return;

  grid.innerHTML = '';

  images.forEach((image, index) => {
    const item = document.createElement('article');
    item.className = 'gallery-item';
    item.setAttribute('role', 'listitem');
    item.setAttribute('tabindex', '0');
    item.dataset.index = index;

    item.innerHTML = `
      <img class="gallery-img" src="${escapeHtml(image.src)}" alt="${escapeHtml(image.title || 'Gallery image')}" loading="lazy">
      <div class="gallery-info">
        <h3>${escapeHtml(image.title || 'Untitled')}</h3>
        <p>${escapeHtml(image.description || '')}</p>
      </div>
    `;

    item.addEventListener('click', () => openLightbox(index));
    item.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openLightbox(index);
      }
    });

    grid.appendChild(item);
  });
}

function updateEmptyState(isEmpty) {
  const emptyMessage = document.getElementById('galleryEmpty');
  if (emptyMessage) emptyMessage.hidden = !isEmpty;
}

function initLightbox() {
  const lightbox = document.getElementById('lightbox');
  if (!lightbox) return;

  document.getElementById('lightboxClose').addEventListener('click', closeLightbox);
  document.getElementById('lightboxPrev').addEventListener('click', () => navigateLightbox(-1));
  document.getElementById('lightboxNext').addEventListener('click', () => navigateLightbox(1));

  lightbox.addEventListener('click', (event) => {
    if (event.target === lightbox) closeLightbox();
  });

  // Esc and focus restore are native to <dialog>; reset state on close.
  lightbox.addEventListener('close', () => {
    document.body.style.overflow = '';
    currentLightboxIndex = -1;
  });

  document.addEventListener('keydown', (event) => {
    if (!lightbox.open) return;
    if (event.key === 'ArrowLeft') navigateLightbox(-1);
    if (event.key === 'ArrowRight') navigateLightbox(1);
  });
}

function openLightbox(index) {
  const lightbox = document.getElementById('lightbox');
  if (!lightbox || filteredImages.length === 0) return;

  currentLightboxIndex = index;
  showLightboxImage(index);
  if (!lightbox.open) {
    lightbox.showModal();
    document.body.style.overflow = 'hidden';
  }
}

function closeLightbox() {
  const lightbox = document.getElementById('lightbox');
  if (!lightbox || !lightbox.open) return;

  lightbox.close();
}

function navigateLightbox(direction) {
  if (filteredImages.length === 0) return;
  currentLightboxIndex = (currentLightboxIndex + direction + filteredImages.length) % filteredImages.length;
  showLightboxImage(currentLightboxIndex);
}

function showLightboxImage(index) {
  const image = filteredImages[index];
  if (!image) return;

  document.getElementById('lightboxImg').src = image.src;
  document.getElementById('lightboxImg').alt = image.title || 'Gallery image';
  document.getElementById('lightboxTitle').textContent = image.title || '';
  document.getElementById('lightboxDescription').textContent = image.description || '';
}

function capitalize(text) {
  return String(text).charAt(0).toUpperCase() + String(text).slice(1);
}

// Bind the gallery search box.
function initGallerySearch() {
  const searchInput = document.getElementById('gallerySearch');
  if (!searchInput) return;

  searchInput.addEventListener('input', filterGallery);
}

// ============================================================================
// CREATIONS (featured songs/videos + music library, with a bottom audio player)
// ============================================================================

// Song queue shared by featured songs and the library: [featured..., library...],
// built once at load. Play controls index THIS array (never the DOM), so
// filtering/searching only toggles visibility and can never desync playback.
let creationSongs = [];
let creationAudio = null;
let currentSongIndex = -1;
let creationSeeking = false;

function creationFormatTime(seconds) {
  const total = Math.max(0, Math.floor(seconds || 0));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function creationCoverHtml(song) {
  if (song.cover) {
    return `<img src="${escapeHtml(song.cover)}" alt="" loading="lazy" decoding="async">`;
  }
  return '<span class="creation-cover-empty"><i class="fa-solid fa-music" aria-hidden="true"></i></span>';
}

function renderCreations(grid, featured, librarySongs) {
  const featuredCount = creationSongs.length - librarySongs.length;

  // Deliberately no links back into the blog: the creations section stands
  // on its own.
  grid.innerHTML = featured.map((item) => {
    if (item.type === 'video') {
      const poster = item.poster ? ` poster="${escapeHtml(item.poster)}"` : '';
      return (
        '<article class="creation-item" role="listitem" data-type="video">' +
        `<video class="creation-video" controls playsinline preload="metadata" src="${escapeHtml(item.src)}"${poster}></video>` +
        `<div class="creation-body"><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.description)}</p></div>` +
        '</article>'
      );
    }
    const songIndex = creationSongs.indexOf(item);
    return (
      '<article class="creation-item" role="listitem" data-type="song">' +
      `<div class="creation-cover">${creationCoverHtml(item)}` +
      `<button class="creation-play" type="button" data-song-index="${songIndex}" aria-label="Play"><i class="fa-solid fa-play" aria-hidden="true"></i></button>` +
      '</div>' +
      `<div class="creation-body"><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.description)}</p></div>` +
      '</article>'
    );
  }).join('');

  const list = document.getElementById('musicList');
  if (list) {
    // Rows are buttons (native keyboard/click semantics); role stays off the
    // container so the button semantics are preserved.
    list.removeAttribute('role');
    list.innerHTML = librarySongs.map((song, i) => (
      `<button class="music-row" type="button" data-song-index="${featuredCount + i}">` +
      `<span class="music-row-cover">${creationCoverHtml(song)}</span>` +
      '<span class="music-row-text">' +
      `<span class="music-row-title">${escapeHtml(song.title)}</span>` +
      `<span class="music-row-sub">${escapeHtml(song.artist)} · ${escapeHtml(song.album)}</span>` +
      '</span>' +
      '<i class="fa-solid fa-play music-row-icon" aria-hidden="true"></i>' +
      '</button>'
    )).join('');
  }
}

function filterCreations(type) {
  document.querySelectorAll('.creation-item').forEach(card => {
    card.classList.toggle('hidden', type !== 'all' && card.dataset.type !== type);
  });
  // The library is all songs: keep it for All/Songs, hide it under Videos.
  const musicSection = document.querySelector('.music-section');
  if (musicSection) musicSection.classList.toggle('hidden', type === 'video');

  const empty = document.getElementById('creationsEmpty');
  if (empty) empty.hidden = document.querySelectorAll('.creation-item:not(.hidden)').length > 0;
}

function initCreationFilters() {
  const filters = document.querySelector('.creations-filters');
  if (!filters) return;

  filters.addEventListener('click', (event) => {
    const chip = event.target.closest('.filter-btn');
    if (!chip) return;
    filters.querySelectorAll('.filter-btn').forEach(btn => {
      const on = btn === chip;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    filterCreations(chip.dataset.type);
  });
}

function initMusicSearch() {
  const searchInput = document.getElementById('musicSearch');
  if (!searchInput) return;

  searchInput.addEventListener('input', () => {
    const query = searchInput.value.toLowerCase().trim();
    let visible = 0;
    document.querySelectorAll('.music-row').forEach(row => {
      const show = row.textContent.toLowerCase().includes(query);
      row.classList.toggle('hidden', !show);
      if (show) visible++;
    });
    const empty = document.getElementById('musicEmpty');
    if (empty) empty.hidden = visible > 0;
  });
}

function initCreationPlayer() {
  const player = document.getElementById('creationPlayer');
  if (!player) return;
  const seek = document.getElementById('creationPlayerSeek');
  const timeEl = document.getElementById('creationPlayerTime');
  const titleEl = document.getElementById('creationPlayerTitle');
  const thumbEl = document.getElementById('creationPlayerThumb');
  const playBtn = document.getElementById('creationPlayerPlay');

  const setPlayIcon = () => {
    if (!creationAudio) return;
    const playing = !creationAudio.paused;
    playBtn.innerHTML = `<i class="fa-solid ${playing ? 'fa-pause' : 'fa-play'}" aria-hidden="true"></i>`;
    playBtn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
  };

  const markActiveRow = () => {
    document.querySelectorAll('.music-row').forEach(row => {
      row.classList.toggle('active', Number(row.dataset.songIndex) === currentSongIndex);
    });
  };

  // One Audio element, created lazily inside the first click gesture — that
  // gesture unlocks audio on iOS, and every later track reuses the element.
  const ensureAudio = () => {
    if (creationAudio) return creationAudio;
    creationAudio = new Audio();
    creationAudio.addEventListener('loadedmetadata', () => {
      seek.max = creationAudio.duration || 0;
    });
    creationAudio.addEventListener('timeupdate', () => {
      if (!creationSeeking) seek.value = creationAudio.currentTime;
      timeEl.textContent = `${creationFormatTime(creationAudio.currentTime)} / ${creationFormatTime(creationAudio.duration)}`;
    });
    creationAudio.addEventListener('ended', () => playSongAt(currentSongIndex + 1)); // wraps
    creationAudio.addEventListener('play', () => { setPlayIcon(); markActiveRow(); });
    creationAudio.addEventListener('pause', setPlayIcon);
    creationAudio.addEventListener('error', setPlayIcon);
    return creationAudio;
  };

  const playSongAt = (index) => {
    if (!creationSongs.length) return;
    const count = creationSongs.length;
    currentSongIndex = ((index % count) + count) % count;
    const song = creationSongs[currentSongIndex];
    const audio = ensureAudio();
    audio.src = song.src;
    titleEl.textContent = song.title;
    thumbEl.innerHTML = song.cover
      ? `<img src="${escapeHtml(song.cover)}" alt="">`
      : '<i class="fa-solid fa-music" aria-hidden="true"></i>';
    player.hidden = false;
    document.body.classList.add('creation-player-open');
    markActiveRow();
    audio.play().catch(setPlayIcon); // e.g. a failed src must not throw
  };

  // Card overlay buttons + library rows (delegated; toggles on the current song).
  document.addEventListener('click', (event) => {
    const trigger = event.target.closest('.creation-play, .music-row');
    if (!trigger) return;
    const index = Number(trigger.dataset.songIndex);
    if (Number.isNaN(index)) return;
    if (index === currentSongIndex && creationAudio) {
      if (creationAudio.paused) creationAudio.play().catch(setPlayIcon);
      else creationAudio.pause();
      return;
    }
    playSongAt(index);
  });

  playBtn.addEventListener('click', () => {
    if (!creationAudio) { playSongAt(0); return; }
    if (creationAudio.paused) creationAudio.play().catch(setPlayIcon);
    else creationAudio.pause();
  });
  document.getElementById('creationPlayerPrev').addEventListener('click', () => playSongAt(currentSongIndex - 1));
  document.getElementById('creationPlayerNext').addEventListener('click', () => playSongAt(currentSongIndex + 1));

  // Drag must win over timeupdate while seeking.
  seek.addEventListener('pointerdown', () => { creationSeeking = true; });
  window.addEventListener('pointerup', () => { creationSeeking = false; });
  seek.addEventListener('input', () => {
    if (creationAudio && creationAudio.duration) creationAudio.currentTime = Number(seek.value);
  });

  // Inline videos and the audio bar must not play over each other; media
  // events don't bubble, so listen in the capture phase.
  document.addEventListener('play', (event) => {
    if (event.target.tagName === 'VIDEO' && creationAudio && !creationAudio.paused) creationAudio.pause();
  }, true);

  // bfcache restore may have left audio paused/frozen; re-sync the icon.
  window.addEventListener('pageshow', setPlayIcon);
}

async function loadCreations() {
  const grid = document.getElementById('creationsGrid');
  if (!grid) return;

  try {
    const featuredRes = await fetch('../data/creations.json');
    if (!featuredRes.ok) throw new Error('failed to load creations data');
    const featured = await featuredRes.json();

    // The library is generated locally (media lives on R2, not in the repo);
    // a failed library fetch must not take the featured cards down with it.
    let librarySongs = [];
    const libraryRes = await fetch('../data/music-library.json');
    if (libraryRes.ok) librarySongs = await libraryRes.json();

    creationSongs = [...featured.filter(item => item.type === 'song'), ...librarySongs];
    renderCreations(grid, featured, librarySongs);
    initCreationFilters();
    initMusicSearch();
    initCreationPlayer();
  } catch (error) {
    grid.innerHTML = `<p class="gallery-empty">Failed to load creations: ${escapeHtml(error.message)}</p>`;
  }
}

// ============================================================================
// COMMENTS (public discussion area on About page)
// ============================================================================

const COMMENTS_API_URL = `${API_URL}/comments`;

async function loadComments() {
  const list = document.getElementById('commentList');
  if (!list) return;

  try {
    const response = await fetch(COMMENTS_API_URL);
    if (!response.ok) throw new Error('Network response was not ok');

    const data = await response.json();
    list.innerHTML = '';

    if (!Array.isArray(data) || data.length === 0) {
      list.innerHTML = '<p class="comment-empty">No comments yet. Be the first!</p>';
      return;
    }

    data.forEach(item => {
      const card = document.createElement('article');
      card.className = 'comment-card';
      card.innerHTML = `
        <div class="comment-header">
          <span class="comment-author">${escapeHtml(item.name)}</span>
          <time class="comment-time">${new Date(item.created_at).toLocaleString()}</time>
        </div>
        <p class="comment-content">${escapeHtml(item.content)}</p>
      `;
      list.appendChild(card);
    });
  } catch (error) {
    list.innerHTML = `<p class="comment-error">Failed to load comments: ${escapeHtml(error.message)}</p>`;
  }
}

function initCommentForm() {
  const form = document.getElementById('commentForm');
  const status = document.getElementById('commentStatus');
  if (!form) return;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    const name = document.getElementById('commentName').value.trim();
    const email = document.getElementById('commentEmail').value.trim();
    const content = document.getElementById('commentContent').value.trim();
    const turnstileToken = form.querySelector('[name="cf-turnstile-response"]')?.value.trim() || '';

    if (!name || !email || !content) {
      showStatus(status, 'Please fill in all fields.', 'error');
      return;
    }

    if (!turnstileToken) {
      showStatus(status, 'Please complete the human check first.', 'error');
      return;
    }

    const submitButton = form.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    submitButton.textContent = 'Posting...';
    showStatus(status, '', '');

    try {
      const response = await fetch(COMMENTS_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, content, 'cf-turnstile-response': turnstileToken })
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Submission failed');
      }

      form.reset();
      showStatus(status, 'Posted successfully!', 'success');
      loadComments();
    } catch (error) {
      showStatus(status, 'Error: ' + error.message, 'error');
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = 'Post Comment';
      // Turnstile tokens are single-use: get a fresh one for the next attempt.
      if (window.turnstile) window.turnstile.reset();
    }
  });
}

// QR code modal on the Contact page; each .qr-trigger carries the QR data
// (WeChat, WeChat Channels).
function initQrModal() {
  const triggers = document.querySelectorAll('.qr-trigger');
  const modal = document.getElementById('qrModal');
  const closeBtn = document.getElementById('qrModalClose');
  const titleEl = document.getElementById('qrModalTitle');
  const imgEl = document.getElementById('qrModalImg');
  if (!triggers.length || !modal || !closeBtn || !titleEl || !imgEl) return;

  function openModal(trigger) {
    titleEl.textContent = trigger.dataset.qrTitle || '';
    imgEl.src = trigger.dataset.qrImg || '';
    imgEl.alt = trigger.dataset.qrAlt || titleEl.textContent;
    modal.setAttribute('aria-label', titleEl.textContent);
    if (!modal.open) {
      modal.showModal();
      document.body.style.overflow = 'hidden';
    }
  }

  function closeModal() {
    modal.close();
  }

  triggers.forEach((trigger) => trigger.addEventListener('click', () => openModal(trigger)));
  closeBtn.addEventListener('click', closeModal);
  modal.addEventListener('click', (event) => {
    if (event.target === modal) closeModal();
  });
  // Esc and focus restore are native to <dialog>.
  modal.addEventListener('close', () => {
    document.body.style.overflow = '';
  });
}

// ============================================================================
// HOME: LATEST POSTS (the three newest entries from feed.xml)
// ============================================================================

// The homepage "Latest posts" cards are rendered client-side from feed.xml,
// which tools/gen_post_pages.py keeps in sync with pages/blog.html. The
// section stays hidden until cards are ready, so a failed fetch just means
// the homepage keeps its original three cards.
function initLatestPosts() {
  const list = document.getElementById('latestPosts');
  const section = document.getElementById('latestPostsSection');
  if (!list || !section) return;

  fetch('./feed.xml')
    .then(response => {
      if (!response.ok) throw new Error('feed unavailable');
      return response.text();
    })
    .then(text => {
      const feed = new DOMParser().parseFromString(text, 'application/xml');
      const items = Array.from(feed.getElementsByTagName('item')).slice(0, 3);
      if (!items.length) throw new Error('empty feed');

      items.forEach(item => {
        const title = item.getElementsByTagName('title')[0]?.textContent || 'Untitled';
        const link = item.getElementsByTagName('link')[0]?.textContent || './pages/blog.html';
        const pub = item.getElementsByTagName('pubDate')[0]?.textContent || '';
        const description = item.getElementsByTagName('description')[0]?.textContent || '';
        const date = pub ? new Date(pub) : null;

        // Feed content is authored in this repo, but everything still goes
        // through textContent — nothing from the feed is ever interpreted.
        const card = document.createElement('a');
        card.className = 'page-card';
        card.href = link;

        const heading = document.createElement('h3');
        heading.textContent = title;

        const body = document.createElement('p');
        if (date && !isNaN(date)) {
          const time = document.createElement('time');
          time.dateTime = date.toISOString().slice(0, 10);
          time.textContent = time.dateTime;
          body.appendChild(time);
          body.appendChild(document.createTextNode(' — '));
        }
        body.appendChild(document.createTextNode(description));

        card.appendChild(heading);
        card.appendChild(body);
        list.appendChild(card);
      });

      section.hidden = false;
    })
    .catch(() => { /* the homepage works fine without the section */ });
}

// ============================================================================
// THEME TOGGLE (light <-> dark; first visit follows the system preference)
// ============================================================================

const THEME_KEY = 'theme';

// The theme currently on screen: an explicit choice, or the system default.
function effectiveTheme() {
  const explicit = document.documentElement.dataset.theme;
  if (explicit === 'light' || explicit === 'dark') return explicit;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

// Apply an explicit theme, or clear it to follow the system preference.
function applyTheme(theme) {
  if (theme === 'light' || theme === 'dark') {
    document.documentElement.dataset.theme = theme;
  } else {
    delete document.documentElement.dataset.theme;
  }
  updateThemeToggle();
}

// The button shows what clicking will switch to: moon in light mode, sun in dark.
function updateThemeToggle() {
  const button = document.getElementById('themeToggle');
  if (!button) return;

  const icon = button.querySelector('i');
  const next = effectiveTheme() === 'dark' ? 'light' : 'dark';

  button.className = 'theme-toggle';
  icon.className = next === 'dark' ? 'fa-solid fa-moon' : 'fa-solid fa-sun';
  button.title = `Switch to ${next} mode`;
  button.setAttribute('aria-label', button.title);
}

function initThemeToggle() {
  const button = document.getElementById('themeToggle');
  if (!button) return;

  updateThemeToggle();
  button.addEventListener('click', () => {
    const next = effectiveTheme() === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch (error) {
      // Private browsing may block storage; the toggle still works until reload.
    }
  });
}

// ============================================================================
// BLOG READING EXPERIENCE (progress bar, scrollspy, reading time, back to top)
// ============================================================================

// Thin progress bar at the top of the viewport tracking blog scroll depth.
// Only on real reading pages (single posts carry a .post-nav); the card list
// page is short and needs no progress bar.
function initReadingProgress() {
  const blogMain = document.querySelector('.blog-main');
  if (!blogMain || !document.querySelector('.post-nav')) return;

  const bar = document.createElement('div');
  bar.id = 'readingProgress';
  document.body.appendChild(bar);

  const update = () => {
    const rect = blogMain.getBoundingClientRect();
    const total = rect.height - window.innerHeight;
    const scrolled = Math.min(Math.max(-rect.top, 0), Math.max(total, 1));
    bar.style.transform = `scaleX(${total > 0 ? scrolled / total : 0})`;
  };

  document.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', update);
  update();
}

// Append an estimated reading time to each post's date line.
// CJK characters and Latin words are counted with separate speeds.
function initReadingTime() {
  const cards = document.querySelectorAll('.blog-card');
  if (!cards.length) return;

  cards.forEach(card => {
    const date = card.querySelector('.blog-date');
    if (!date || date.querySelector('.reading-time')) return;

    const text = card.textContent || '';
    const cjkChars = (text.match(/[一-鿿぀-ヿ]/g) || []).length;
    const latinWords = text.replace(/[一-鿿぀-ヿ]/g, ' ').split(/\s+/).filter(Boolean).length;
    const minutes = Math.max(1, Math.round(cjkChars / 400 + latinWords / 200));

    const span = document.createElement('span');
    span.className = 'reading-time';
    span.textContent = ` · ~${minutes} min read`;
    date.appendChild(span);
  });
}

// Floating back-to-top button on every page.
function initBackToTop() {
  const button = document.createElement('button');
  button.id = 'backToTop';
  button.type = 'button';
  button.setAttribute('aria-label', 'Back to top');
  button.innerHTML = '<i class="fa-solid fa-arrow-up" aria-hidden="true"></i>';
  document.body.appendChild(button);

  const update = () => button.classList.toggle('visible', window.scrollY > 600);
  document.addEventListener('scroll', update, { passive: true });
  update();

  button.addEventListener('click', () => {
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, behavior: prefersReducedMotion ? 'auto' : 'smooth' });
  });
}

// ============================================================================
// STARFIELD (a fixed full-page canvas behind the content: stars, meteors, and
// the occasional rock that comes down and hits the page. The aurora drift in
// the hero is pure CSS on top of it.)
// ============================================================================

// Rebuild the starfield to fill the current viewport.
function skyBuildStars(canvas) {
  const area = canvas.clientWidth * canvas.clientHeight;
  const count = Math.min(200, Math.max(70, Math.round(area / 5500)));
  const stars = [];

  for (let i = 0; i < count; i++) {
    stars.push({
      x: Math.random() * canvas.clientWidth,
      y: Math.random() * canvas.clientHeight,
      r: 0.3 + Math.random() * 1.1,
      alpha: 0.2 + Math.random() * 0.6,
      speed: 0.3 + Math.random() * 0.9,   // twinkle speed
      phase: Math.random() * Math.PI * 2,
      depth: 0.3 + Math.random() * 0.7    // parallax strength
    });
  }
  return stars;
}

// A burst of short-lived orange sparks flying out of the impact point.
function skySpawnSparks(state, x, y) {
  const colors = ['#ffe8b0', '#ffc46b', '#ff9f43', '#ff7b54'];

  for (let i = 0; i < 26; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 1.5 + Math.random() * 3.5;
    state.sparks.push({
      x: x,
      y: y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 1.5,  // bias upward
      life: 1,
      color: colors[Math.floor(Math.random() * colors.length)]
    });
  }
}

// Flash, shockwave ring, sparks, and a brief shake of the page content.
function skyImpact(state, x, y) {
  skySpawnSparks(state, x, y);

  const main = document.querySelector('main');
  if (main) {
    main.classList.remove('impact-shake');
    void main.offsetWidth;  // restart the animation if one just finished
    main.classList.add('impact-shake');
    setTimeout(() => main.classList.remove('impact-shake'), 600);
  }

  [['impact-flash', 600], ['impact-wave', 850]].forEach(([cls, ttl]) => {
    const el = document.createElement('div');
    el.className = cls;
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    el.addEventListener('animationend', () => el.remove());
    document.body.appendChild(el);
    setTimeout(() => el.remove(), ttl);  // safety net if animationend is missed
  });
}

// One animation frame: twinkle the stars, ease the parallax, throw the odd
// meteor, and every so often drop a rock that hits the page.
function skyDrawFrame(state, now) {
  const ctx = state.ctx;
  const w = state.canvas.clientWidth;
  const h = state.canvas.clientHeight;

  ctx.clearRect(0, 0, w, h);

  // Ease the mouse parallax toward where the mouse points; scrolling shifts
  // the sky slightly too, which adds depth as the content moves over it.
  state.parallaxX += (state.targetX - state.parallaxX) * 0.05;
  state.parallaxY += (state.targetY - state.parallaxY) * 0.05;

  const rgb = state.effectiveTheme() === 'dark' ? '255, 255, 255' : '44, 62, 80';
  const t = now / 1000;

  for (const star of state.stars) {
    const twinkle = 0.55 + 0.45 * Math.sin(t * star.speed + star.phase);
    // Wrap coordinates so parallax and scroll shifts never bare an edge.
    const x = ((star.x + state.parallaxX * star.depth) % w + w) % w;
    const y = ((star.y + state.parallaxY * star.depth - state.scrollY * 0.06 * star.depth) % h + h) % h;

    ctx.fillStyle = `rgba(${rgb}, ${star.alpha * twinkle})`;
    ctx.beginPath();
    ctx.arc(x, y, star.r, 0, Math.PI * 2);
    ctx.fill();

    if (star.r > 1.2) {
      // The few biggest stars get a faint halo so the sky has depth.
      ctx.fillStyle = `rgba(${rgb}, ${star.alpha * twinkle * 0.15})`;
      ctx.beginPath();
      ctx.arc(x, y, star.r * 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Occasional meteor streaking across the sky.
  if (!state.meteor && now > state.nextShootAt) {
    state.meteor = {
      x: w * (0.15 + Math.random() * 0.7),
      y: h * (0.08 + Math.random() * 0.3),
      vx: -(4 + Math.random() * 3),
      vy: 1.6 + Math.random() * 1.2,
      life: 1
    };
  }

  if (state.meteor) {
    const meteor = state.meteor;
    meteor.x += meteor.vx;
    meteor.y += meteor.vy;
    meteor.life -= 0.016;

    if (meteor.life <= 0) {
      state.meteor = null;
      state.nextShootAt = now + 9000 + Math.random() * 11000;
    } else {
      const alpha = Math.min(meteor.life * 3, (1 - meteor.life) * 5, 0.9);
      const grad = ctx.createLinearGradient(
        meteor.x, meteor.y,
        meteor.x - meteor.vx * 14, meteor.y - meteor.vy * 14
      );
      grad.addColorStop(0, `rgba(${rgb}, ${alpha})`);
      grad.addColorStop(1, `rgba(${rgb}, 0)`);
      ctx.strokeStyle = grad;
      ctx.lineWidth = 1.6;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(meteor.x, meteor.y);
      ctx.lineTo(meteor.x - meteor.vx * 14, meteor.y - meteor.vy * 14);
      ctx.stroke();
    }
  }

  // Every so often: a bigger rock, accelerating down toward a random point.
  if (!state.rock && now > state.nextImpactAt) {
    if (now - state.nextImpactAt > 20000) {
      state.nextImpactAt = now + 20000;  // the tab slept; don't slam on return
    } else {
      const x0 = w * (0.2 + Math.random() * 0.6);
      const y0 = -60;
      const tx = w * (0.15 + Math.random() * 0.7);
      const ty = h * (0.45 + Math.random() * 0.4);
      const len = Math.hypot(tx - x0, ty - y0) || 1;
      state.rock = {
        x0: x0,
        y0: y0,
        tx: tx,
        ty: ty,
        ux: (tx - x0) / len,
        uy: (ty - y0) / len,
        t: 0,
        dur: 55 + Math.random() * 25  // frames
      };
    }
  }

  if (state.rock) {
    const rock = state.rock;
    rock.t += 1;
    const p = Math.min(rock.t / rock.dur, 1);
    const ease = p * p;  // gravity: the rock accelerates on the way down
    const x = rock.x0 + (rock.tx - rock.x0) * ease;
    const y = rock.y0 + (rock.ty - rock.y0) * ease;
    const trail = 60 + p * 60;  // the tail stretches as it speeds up

    const grad = ctx.createLinearGradient(x, y, x - rock.ux * trail, y - rock.uy * trail);
    grad.addColorStop(0, 'rgba(255, 214, 140, 0.95)');
    grad.addColorStop(1, 'rgba(255, 120, 60, 0)');
    ctx.strokeStyle = grad;
    ctx.lineWidth = 3.2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - rock.ux * trail, y - rock.uy * trail);
    ctx.stroke();

    ctx.fillStyle = 'rgba(255, 190, 110, 0.35)';  // glow around the head
    ctx.beginPath();
    ctx.arc(x, y, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff2d0';  // the hot head itself
    ctx.beginPath();
    ctx.arc(x, y, 2.6, 0, Math.PI * 2);
    ctx.fill();

    if (p >= 1) {
      skyImpact(state, rock.tx, rock.ty);
      state.rock = null;
      state.nextImpactAt = now + 35000 + Math.random() * 30000;
    }
  }

  // Impact sparks: short-lived, with a bit of gravity.
  for (let i = state.sparks.length - 1; i >= 0; i--) {
    const spark = state.sparks[i];
    spark.x += spark.vx;
    spark.y += spark.vy;
    spark.vy += 0.12;
    spark.life -= 0.02;

    if (spark.life <= 0) {
      state.sparks.splice(i, 1);
      continue;
    }

    ctx.globalAlpha = Math.min(spark.life * 1.4, 1);
    ctx.fillStyle = spark.color;
    ctx.beginPath();
    ctx.arc(spark.x, spark.y, 1.6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// Wire up the full-page sky: it only animates in dark mode, and only while
// the tab is visible. Reduced motion gets a still sky with no events.
function initStarField() {
  const canvas = document.getElementById('starField');
  if (!canvas || !canvas.getContext) return;

  const ctx = canvas.getContext('2d');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const state = {
    canvas,
    ctx,
    stars: [],
    meteor: null,
    rock: null,
    sparks: [],
    nextShootAt: performance.now() + 5000 + Math.random() * 7000,
    nextImpactAt: performance.now() + 8000 + Math.random() * 6000,  // an early showpiece, then rare
    parallaxX: 0,
    parallaxY: 0,
    targetX: 0,
    targetY: 0,
    scrollY: 0,
    effectiveTheme,  // shared with the theme-toggle feature below
    rafId: 0,
    running: false
  };

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = canvas.clientWidth * dpr;
    canvas.height = canvas.clientHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    state.stars = skyBuildStars(canvas);
    // Keep still-sky modes (reduced motion) painted after a rebuild.
    if (!state.running) skyDrawFrame(state, performance.now());
  }

  function start() {
    if (state.running) return;
    if (effectiveTheme() !== 'dark') return;  // stars belong to the night sky only
    state.running = true;
    state.rafId = requestAnimationFrame(skyLoop);
  }

  function stop() {
    state.running = false;
    cancelAnimationFrame(state.rafId);
  }

  function skyLoop(now) {
    if (!state.running) return;
    skyDrawFrame(state, now);
    state.rafId = requestAnimationFrame(skyLoop);
  }

  // Light mode shows only the pastel sky (CSS hides the canvas there too,
  // this just stops the wasted animation frames).
  function syncTheme() {
    if (effectiveTheme() === 'dark') {
      start();
    } else {
      stop();
      ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
    }
  }

  // Rebuild the starfield once the page has fully loaded and laid out: at
  // DOMContentLoaded time the canvas dimensions can still be 0 (web font and
  // layout pending), which would leave an empty sky until the next resize.
  let layoutTimer = 0;
  function scheduleResize() {
    if (layoutTimer) cancelAnimationFrame(layoutTimer);
    layoutTimer = requestAnimationFrame(resize);
  }

  resize();
  window.addEventListener('resize', scheduleResize);
  window.addEventListener('load', scheduleResize);
  window.addEventListener('scroll', () => { state.scrollY = window.scrollY; }, { passive: true });

  if (reducedMotion) return;  // a still sky, drawn once by resize() above

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stop();
    } else {
      start();
      layoutTimer = requestAnimationFrame(resize);  // stars may need rebuilding after the tab slept
    }
  });

  document.addEventListener('mousemove', (event) => {
    state.targetX = (event.clientX / window.innerWidth - 0.5) * 26;
    state.targetY = (event.clientY / window.innerHeight - 0.5) * 26;
  }, { passive: true });

  const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
  if (darkQuery.addEventListener) darkQuery.addEventListener('change', syncTheme);
  new MutationObserver(syncTheme).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme']
  });

  start();
}

// Reveal-on-scroll for elements tagged with data-reveal. Elements stay visible
// without JS; with reduced motion they simply never get hidden.
function initScrollReveal() {
  const targets = document.querySelectorAll('[data-reveal]');
  if (!targets.length) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const el = entry.target;
      el.classList.add('is-visible');
      observer.unobserve(el);
      // Drop the helper classes once revealed so card hover transitions
      // don't inherit the slower reveal transition and its delay.
      setTimeout(() => el.classList.remove('will-reveal', 'is-visible'), 1200);
    });
  }, { threshold: 0.15 });

  targets.forEach(el => {
    el.classList.add('will-reveal');
    observer.observe(el);
  });
}

// ============================================================================
// UFO EASTER EGG
// ============================================================================

const UFO_MESSAGES = [
  '🛸 Abduction successful! You are visitor #42 in the ship.',
  '👽 "We came for the FIFA world cup too."',
  '🛸 The UFO society of Tsinghua greets you.',
  '👽 "Nice website. Take us to your blogger."',
  '🛸 You caught it! Fuel refilled: +1 curiosity.',
  '👽 "WanZai song on repeat until further notice."',
  '🛸 Beam me another blog post!',
  '👽 "Violet Evergarden is intergalactic cinema."'
];

const UFO_ACHIEVEMENTS = {
  3: '🏅 Achievement unlocked: UFO Hunter (3 catches)!',
  10: '🏆 Legendary: 10 UFOs caught. They know your name now.'
};

// Small feedback toast at the bottom of the screen.
function showToast(message) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  document.body.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 350);
  }, 4000);
}

// Spawn one UFO that flies across the screen; clicking it "abducts" it.
function spawnUfo() {
  if (document.querySelector('.ufo')) return;

  const ufo = document.createElement('button');
  ufo.type = 'button';
  ufo.className = 'ufo';
  ufo.setAttribute('aria-label', 'Catch the UFO!');
  ufo.innerHTML = '<span aria-hidden="true">🛸</span>';
  ufo.style.top = `${8 + Math.random() * 22}vh`;

  if (Math.random() < 0.5) ufo.classList.add('ufo-rtl');
  ufo.style.animationDuration = `${7 + Math.random() * 4}s`;
  document.body.appendChild(ufo);

  const remove = () => ufo.remove();
  ufo.addEventListener('animationend', (event) => {
    // Only react to the flight animation, not the wobble of the inner span.
    if (event.target === ufo) remove();
  });

  ufo.addEventListener('click', () => {
    if (ufo.classList.contains('caught')) return;
    ufo.classList.add('caught');

    let catches = 0;
    try {
      catches = parseInt(localStorage.getItem('ufoCatches') || '0', 10) + 1;
      localStorage.setItem('ufoCatches', String(catches));
    } catch (error) {
      catches = 1;
    }

    if (UFO_ACHIEVEMENTS[catches]) showToast(UFO_ACHIEVEMENTS[catches]);
    else showToast(UFO_MESSAGES[Math.floor(Math.random() * UFO_MESSAGES.length)]);

    setTimeout(remove, 800);
  });
}

// Schedule UFO fly-bys at random intervals (skipped for reduced motion).
function initUfoEasterEgg() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const schedule = (min, max) => {
    setTimeout(() => {
      spawnUfo();
      schedule(45, 90);
    }, (min + Math.random() * (max - min)) * 1000);
  };

  schedule(15, 30);
}

// ============================================================================
// PROGRESSIVE WEB APP (offline support + installable)
// ============================================================================

// Register the service worker so the site works offline and can be installed.
function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (window.location.protocol !== 'https:' && window.location.hostname !== 'localhost') return;

  // Resolve sw.js relative to this script's own URL, not the document: pages
  // live at several depths (/pages/, /blog/<slug>/) and a document-relative
  // './sw.js' would 404 everywhere but the homepage. Script-relative resolution
  // also survives hosts that serve the site under a subpath.
  const base = (document.currentScript && document.currentScript.src) || window.location.href;
  const swUrl = new URL('../sw.js', base).href;

  window.addEventListener('load', () => {
    navigator.serviceWorker.register(swUrl).catch(() => {
      // Registration is a progressive enhancement; ignore failures silently.
    });
  });
}

// Initialize page-specific features once the DOM is ready.
window.addEventListener('DOMContentLoaded', () => {
  initThemeToggle();
  initLatestPosts();
  initBlogSearch();
  initBlogFilters();
  initNavScrollPadding();
  loadGallery();
  initGallerySearch();
  loadCreations();
  initCommentForm();
  loadComments();
  initQrModal();
  initReadingProgress();
  initReadingTime();
  initBackToTop();
  initStarField();
  initScrollReveal();
  initUfoEasterEgg();
});

registerServiceWorker();
