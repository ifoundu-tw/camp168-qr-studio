
(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  if (globalThis.camp168AppVersion) {
    $('appVersion').textContent = 'v'+globalThis.camp168AppVersion;
    $('appVersion').hidden = false;
  }
  const desktop = globalThis.camp168SystemFonts ? window.chrome?.webview : null;
  if (globalThis.camp168SystemFonts?.length) {
    for (const select of [$('fontFamily'),$('barcodeFont')]) {
      const group = document.createElement('optgroup');
      group.label = '本機已安裝字型';
      for (const entry of globalThis.camp168SystemFonts) {
        group.append(new Option(entry.label,'local:'+entry.family));
      }
      select.append(group);
    }
  }
  const controls = [...document.querySelectorAll('[data-setting]')];
  const barcodeControls = [...document.querySelectorAll('[data-barcode-setting]')];
  const barcodeControlValue = el => el.type === 'checkbox' ? el.checked : el.type === 'number' ? el.valueAsNumber : el.value;
  const barcodeDefaults = Object.fromEntries(barcodeControls.map(el=>[el.dataset.barcodeSetting,barcodeControlValue(el)]));
  let barcodeStyle = {...barcodeDefaults};
  let barcodeImport;
  const paneButtons = [...document.querySelectorAll('[data-pane-target]')];
  const narrowView = matchMedia('(max-width: 699px)');
  const shell = document.querySelector('.app-shell');
  function selectPane(pane) {
    shell.dataset.pane = pane;
    for (const button of paneButtons) button.setAttribute('aria-pressed',button.dataset.paneTarget===pane);
  }
  paneButtons.forEach(button=>button.addEventListener('click',()=>selectPane(button.dataset.paneTarget)));
  narrowView.addEventListener('change',({matches})=>{
    if (!matches && shell.dataset.pane === 'preview') selectPane('content');
  });
  const core = CampQR;
  const {UserError,errorMessage} = core;
  const storageKey = 'camp168-qr-templates-v1';
  const svgType = 'image/svg+xml';
  let mode = 'batch', settings = core.presetAt(0), activePreset = 0;
  let items = [], activeItem = '', inputBlocked = false, busy = false;
  let renderedUrl, validationTimer, editRevision = 0, decoderPromise, scanRevision = 0;
  let cacheKey, cacheEncoder;
  const enums = new Map(controls.filter(el => el.tagName === 'SELECT')
    .map(el => [el.dataset.setting, [...el.options].map(option => option.value)]));
  let requestId = 0;
  const desktopRequests = new Map();
  desktop?.addEventListener('message', ({data}) => {
    const pending = desktopRequests.get(data.id);
    if (!pending) return;
    desktopRequests.delete(data.id);
    if (data.error) pending.reject(new UserError(data.error));
    else pending.resolve(data.value);
  });
  function desktopRequest(action, argumentsForAction = {}) {
    const id = ++requestId;
    return new Promise((resolve,reject) => {
      desktopRequests.set(id,{resolve,reject});
      try { desktop.postMessage(JSON.stringify({id,action,...argumentsForAction})); }
      catch (error) { desktopRequests.delete(id); reject(error); }
    });
  }

  const singleFields = {
    url: '<label>網址<input id="singleMain" type="url" placeholder="https://example.com"></label>',
    text: '<label>文字<textarea id="singleMain" rows="3"></textarea></label>',
    wifi: '<div class="settings-grid"><label>網路名稱<input id="singleMain"></label><label>加密<select id="singleSecurity"><option value="WPA">WPA / WPA2</option><option value="WEP">WEP</option><option value="nopass">開放網路</option></select></label><label>密碼<input id="singleExtra" type="password"></label></div>',
    email: '<div class="settings-grid"><label>收件人<input id="singleMain" type="email"></label><label>主旨<input id="singleExtra"></label><label>內容<textarea id="singleBody" rows="2"></textarea></label></div>',
    phone: '<label>電話號碼<input type="tel" id="singleMain" placeholder="+886912345678"></label>',
    sms: '<div class="settings-grid"><label>電話號碼<input type="tel" id="singleMain"></label><label>簡訊內容<textarea id="singleExtra" rows="2"></textarea></label></div>'
  };
  const value = id => $(id)?.value ?? '';
  const itemNow = () => items.find(item => item.name === activeItem);
  const status = (id, text) => { $(id).textContent = text; $(id).hidden = !text; };

  function buildBarcodeList() {
    const groups = {
      common:'BarcodeOcean 選單與二維碼',
      linear:'其他一維條碼',
      matrix:'其他二維與堆疊式條碼',
      postal:'郵政條碼'
    };
    for (const [kind,label] of Object.entries(groups)) {
      const group = document.createElement('optgroup');
      group.label = label;
      for (const entry of CampBarcode.catalog) {
        if ((entry.common ? 'common' : entry.kind) === kind) group.append(new Option(entry.label,entry.id));
      }
      $('barcodeType').append(group);
    }
  }

  function barcodeFields() {
    const spec = CampBarcode.get(value('barcodeType'));
    $('barcodeContent').placeholder = spec.sample;
    $('barcodeHint').textContent = spec.hint || '可用「帶入範例」查看此碼種的資料格式。';
    $('barcodeHeightField').hidden = spec.kind !== 'linear';
    $('barcodeTextFields').hidden = spec.kind === 'matrix';
    $('barcodeTextSettings').hidden = !barcodeStyle.text;
  }

  function syncSettings() {
    for (const el of controls) {
      if (el.type === 'checkbox') el.checked = settings[el.dataset.setting];
      else el.value = settings[el.dataset.setting];
    }
    syncFields();
  }

  function syncFields() {
    $('widthValue').value = settings.width + '%';
    $('xValue').value = settings.x + '%';
    $('yValue').value = settings.y + '%';
    $('ink2Field').hidden = settings.paint === 'solid';
    $('angleField').hidden = settings.paint !== 'linear';
    $('textField').hidden = settings.center !== 'text';
    $('logoField').hidden = settings.center !== 'logo';
    const hasText = settings.center === 'digits' || settings.center === 'text';
    $('fontField').hidden = !hasText;
    $('fontSizeField').hidden = !hasText;
    $('presetName').textContent = activePreset === null ? '自訂' : core.presets[activePreset].name;
    [...$('presets').children].forEach((button,i) => button.setAttribute('aria-pressed', i === activePreset));
  }

  function buildPresets() {
    core.presets.forEach((preset, i) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.title = preset.name;
      button.setAttribute('aria-label', preset.name);
      const swatch = document.createElement('span');
      swatch.className = 'swatch';
      swatch.setAttribute('aria-hidden','true');
      swatch.style.setProperty('--swatch', preset.ink);
      swatch.style.setProperty('--round', preset.module === 'dot' ? '50%' : preset.module === 'soft' ? '35%' : '0');
      for (let j=0; j<9; j++) swatch.append(document.createElement('span'));
      button.append(swatch);
      button.addEventListener('click', () => {
        const retained = {center:settings.center, text:settings.text, logo:settings.logo,
          width:settings.width, fontSize:settings.fontSize};
        if (settings.font.startsWith('local:')) retained.font = settings.font;
        settings = {...core.presetAt(i), ...retained};
        activePreset = i;
        syncSettings();
        render();
      });
      $('presets').append(button);
    });
  }

  function refreshItems() {
    let error = '';
    if (mode === 'batch') {
      const parsed = core.parseBatch(value('suffix'), value('base'));
      items = parsed.items;
      if (parsed.badBase) error = '請輸入有效的商品網址前綴。可用 {suffix} 指定替換位置。';
      if (parsed.invalid.length) error += (error ? ' ' : '') + '請修正尾綴：' + parsed.invalid.slice(0,8).join('、') + (parsed.invalid.length > 8 ? ' 等' : '') + '。';
      $('count').textContent = items.length + ' 筆' + (parsed.duplicates ? '，已合併 ' + parsed.duplicates + ' 筆重複' : '');
    } else if (mode === 'barcode') {
      const id = value('barcodeType');
      const input = value('barcodeContent');
      const rows = (barcodeImport?.input === input ? barcodeImport.rows : input.split(/\r?\n/))
        .filter(row=>row.trim().length);
      items = rows.map((target,index)=>({target,barcode:id,name:id+'-'+String(index+1).padStart(3,'0')}));
      $('barcodeCount').textContent = items.length+' 筆';
    } else {
      try {
        const target = core.singleTarget(value('contentType'), {
          main:value('singleMain'),extra:value('singleExtra'),body:value('singleBody'),security:value('singleSecurity')
        });
        items = target ? [{name:'camp168-qr',target,digits:''}] : [];
      } catch (e) {
        items = [];
        error = errorMessage(e,'無法處理這筆資料。請檢查內容格式。');
      }
    }
    inputBlocked = Boolean(error);
    status('inputError',error);
    if (!itemNow()) activeItem = items[0]?.name || '';
    $('previewItem').replaceChildren(...items.map((item,index) => new Option(
      mode === 'single' ? '單筆 QR Code' : item.barcode ? (index+1)+' · '+item.target.slice(0,70).replace(/\s+/g,' ') : item.name,
      item.name, false, item.name === activeItem
    )));
    $('previewItem').disabled = items.length < 2;
    render();
  }

  function updateButtons() {
    $('downloadOne').disabled = busy || !$('qrImage').getAttribute('src');
    $('downloadAll').disabled = busy || !items.length || inputBlocked;
  }

  function syncFontSize(max,actual) {
    const slider = document.querySelector('[data-setting="fontSize"]');
    slider.disabled = !max;
    slider.max = max || 1;
    slider.value = settings.fontSize ? actual : 0;
    const label = !actual ? '—' : (settings.fontSize ? '' : '自動 · ')+actual+' px';
    slider.setAttribute('aria-valuetext',label);
    $('fontSizeValue').value = label;
  }

  function showVerification(state, message = '', hint = '') {
    $('stage').dataset.verification = state;
    $('verification').dataset.state = state;
    $('verification').hidden = !message;
    $('verifyStatus').textContent = message;
    status('verifyHint',hint);
  }

  function render({keepDownloads = false} = {}) {
    const revision = ++editRevision;
    clearTimeout(validationTimer);
    if (!keepDownloads && !busy) {
      status('exportStatus','');
      clearFileList();
    }
    const item = itemNow();
    $('stage').dataset.mode = mode;
    $('target').textContent = item?.target || '';
    if (renderedUrl) URL.revokeObjectURL(renderedUrl);
    $('qrImage').removeAttribute('src');
    $('qrImage').hidden = true;
    $('empty').hidden = false;
    $('empty').textContent = mode === 'barcode' ? '輸入內容後顯示條碼' : '輸入內容後顯示 QR Code';
    if (!item) { showVerification(''); syncFontSize(0,0); updateButtons(); return; }

    let svg, barcodeSpec;
    try {
      const size = Number(value('size'));
      if (item.barcode) {
        barcodeSpec = CampBarcode.get(item.barcode);
        svg = svgBlob(item,barcodeStyle,size);
      } else {
        const key = JSON.stringify([item.target,settings.ecc,settings.version]);
        if (key !== cacheKey) {
          cacheEncoder = core.makeEncoder(item.target,settings);
          cacheKey = key;
        }
        const {max,actual} = core.fontSizing(item,settings,cacheEncoder,size);
        syncFontSize(max,actual);
        svg = svgBlob(item,settings,size,cacheEncoder);
      }
    } catch (e) {
      syncFontSize(0,0);
      $('empty').textContent = item.barcode ? '目前設定無法產生條碼' : '目前設定無法產生 QR Code';
      const fallback = item.barcode ? '請核對資料格式與條碼設定，再重新預覽。' : '請檢查內容與 QR Code 設定，再重新預覽。';
      showVerification('fail',$('empty').textContent,errorMessage(e,fallback));
      updateButtons();
      return;
    }
    renderedUrl = URL.createObjectURL(svg);
    $('qrImage').src = renderedUrl;
    $('qrImage').alt = item.name + (item.barcode ? ' 的條碼' : ' 的 QR Code');
    $('qrImage').hidden = false;
    $('empty').hidden = true;
    updateButtons();
    if (barcodeSpec && !barcodeSpec.scan) {
      showVerification('ready','已產生條碼','這個碼種請使用相容的掃描器驗證。');
      return;
    }
    showVerification('pending',item.barcode ? '正在掃描這張條碼…' : '正在掃描這張 QR Code…');
    const format = value('format');
    validationTimer = setTimeout(async () => {
      try {
        const output = await renderOutput(svg,format);
        const decoded = barcodeSpec ? (await decodeImage(output,1,Infinity,[barcodeSpec.scan])).find(code=>code.isValid) : null;
        const matches = barcodeSpec ? Boolean(decoded) : await verify(output,item.target);
        if (revision !== editRevision) return;
        if (matches) showVerification('pass','已通過解碼',decoded ? '讀取結果：'+decoded.text : '');
        else showVerification('fail','掃描失敗',
          barcodeSpec ? '試著提高顏色對比、增加留白或選擇較大的圖檔尺寸。' :
            '試著縮小白底、提高顏色對比，或在進階設定將容錯等級調為 H。');
      } catch {
        if (revision === editRevision) showVerification('fail','無法完成掃描檢查','請重新預覽或換一種匯出格式再試。');
      }
    },180);
  }

  const svgBlob = (item,s,size,encoder) => new Blob([item.barcode
    ? CampBarcode.render(CampBarcode.get(item.barcode),item.target,s,size)
    : core.svgFor(item,s,size,encoder)],{type:svgType});

  function loadDecoder() {
    if (typeof CampQRRead === 'function') return Promise.resolve(CampQRRead);
    if (!decoderPromise) decoderPromise = new Promise((resolve,reject) => {
      const script = document.createElement('script');
      script.src = 'vendor/reader.js';
      script.onload = () => typeof CampQRRead === 'function' ? resolve(CampQRRead) : reject(new UserError('讀碼器無法啟動，請關閉程式後重開。'));
      script.onerror = () => reject(new UserError('讀碼器無法載入，請關閉程式後重開。'));
      document.head.append(script);
    }).catch(error => { decoderPromise = undefined; throw error; });
    return decoderPromise;
  }

  async function rasterize(blob, maxSize, white = false) {
    const url = URL.createObjectURL(blob);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      const scale = Math.min(1,maxSize/Math.max(image.naturalWidth,image.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1,Math.round(image.naturalWidth*scale));
      canvas.height = Math.max(1,Math.round(image.naturalHeight*scale));
      const context = canvas.getContext('2d',{willReadFrequently:white});
      if (white) { context.fillStyle = '#fff'; context.fillRect(0,0,canvas.width,canvas.height); }
      context.drawImage(image,0,0,canvas.width,canvas.height);
      return canvas;
    } finally { URL.revokeObjectURL(url); }
  }

  async function decodeImage(blob,max = 1,maxSize = 1600,formats) {
    const [reader,canvas] = await Promise.all([loadDecoder(),rasterize(blob,maxSize,true)]);
    const data = canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height);
    return reader(data,max,formats);
  }

  async function verify(blob,target) {
    const results = await decodeImage(blob,1,Infinity);
    return results.some(result => result.isValid && result.text === target);
  }

  function toPng(canvas) {
    return new Promise((resolve,reject) => canvas.toBlob(blob => {
      if (blob) resolve(blob);
      else reject(new UserError('無法產生 PNG 圖檔，請試著縮小影像尺寸。'));
    },'image/png'));
  }

  async function renderOutput(svg,format) {
    return format === 'svg' ? svg : toPng(await rasterize(svg,Infinity));
  }

  async function fileFor(item,s,format,size) {
    const blob = await renderOutput(svgBlob(item,s,size),format);
    if (!item.barcode && !await verify(blob,item.target)) {
      throw new UserError('圖檔未通過解碼。請提高顏色對比、縮小白底，或提高容錯等級。');
    }
    return {name:item.name+'.'+format,blob};
  }

  function saveBlob(blob,name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url),60000);
  }

  function clearFileList() {
    const list = $('fileList');
    list.querySelectorAll('a').forEach(a => URL.revokeObjectURL(a.href));
    list.replaceChildren();
    list.hidden = true;
  }

  function listFile(file) {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(file.blob);
    link.download = file.name;
    link.textContent = file.name;
    $('fileList').append(link);
    $('fileList').hidden = false;
  }

  async function availableHandle(directory, name) {
    const dot = name.lastIndexOf('.');
    for (let index=0; ; index++) {
      const candidate = index ? name.slice(0,dot)+'-'+(index+1)+name.slice(dot) : name;
      try {
        await directory.getFileHandle(candidate);
      } catch (error) {
        if (error.name === 'NotFoundError') return directory.getFileHandle(candidate,{create:true});
        if (error.name !== 'TypeMismatchError') throw error;
      }
    }
  }

  function encodeFile(blob) {
    return new Promise((resolve,reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(',',2)[1]);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }

  async function exportFiles(all) {
    if (busy) return;
    const selected = all ? [...items] : [itemNow()].filter(Boolean);
    if (!selected.length) return;
    const format = value('format'), size = Number(value('size')), look = {...(mode === 'barcode' ? barcodeStyle : settings)};
    clearFileList();
    busy = true;
    updateButtons();
    let directory;
    let desktopFolder = false;
    try {
      if (all && desktop) {
        desktopFolder = await desktopRequest('selectFolder');
        if (!desktopFolder) {
          status('exportStatus','已取消資料夾選擇。');
          return;
        }
      } else if (all && typeof window.showDirectoryPicker === 'function') {
        try {
          directory = await window.showDirectoryPicker({id:'camp168-qr-export',mode:'readwrite'});
        } catch (err) {
          if (err.name === 'AbortError') {
            status('exportStatus','已取消資料夾選擇。');
            return;
          }
        }
      }
      const failed = [];
      let listed = 0, written = 0;
      for (let i=0; i<selected.length; i++) {
        const item = selected[i];
        status('exportStatus','正在處理 '+(i+1)+' / '+selected.length+'…');
        let file;
        try {
          file = await fileFor(item,look,format,size);
        } catch (e) {
          if (!all) throw e;
          failed.push(item.name+'：'+errorMessage(e,'無法產生或驗證此圖檔。請確認資料格式與匯出設定。'));
          continue;
        }
        if (!all) saveBlob(file.blob,file.name);
        else if (desktopFolder) {
          try {
            await desktopRequest('writeFile',{name:file.name,data:await encodeFile(file.blob)});
            written++;
          } catch {
            listFile(file);
            listed++;
          }
        }
        else if (directory) {
          try {
            const handle = await availableHandle(directory,file.name);
            const stream = await handle.createWritable();
            try {
              await stream.write(file.blob);
              await stream.close();
            } catch (error) {
              await stream.abort().catch(() => {});
              throw error;
            }
            written++;
          } catch {
            listFile(file);
            listed++;
          }
        } else {
          listFile(file);
          listed++;
        }
      }
      let message = all ? [written ? '已儲存 '+written+' 張。' : '',listed ? '下方可逐張下載 '+listed+' 張。' : ''].join('') : '已下載 '+selected[0].name+'.'+format+'。';
      if (failed.length) {
        message += '產生或驗碼失敗 '+failed.length+' 張。\n'+failed.slice(0,5).join('\n');
        if (failed.length > 5) message += '\n另有 '+(failed.length-5)+' 張失敗。';
      }
      status('exportStatus',message);
    } catch (error) {
      status('exportStatus',errorMessage(error,'無法匯出圖檔。請檢查資料夾權限和匯出設定。'));
    } finally {
      busy = false;
      updateButtons();
    }
  }

  function safeSettings(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new UserError('設定格式有誤。');
    const clean = {...core.defaults};
    for (const el of controls) {
      const key = el.dataset.setting, candidate = raw[key];
      if (candidate === undefined) continue;
      if (enums.has(key)) {
        if (enums.get(key).includes(candidate)) clean[key] = candidate;
      } else if (el.type === 'color') {
        if (/^#[0-9a-f]{6}$/i.test(candidate)) clean[key] = candidate;
      } else if (el.type === 'checkbox') {
        if (typeof candidate === 'boolean') clean[key] = candidate;
      } else if (el.type === 'number' || el.type === 'range') {
        if (typeof candidate === 'number' && Number.isInteger(candidate) &&
          candidate >= Number(el.min) && candidate <= (key === 'fontSize' ? 2048 : Number(el.max))) clean[key] = candidate;
      } else if (typeof candidate === 'string') clean[key] = candidate.slice(0,el.maxLength);
    }
    if (typeof raw.logo === 'string' && raw.logo.length < 2000000 &&
        /^data:image\/png;base64,[a-z0-9+/=]+$/i.test(raw.logo)) clean.logo = raw.logo;
    return clean;
  }

  function templates() {
    try { const records = JSON.parse(localStorage.getItem(storageKey) || '[]'); return Array.isArray(records) ? records : []; }
    catch { return []; }
  }

  function refreshTemplates(name = '') {
    $('savedTemplates').replaceChildren(new Option('選擇已儲存的模板',''),
      ...templates().map(record => new Option(record.name,record.name,false,record.name===name)));
  }

  function applyImported(raw) {
    settings = safeSettings(raw);
    activePreset = null;
    syncSettings();
    render();
  }

  document.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click',() => {
    mode = button.dataset.mode;
    document.querySelectorAll('[data-mode]').forEach(option => option.setAttribute('aria-pressed',option===button));
    $('batchFields').hidden = mode !== 'batch';
    $('singleFields').hidden = mode !== 'single';
    $('barcodeFields').hidden = mode !== 'barcode';
    $('qrDesign').hidden = mode === 'barcode';
    $('barcodeDesign').hidden = mode !== 'barcode';
    $('downloadAll').hidden = mode === 'single';
    refreshItems();
  }));

  document.querySelectorAll('[data-tab]').forEach(button => button.addEventListener('click',() => {
    document.querySelectorAll('[data-tab]').forEach(option => {
      option.setAttribute('aria-pressed',option===button);
      $(option.dataset.tab+'Tab').hidden = option !== button;
    });
  }));

  for (const el of controls) el.addEventListener('input',() => {
    const key = el.dataset.setting;
    if (!el.validity.valid) return;
    if (el.type === 'range' || el.type === 'number') {
      if (el.value === '') return;
      settings[key] = el.valueAsNumber;
    } else if (el.type === 'checkbox') settings[key] = el.checked;
    else settings[key] = el.value;
    activePreset = null;
    syncFields();
    render();
  });

  $('reset').addEventListener('click',() => {
    activePreset = 0;
    settings = core.presetAt(0);
    $('logo').value = '';
    syncSettings();
    render();
  });

  $('logo').addEventListener('change',async () => {
    const file = $('logo').files[0];
    if (!file) return;
    try {
      const canvas = await rasterize(file,288);
      settings = {...settings,logo:canvas.toDataURL('image/png'),center:'logo'};
      activePreset = null;
      syncSettings();
      render();
    } catch { status('exportStatus','無法讀取這張 Logo 圖片。'); }
  });

  $('suffixFile').addEventListener('change',async () => {
    const file = $('suffixFile').files[0];
    if (!file) return;
    try {
      $('suffix').value = await file.text();
      refreshItems();
    } catch { status('inputError','無法讀取這份清單。'); }
    $('suffixFile').value = '';
  });

  for (const el of barcodeControls) el.addEventListener('input',() => {
    if (!el.validity.valid || el.value === '') return;
    barcodeStyle[el.dataset.barcodeSetting] = barcodeControlValue(el);
    if (el.dataset.barcodeSetting === 'text') $('barcodeTextSettings').hidden = !barcodeStyle.text;
    render();
  });

  $('resetBarcode').addEventListener('click',() => {
    barcodeStyle = {...barcodeDefaults};
    $('barcodeTextSettings').hidden = !barcodeStyle.text;
    for (const el of barcodeControls) {
      const setting = barcodeStyle[el.dataset.barcodeSetting];
      if (el.type === 'checkbox') el.checked = setting;
      else el.value = setting;
    }
    render();
  });

  $('barcodeType').addEventListener('change',() => {
    barcodeFields();
    refreshItems();
  });
  $('barcodeExample').addEventListener('click',() => {
    const {sample} = CampBarcode.get(value('barcodeType'));
    $('barcodeContent').value = sample;
    barcodeImport = {input:value('barcodeContent'),rows:[sample]};
    refreshItems();
  });
  $('barcodeContent').addEventListener('input',() => {
    barcodeImport = undefined;
    refreshItems();
  });
  $('barcodeFile').addEventListener('change',async () => {
    const file = $('barcodeFile').files[0];
    if (!file) return;
    try {
      const raw = (await file.text()).replace(/^\uFEFF/,'');
      if (/\.csv$/i.test(file.name)) {
        const rows = CampBarcode.csvRows(raw);
        $('barcodeContent').value = rows.join('\n');
        barcodeImport = {input:value('barcodeContent'),rows};
      } else {
        $('barcodeContent').value = raw;
        barcodeImport = undefined;
      }
      refreshItems();
    } catch (error) { status('inputError',errorMessage(error,'無法匯入條碼清單。請確認檔案為可讀取的文字格式。')); }
    finally { $('barcodeFile').value = ''; }
  });

  $('contentType').addEventListener('change',() => {
    $('singleInputs').innerHTML = singleFields[value('contentType')];
    refreshItems();
  });

  ['base','suffix','singleInputs'].forEach(id => $(id).addEventListener('input',refreshItems));
  $('previewItem').addEventListener('change',() => { activeItem = value('previewItem'); render({keepDownloads:true}); });
  $('size').addEventListener('change',() => render());
  $('format').addEventListener('change',() => render());
  $('downloadOne').addEventListener('click',() => exportFiles(false));
  $('downloadAll').addEventListener('click',() => exportFiles(true));

  $('saveTemplate').addEventListener('click',() => {
    const name = value('templateName').trim();
    if (!name) { $('templateName').focus(); status('templateStatus','請填寫模板名稱。'); return; }
    try {
      const records = templates().filter(template => template.name !== name);
      localStorage.setItem(storageKey,JSON.stringify([...records,{name,settings}]));
      refreshTemplates(name);
      status('templateStatus','已儲存在這個瀏覽器。');
    } catch { status('templateStatus','瀏覽器無法儲存這份模板，可使用匯出 JSON。'); }
  });

  $('savedTemplates').addEventListener('change',() => {
    const record = templates().find(template => template.name === value('savedTemplates'));
    if (!record) return;
    $('templateName').value = record.name;
    try { applyImported(record.settings); status('templateStatus','已套用 '+record.name+'。'); }
    catch (error) { status('templateStatus',errorMessage(error,'無法套用這份模板。')); }
  });

  $('exportTemplate').addEventListener('click',() => {
    const name = value('templateName').trim() || 'CAMP168 樣式';
    const payload = JSON.stringify({name,settings},null,2);
    saveBlob(new Blob([payload],{type:'application/json'}),'camp168-qr-template.json');
  });

  $('templateFile').addEventListener('change',async () => {
    const file = $('templateFile').files[0];
    if (!file) return;
    try {
      if (file.size > 2500000) throw new UserError('設定檔太大。');
      const raw = JSON.parse(await file.text());
      applyImported(raw.settings);
      if (typeof raw.name === 'string') $('templateName').value = raw.name.slice(0,40);
      status('templateStatus','已套用匯入的樣式。');
    } catch (error) { status('templateStatus',errorMessage(error,'無法讀取設定檔。請確認檔案格式。')); }
    $('templateFile').value = '';
  });

  $('openScan').addEventListener('click',() => $('scanDialog').showModal());

  $('scanFile').addEventListener('change',async () => {
    const file = $('scanFile').files[0];
    if (!file) return;
    const revision = ++scanRevision;
    $('scanResults').replaceChildren();
    status('scanStatus','正在讀取…');
    try {
      const results = await decodeImage(file,12,1600,[]);
      if (revision !== scanRevision) return;
      const list = document.createElement('ul');
      for (const result of results.filter(result => result.isValid)) {
        const line = document.createElement('li');
        if (/^https?:\/\//i.test(result.text)) {
          const anchor = document.createElement('a');
          anchor.textContent = result.text;
          anchor.href = result.text;
          anchor.target = '_blank';
          anchor.rel = 'noopener noreferrer';
          line.append(anchor);
        } else line.textContent = result.text;
        line.prepend(document.createTextNode(result.format+' · '));
        list.append(line);
      }
      $('scanResults').append(list);
      status('scanStatus',list.children.length ? '讀取 '+list.children.length+' 個條碼' : '沒有讀到可辨識的條碼。');
    } catch (error) {
      if (revision === scanRevision) status('scanStatus',errorMessage(error,'無法讀取這張圖檔。請改用可正常開啟的 PNG 或 JPG 圖片。'));
    }
  });

  $('singleInputs').innerHTML = singleFields.url;
  buildBarcodeList();
  barcodeFields();
  $('barcodeContent').value = CampBarcode.get(value('barcodeType')).sample;
  buildPresets();
  syncSettings();
  refreshTemplates();
  refreshItems();
})();
