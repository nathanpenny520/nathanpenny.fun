function switchPage(pageId){
  const allPages = document.querySelectorAll('.page');
  allPages.forEach(page =>{
    page.classList.remove('active');
  });

  document.getElementById(pageId).classList.add('active');
}

function filterBlogs() {
  const query = document.getElementById('blogSearch').value.toLowerCase().trim();
  const blogPage = document.getElementById('blog');
  const blogCards = blogPage.getElementsByClassName('blog-card');

  for (let i = 0; i < blogCards.length; i++) {
    const card = blogCards[i];
    const cardText = card.textContent.toLowerCase();
    if (cardText.includes(query)) {
      card.style.display = ""; 
    } else {
      card.style.display = "none";
    }
  }
}

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

console.log("script loads successfully!");