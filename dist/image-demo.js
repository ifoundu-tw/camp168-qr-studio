(function () {
  'use strict';
  const dialog = document.getElementById('imageDemo');
  const stage = document.getElementById('imageDemoStage');
  const heading = document.getElementById('imageDemoTitle');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let finish;

  function play() {
    clearTimeout(finish);
    if (reducedMotion.matches) {
      stage.dataset.demoState = 'done';
      return;
    }
    stage.dataset.demoState = 'ready';
    stage.getBoundingClientRect();
    stage.dataset.demoState = 'playing';
    finish = setTimeout(()=>{ stage.dataset.demoState = 'done'; },2500);
  }

  for (const button of document.querySelectorAll('[data-image-demo]')) {
    button.addEventListener('click',()=>{
      const template = document.getElementById(button.dataset.imageDemo+'DemoTemplate');
      heading.textContent = button.closest('.hero').querySelector('h1').textContent+'示範';
      stage.replaceChildren(template.content.cloneNode(true));
      dialog.showModal();
      play();
    });
  }
  document.getElementById('imageDemoReplay').addEventListener('click',play);
  dialog.addEventListener('close',()=>{
    clearTimeout(finish);
    stage.replaceChildren();
  });
})();
