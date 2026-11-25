(function () {
  'use strict';
  const publishedAt = Date.parse('2026-11-25T19:03:51+08:00');
  const highlightEndsAt = publishedAt + 7*24*60*60*1000;
  const notes = [
    '【改圖轉檔】新增【通用圖片轉檔】，可批次轉換 HEIC、WebP、SVG 和其他可解碼的圖片。',
    '通用圖片轉檔與圖片拆分都可以選擇 JPG 或 PNG。PNG 保留透明度，JPG 把透明區域補白。',
    '日誌顯示目前版本，並在新版推出的一週內亮起【新功能!!】。'
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
