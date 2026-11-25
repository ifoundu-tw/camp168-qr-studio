(function () {
  'use strict';
  const $ = id => document.getElementById(id);

  function addDrop(element, handler) {
    element.addEventListener('dragover',event=>{
      if (!event.dataTransfer.types.includes('Files')) return;
      event.preventDefault();
      element.classList.add('dragging');
    });
    element.addEventListener('dragleave',event=>{
      if (!element.contains(event.relatedTarget)) element.classList.remove('dragging');
    });
    element.addEventListener('drop',event=>{
      const files = [...event.dataTransfer.files];
      if (!files.length) return;
      event.preventDefault();
      element.classList.remove('dragging');
      handler(files);
    });
  }

  function init(desktop, request) {
    const sections = {codes:$('codesTool'),images:$('imageTool'),rename:$('renameTool')};
    const toggles = [...document.querySelectorAll('[data-category]')];
    for (const button of toggles) button.addEventListener('click',()=>{
      const type = button.dataset.category;
      for (const [name,section] of Object.entries(sections)) if (section) section.hidden = name !== type;
      for (const tab of toggles) tab.setAttribute('aria-pressed',tab === button);
      $('openScan').hidden = type !== 'codes';
    });
    for (const nav of document.querySelectorAll('.tool-switcher')) {
      const buttons = [...nav.querySelectorAll('button')];
      for (const button of buttons) button.addEventListener('click',()=>{
        nav.closest('.tool-view').dataset.toolPane = button.dataset.toolPaneTarget;
        for (const entry of buttons) entry.setAttribute('aria-pressed',entry===button);
      });
    }
    const imageButtons = [...document.querySelectorAll('[data-image-tool]')];
    for (const button of imageButtons) button.addEventListener('click',()=>{
      for (const entry of imageButtons) {
        $(entry.dataset.imageTool).hidden = entry !== button;
        entry.setAttribute('aria-pressed',entry === button);
      }
    });
    if (globalThis.CampSplit) CampSplit.init(desktop,request,addDrop);
    if (!desktop) {
      $('momoPick').disabled = true;
      $('momoFolder').disabled = true;
      $('momoStatus').textContent = '請使用 Windows 版 EXE 執行批次處理。';
      return;
    }

    const entries = new Map();
    let active = false, chosen = null;
    const status = (id,text) => { $(id).textContent = text; $(id).hidden = !text; };

    function paint() {
      const picks = new Set([...$('momoFiles').selectedOptions].map(option=>option.value));
      $('momoFiles').replaceChildren(...[...entries.values()].map(entry=>new Option(entry.name,entry.id,false,picks.has(entry.id))));
      $('momoCount').textContent = entries.size+' 張';
      $('momoClear').disabled = active || !entries.size;
      $('momoPick').disabled = active;
      $('momoFolder').disabled = active;
      $('momoResetFolder').disabled = active;
      $('momoMode').disabled = active;
      $('momoRemove').disabled = active || !$('momoFiles').selectedOptions.length;
      $('momoStart').disabled = active || !entries.size;
      $('momoCancel').hidden = !active;
    }

    async function add(action,files) {
      if (active) return;
      try {
        const list = await request(action,{tool:'momo'},files);
        let count = 0;
        for (const entry of list.items) if (!entries.has(entry.id)) {
          entries.set(entry.id,entry);
          count++;
        }
        if (count || list.skipped) status('momoInputStatus',(count ? '已加入 '+count+' 張。' : '')+
          (list.skipped ? '有 '+list.skipped+' 個檔案格式不支援。' : ''));
        paint();
      } catch (error) { status('momoInputStatus',error.message); }
    }

    $('momoPick').addEventListener('click',()=>add('toolPick'));
    addDrop($('momoDrop'),files=>add('toolDrop',files));
    $('momoClear').addEventListener('click',()=>{ entries.clear(); status('momoInputStatus',''); paint(); });
    $('momoFiles').addEventListener('change',()=>{ $('momoRemove').disabled = active || !$('momoFiles').selectedOptions.length; });
    $('momoRemove').addEventListener('click',()=>{
      for (const option of $('momoFiles').selectedOptions) entries.delete(option.value);
      paint();
    });
    $('momoFolder').addEventListener('click',async()=>{
      try {
        const folder = await request('toolFolder',{tool:'momo'});
        if (!folder) return;
        chosen = folder;
        $('momoResetFolder').hidden = false;
        $('momoDestination').textContent = folder;
      } catch (error) { status('momoStatus',error.message); }
    });
    $('momoResetFolder').addEventListener('click',()=>{
      chosen = null;
      $('momoResetFolder').hidden = true;
      $('momoDestination').textContent = '各來源資料夾內的 MOMO 子資料夾';
    });
    $('momoOpen').addEventListener('click',async()=>{
      try { await request('toolOpen',{tool:'momo',index:Number($('momoResultFolder').value)}); }
      catch (error) { status('momoStatus',error.message); }
    });
    $('momoCancel').addEventListener('click',async()=>{
      $('momoCancel').disabled = true;
      try { await request('momoCancel'); }
      catch (error) { status('momoStatus',error.message); }
    });
    $('momoStart').addEventListener('click',async()=>{
      if (active || !entries.size) return;
      active = true;
      $('momoCancel').disabled = false;
      $('momoResults').replaceChildren();
      $('momoOpen').hidden = true;
      $('momoResultFolder').hidden = true;
      $('momoProgress').max = entries.size;
      $('momoProgress').value = 0;
      status('momoStatus','開始處理…');
      paint();
      try {
        const summary = await request('momoRun',{ids:[...entries.keys()],shared:Boolean(chosen),mode:$('momoMode').value});
        $('momoProgress').value = summary.completed;
        $('momoOpen').hidden = !summary.folders.length;
        $('momoResultFolder').replaceChildren(...summary.folders.map((folder,index)=>new Option(folder,index)));
        $('momoResultFolder').hidden = summary.folders.length < 2;
        status('momoStatus',(summary.cancelled ? '已停止。' : '批次完成。')+
          ' 已處理 '+summary.completed+'／'+entries.size+' 個來源，輸出 '+summary.images+' 張，失敗 '+summary.failed+' 項。'+
          (summary.logErrors.length ? ' 部分資料夾的紀錄無法寫入。' : ''));
      } catch (error) { status('momoStatus',error.message); }
      finally { active = false; paint(); }
    });

    desktop.addEventListener('message',({data})=>{
      if (data.event !== 'momoProgress' || !active) return;
      const row = data.value;
      $('momoProgress').value = row.completed;
      status('momoStatus',row.name+' · '+row.note);
      if (!row.output && !row.failed) return;
      const li = document.createElement('li');
      li.className = row.failed ? 'failed' : '';
      li.textContent = row.output
        ? row.output+' · '+row.bytes.toLocaleString('zh-TW')+' bytes · '+row.note
        : row.name+' · '+row.note;
      $('momoResults').append(li);
    });
    paint();
    if (globalThis.CampRename) CampRename.init(desktop,request,addDrop);
  }

  globalThis.CampMomo = {init};
})();
