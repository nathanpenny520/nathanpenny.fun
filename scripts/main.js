function switchPage(pageId){
  const allPages = document.querySelectorAll('.page');
  allPages.forEach(page =>{
    page.classList.remove('active');
  });

  document.getElementById(pageId).classList.add('active');
}

