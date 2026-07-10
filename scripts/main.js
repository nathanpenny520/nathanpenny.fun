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

// Initialize page-specific features once the DOM is ready.
window.addEventListener('DOMContentLoaded', () => {
  initVisitorForm();
  loadVisitorMessages();
});

console.log("script loads successfully!");
