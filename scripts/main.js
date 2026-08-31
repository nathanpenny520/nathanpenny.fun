// Smooth-scroll to a blog post, leaving space for the sticky navigation bar.
// Falls back to an instant jump when the visitor prefers reduced motion.
function scrollToBlogPost(postId) {
  const post = document.getElementById(postId);
  if (!post) return;

  const nav = document.querySelector('nav');
  const offset = nav ? nav.offsetHeight + 20 : 80;
  const top = post.getBoundingClientRect().top + window.scrollY - offset;
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  window.scrollTo({ top: top, behavior: prefersReducedMotion ? 'auto' : 'smooth' });
}

// Filter blog cards by the text entered in the sidebar search box.
function filterBlogs() {
  const searchInput = document.getElementById('blogSearch');
  if (!searchInput) return;

  const query = searchInput.value.toLowerCase().trim();
  const blogMain = document.querySelector('.blog-main');
  if (!blogMain) return;

  const blogCards = blogMain.getElementsByClassName('blog-card');

  for (let i = 0; i < blogCards.length; i++) {
    const card = blogCards[i];
    const cardText = card.textContent.toLowerCase();
    card.style.display = cardText.includes(query) ? "" : "none";
  }
}

// Load Google Analytics 4 tracking script asynchronously.
(function() {
  const GA_ID = 'G-5X78JT0JSQ';
  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`;
  document.head.appendChild(script);

  window.dataLayer = window.dataLayer || [];
  function gtag() {
    window.dataLayer.push(arguments);
  }
  gtag('js',new Date());
  gtag('config', GA_ID);
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

  document.addEventListener('keydown', (event) => {
    if (lightbox.hidden) return;
    if (event.key === 'Escape') closeLightbox();
    if (event.key === 'ArrowLeft') navigateLightbox(-1);
    if (event.key === 'ArrowRight') navigateLightbox(1);
  });
}

function openLightbox(index) {
  const lightbox = document.getElementById('lightbox');
  if (!lightbox || filteredImages.length === 0) return;

  currentLightboxIndex = index;
  showLightboxImage(index);
  lightbox.hidden = false;
  document.body.style.overflow = 'hidden';
}

function closeLightbox() {
  const lightbox = document.getElementById('lightbox');
  if (!lightbox) return;

  lightbox.hidden = true;
  document.body.style.overflow = '';
  currentLightboxIndex = -1;
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

    if (!name || !email || !content) {
      showStatus(status, 'Please fill in all fields.', 'error');
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
        body: JSON.stringify({ name, email, content })
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
    }
  });
}

// WeChat QR code modal on the Contact page.
function initQrModal() {
  const trigger = document.querySelector('.qr-trigger');
  const modal = document.getElementById('qrModal');
  const closeBtn = document.getElementById('qrModalClose');
  if (!trigger || !modal || !closeBtn) return;

  function openModal() {
    modal.hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function closeModal() {
    modal.hidden = true;
    document.body.style.overflow = '';
  }

  trigger.addEventListener('click', openModal);
  closeBtn.addEventListener('click', closeModal);
  modal.addEventListener('click', (event) => {
    if (event.target === modal) closeModal();
  });
  document.addEventListener('keydown', (event) => {
    if (!modal.hidden && event.key === 'Escape') closeModal();
  });
}

// ============================================================================
// THEME TOGGLE (light / dark / follow system)
// ============================================================================

const THEME_KEY = 'theme';

// Current explicit theme: "light", "dark", or undefined (follow system).
function currentTheme() {
  return document.documentElement.dataset.theme || null;
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

function updateThemeToggle() {
  const button = document.getElementById('themeToggle');
  if (!button) return;

  const icon = button.querySelector('i');
  const theme = currentTheme();

  button.className = 'theme-toggle';
  if (theme === 'light') {
    icon.className = 'fa-solid fa-sun';
    button.title = 'Theme: light. Click for dark.';
    button.setAttribute('aria-label', button.title);
  } else if (theme === 'dark') {
    icon.className = 'fa-solid fa-moon';
    button.title = 'Theme: dark. Click to follow system.';
    button.setAttribute('aria-label', button.title);
  } else {
    icon.className = 'fa-solid fa-circle-half-stroke';
    button.title = 'Theme: system. Click for light.';
    button.setAttribute('aria-label', button.title);
  }
}

// Cycle the theme: light -> dark -> follow system -> light.
function initThemeToggle() {
  const button = document.getElementById('themeToggle');
  if (!button) return;

  updateThemeToggle();
  button.addEventListener('click', () => {
    const next = currentTheme() === 'light' ? 'dark' : currentTheme() === 'dark' ? null : 'light';
    applyTheme(next);
    try {
      if (next) localStorage.setItem(THEME_KEY, next);
      else localStorage.removeItem(THEME_KEY);
    } catch (error) {
      // Private browsing may block storage; the toggle still works until reload.
    }
  });
}

// ============================================================================
// BLOG READING EXPERIENCE (progress bar, scrollspy, reading time, back to top)
// ============================================================================

// Thin progress bar at the top of the viewport tracking blog scroll depth.
function initReadingProgress() {
  const blogMain = document.querySelector('.blog-main');
  if (!blogMain) return;

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

// Highlight the table-of-contents entry of the post currently on screen.
function initScrollSpy() {
  const tocLinks = document.querySelectorAll('.blog-toc a[href^="#post-"]');
  if (!tocLinks.length) return;

  const posts = Array.from(tocLinks)
    .map(link => document.getElementById(link.getAttribute('href').slice(1)))
    .filter(Boolean);

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      tocLinks.forEach(link => {
        link.classList.toggle('active', link.getAttribute('href') === `#${entry.target.id}`);
      });
    });
  }, { rootMargin: '-80px 0px -60% 0px' });

  posts.forEach(post => observer.observe(post));
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

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      // Registration is a progressive enhancement; ignore failures silently.
    });
  });
}

// Initialize page-specific features once the DOM is ready.
window.addEventListener('DOMContentLoaded', () => {
  initThemeToggle();
  loadGallery();
  initGallerySearch();
  initCommentForm();
  loadComments();
  initQrModal();
  initReadingProgress();
  initScrollSpy();
  initReadingTime();
  initBackToTop();
  initUfoEasterEgg();
});

registerServiceWorker();
