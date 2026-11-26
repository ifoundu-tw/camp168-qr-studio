(function () {
  'use strict';
  const publishedAt = Date.parse('2026-11-25T19:12:56+08:00');
  const highlightEndsAt = publishedAt + 7*24*60*60*1000;
  const notes = [
    'MOMO 圖片批次和圖片拆分新增【看示範】，可播放原圖到輸出的動畫。',
    '程式圖示換成綠色鱷魚玩偶。'
  ];

  const version = globalThis.camp168AppVersion;
  if (!version) return;
  const trigger = document.getElementById('openChanges');
  const dialog = document.getElementById('changeDialog');
  const heading = document.getElementById('changeTitle');
  const list = document.createElement('ul');
  heading.textContent = 'v'+version+' 更新日誌';
  for (const note of notes) {
    const item = document.createElement('li');
    item.textContent = note;
    list.append(item);
  }
  document.getElementById('changeHistory').append(list);

  let expiryTimer;
  function updateLabel() {
    clearTimeout(expiryTimer);
    const now = Date.now();
    const fresh = now >= publishedAt && now < highlightEndsAt;
    trigger.textContent = fresh ? '新功能!!' : '更新日誌';
    trigger.classList.toggle('fresh',fresh);
    if (fresh) expiryTimer = setTimeout(updateLabel,highlightEndsAt-now);
  }
  updateLabel();
  globalThis.addEventListener('focus',updateLabel);
  trigger.hidden = false;
  trigger.addEventListener('click',()=>dialog.showModal());
})();
