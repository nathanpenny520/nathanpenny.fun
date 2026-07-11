// Smooth-scroll to a blog post, leaving space for the sticky navigation bar.
function scrollToBlogPost(postId) {
  const post = document.getElementById(postId);
  if (!post) return;

  const nav = document.querySelector('nav');
  const offset = nav ? nav.offsetHeight + 20 : 80;
  const top = post.getBoundingClientRect().top + window.scrollY - offset;
  window.scrollTo({ top: top, behavior: 'smooth' });
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

// Cloudflare Worker endpoint that handles visitor form submissions.
const API_URL = 'https://workers.nathanpenny.fun';

// Fetch visitor messages from the backend and render them in the About page.
async function loadVisitorMessages() {
  const list = document.getElementById('visitorList');
  if (!list) return;

  try {
    const response = await fetch(API_URL);
    if (!response.ok) throw new Error('Network response was not ok');

    const data = await response.json();
    list.innerHTML = '';

    if (!Array.isArray(data) || data.length === 0) {
      list.innerHTML = '<p class="visitor-empty">No messages yet. Be the first one!</p>';
      return;
    }

    data.forEach(item => {
      const entry = document.createElement('div');
      entry.className = 'visitor-entry';
      entry.innerHTML = `
        <div class="visitor-meta">
          <strong>${escapeHtml(item.name)}</strong>
          <time>${new Date(item.created_at).toLocaleString()}</time>
        </div>
        <p class="visitor-email">${escapeHtml(item.email)}</p>
      `;
      list.appendChild(entry);
    });
  } catch (error) {
    list.innerHTML = `<p class="visitor-error">Failed to load messages: ${escapeHtml(error.message)}</p>`;
  }
}

// Convert special HTML characters to entities so user content cannot inject markup.
function escapeHtml(text) {
  if (text == null) return '';
  const div = document.createElement('div');
  div.textContent = String(text);
  return div.innerHTML;
}

// Bind the visitor form on the About page and POST its data to the backend.
function initVisitorForm() {
  const form = document.getElementById('visitorForm');
  const status = document.getElementById('formStatus');
  if (!form) return;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    const name = document.getElementById('visitorName').value.trim();
    const email = document.getElementById('visitorEmail').value.trim();

    if (!name || !email) {
      showStatus(status, 'Please fill in all fields.', 'error');
      return;
    }

    const submitButton = form.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    submitButton.textContent = 'Submitting...';
    showStatus(status, '', '');

    try {
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email })
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Submission failed');
      }

      form.reset();
      showStatus(status, 'Submitted successfully!', 'success');
      loadVisitorMessages();
    } catch (error) {
      showStatus(status, 'Error: ' + error.message, 'error');
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = 'Submit';
    }
  });
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

// Initialize page-specific features once the DOM is ready.
window.addEventListener('DOMContentLoaded', () => {
  initVisitorForm();
  loadVisitorMessages();
  loadGallery();
  initGallerySearch();
  initCommentForm();
  loadComments();
});

console.log("script loads successfully!");
