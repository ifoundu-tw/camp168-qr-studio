(function () {
  'use strict';
  const history = [
    ['1.11.1',[
      '修正部分 Windows 電腦無法連線至 GitHub 檢查更新的問題。',
      '從受影響的舊版更新時，請手動下載並開啟本版 EXE。'
    ]],
    ['1.11.0',[
      '【改圖轉檔】新增圖片拆分，支援水平均分、垂直均分、像素拆分與等比均分。',
      '可批次拖放圖片、預覽切線，並依序匯出 PNG。',
      '版號旁加入【新功能!!】，可查看各版更新日誌。'
    ]],
    ['1.10.0',[
      'QR Code 改用 12 款範本，更新配色、漸層、格點與定位框。',
      '範本縮圖直接顯示實際 QR 造型，批次中央仍保留尾綴數字。'
    ]],
    ['1.9.0',[
      '新增【重新命名】，支援批次改名、排序、新檔名預覽和圖片轉檔。',
      '新增【改圖轉檔】與 MOMO 圖片批次。可將 AI、PSD 與常見圖片等比例置中補白，輸出 1000 × 1000 JPG。',
      '把【條碼生成】、【改圖轉檔】與【重新命名】放到頂端分類。'
    ]],
    ['1.8.2',[
      '程式改名為「美工必備小工具 by yue」。'
    ]],
    ['1.8.1',[
      '清空自訂文字後，條碼下方文字會還原成條碼內容。'
    ]],
    ['1.8.0',[
      '程式顯示版號，啟動時檢查 GitHub 正式版並提示更新。',
      '更新時驗證下載檔 SHA-256 和版號，再替換 EXE 並重新開啟。'
    ]],
    ['1.7.0',[
      '調整窄視窗版面，加入分頁切換並隱藏可見卷軸。'
    ]],
    ['1.6.0',[
      '依字型實際字形邊界將條碼下方文字置中。'
    ]],
    ['1.5.0',[
      '條碼下方文字支援自訂內容、本機字型和與條碼的像素距離。'
    ]],
    ['1.4.0',[
      '解碼錯誤訊息改為繁體中文。'
    ]],
    ['1.3.0',[
      '加入批次條碼產生器，支援多種一維與二維碼制。'
    ]],
    ['1.2.0',[
      '加大中央白底的可調範圍，預覽會自動檢查能否解碼，預設改為高對比。'
    ]],
    ['1.1.0',[
      'QR 格點會因應中央白底調整，並修正本機字型的尺寸控制。'
    ]],
    ['1.0.0',[
      '支援 CAMP168 商品 QR 批次產生，中央顯示商品尾綴數字，可各別匯出 PNG 或 SVG。'
    ]]
  ];

  const trigger = document.getElementById('openChanges');
  const dialog = document.getElementById('changeDialog');
  const content = document.getElementById('changeHistory');
  if (!globalThis.camp168AppVersion) return;
  for (const [version,notes] of history) {
    const section = document.createElement('section');
    const heading = document.createElement('h3');
    heading.textContent = 'v'+version+(version === globalThis.camp168AppVersion ? ' · 目前版本' : '');
    const list = document.createElement('ul');
    for (const note of notes) {
      const item = document.createElement('li');
      item.textContent = note;
      list.append(item);
    }
    section.append(heading,list);
    content.append(section);
  }
  trigger.hidden = false;
  trigger.addEventListener('click',()=>dialog.showModal());
})();
