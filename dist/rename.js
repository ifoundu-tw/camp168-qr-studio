(function () {
  'use strict';
  const $ = id => document.getElementById(id);

  function init(desktop,request,addDrop) {
    let files = [], folder = null, busy = false, dragged = null;
    const failures = new Map();
    const options = () => ({
      name:$('renameStem').value, digits:Number($('renameDigits').value),
      pattern:$('renamePattern').value, move:$('renameMode').value === 'move',
      format:$('renameFormat').value
    });

    function outputName(file,index,style) {
      const name = style.name.trim().replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').replace(/[ .]+$/g,'') || '未命名';
      const number = String(index+1).padStart(style.digits,'0');
      const separator = style.pattern.at(-1);
      const stem = style.pattern.startsWith('name') ? name+separator+number : number+separator+name;
      return stem+(style.format === 'keep' ? file.extension : '.'+style.format);
    }

    function move(from,to) {
      if (busy || from === to || to < 0 || to >= files.length) return;
      const [entry] = files.splice(from,1);
      files.splice(to,0,entry);
      failures.clear();
      paint();
    }

    function cardButton(text,label,disabled,fn) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = text;
      button.title = label;
      button.setAttribute('aria-label',label);
      button.disabled = disabled;
      button.addEventListener('click',fn);
      return button;
    }

    function paint() {
      const style = options();
      $('renameCount').textContent = files.length+' 個';
      $('renameEmpty').hidden = Boolean(files.length);
      $('renameStart').disabled = busy || !files.length;
      $('renameClear').disabled = busy || !files.length;
      $('renameFolder').disabled = busy;
      $('renamePick').disabled = busy;
      for (const id of ['renameStem','renameDigits','renamePattern','renameMode','renameFormat']) $(id).disabled = busy;
      const cards = document.createDocumentFragment();
      files.forEach((file,index)=>{
        const card = document.createElement('li');
        card.className = 'rename-card';
        card.draggable = !busy;
        const thumb = document.createElement('div');
        thumb.className = 'rename-card-thumb';
        if (file.thumbnail) {
          const image = document.createElement('img');
          image.loading = 'lazy';
          image.src = 'tool-image/'+file.id;
          image.alt = '';
          image.addEventListener('error',()=>{
            thumb.textContent = file.extension.toUpperCase() || '檔案';
          },{once:true});
          thumb.append(image);
        } else thumb.textContent = file.extension.toUpperCase() || '檔案';

        const name = document.createElement('strong');
        name.className = 'rename-card-name';
        name.textContent = outputName(file,index,style);
        name.title = name.textContent;
        const original = document.createElement('span');
        original.className = 'rename-card-original';
        original.textContent = file.name;
        original.title = file.name;
        const actions = document.createElement('div');
        actions.className = 'rename-card-actions';
        actions.append(
          cardButton('↑','上移 '+file.name,busy || index===0,()=>move(index,index-1)),
          cardButton('↓','下移 '+file.name,busy || index===files.length-1,()=>move(index,index+1)),
          cardButton('移除','移除 '+file.name,busy,()=>{files.splice(index,1);failures.clear();paint();})
        );
        if (failures.has(file.id)) {
          card.classList.add('failed');
          card.title = failures.get(file.id);
        }
        card.addEventListener('dragstart',event=>{
          if (busy) { event.preventDefault();return; }
          dragged = file.id;
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData('text/plain',file.id);
        });
        card.addEventListener('dragover',event=>{
          if (!dragged || dragged === file.id || busy) return;
          event.preventDefault();
          event.stopPropagation();
          event.dataTransfer.dropEffect = 'move';
          card.classList.add('drag-target');
        });
        card.addEventListener('dragleave',()=>card.classList.remove('drag-target'));
        card.addEventListener('drop',event=>{
          if (!dragged || busy) return;
          event.preventDefault();
          event.stopPropagation();
          const from = files.findIndex(entry=>entry.id===dragged);
          dragged = null;
          if (from>=0) move(from,index);
        });
        card.addEventListener('dragend',()=>{
          dragged = null;
          for (const target of $('renameCards').querySelectorAll('.drag-target')) target.classList.remove('drag-target');
        });
        card.append(thumb,name,original,actions);
        cards.append(card);
      });
      $('renameCards').replaceChildren(cards);
    }

    async function add(action,dropped) {
      if (busy) return;
      try {
        const selected = await request(action,{tool:'rename'},dropped);
        const have = new Set(files.map(file=>file.id));
        const added = selected.items.filter(file=>!have.has(file.id));
        files.push(...added);
        $('renameStatus').textContent = '已加入 '+added.length+' 個檔案。'+(selected.skipped ? ' 有 '+selected.skipped+' 個無法加入。' : '');
        paint();
      } catch (error) { $('renameStatus').textContent = error.message; }
    }

    async function chooseFolder() {
      folder = await request('toolFolder',{tool:'rename'}) || folder;
      if (folder) {
        $('renameFolderName').textContent = folder;
        $('renameFolderName').title = folder;
      }
      return folder;
    }

    async function stageWebp(file,format) {
      const response = await fetch('tool-image/'+file.id);
      if (!response.ok) throw Error('無法讀取 WebP 圖片。');
      const image = await createImageBitmap(await response.blob());
      try {
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext('2d');
        if (format === 'jpg') { context.fillStyle = '#fff'; context.fillRect(0,0,canvas.width,canvas.height); }
        context.drawImage(image,0,0);
        const type = format === 'jpg' ? 'image/jpeg' : 'image/png';
        const blob = await new Promise((resolve,reject)=>canvas.toBlob(value=>value ? resolve(value) : reject(Error('無法轉換 WebP。')),type,.94));
        const data = await new Promise((resolve,reject)=>{
          const reader = new FileReader();
          reader.onload = ()=>resolve(reader.result.split(',',2)[1]);
          reader.onerror = ()=>reject(Error('無法讀取轉換後的圖片。'));
          reader.readAsDataURL(blob);
        });
        await request('renameStage',{file:file.id,data});
      } finally { image.close(); }
    }

    $('renamePick').addEventListener('click',()=>add('toolPick'));
    addDrop($('renameDrop'),dropped=>add('toolDrop',dropped));
    $('renameClear').addEventListener('click',()=>{
      files = [];
      failures.clear();
      $('renameStatus').textContent = '已清空清單。';
      paint();
    });
    for (const id of ['renameStem','renameDigits','renamePattern','renameMode','renameFormat']) $(id).addEventListener('input',()=>paint());
    $('renameFolder').addEventListener('click',()=>chooseFolder().catch(error=>{ $('renameStatus').textContent = error.message; }));
    $('renameOpen').addEventListener('click',()=>request('toolOpen',{tool:'rename'}).catch(error=>{ $('renameStatus').textContent = error.message; }));
    $('renameStart').addEventListener('click',async()=>{
      if (!files.length || busy) return;
      busy = true;
      failures.clear();
      paint();
      $('renameOpen').hidden = true;
      try {
        if (!folder && !await chooseFolder()) return;
        const style = options();
        await request('renameClearStage');
        if (style.format !== 'keep') {
          for (const file of files.filter(file=>file.extension.toLowerCase() === '.webp')) {
            $('renameStatus').textContent = '正在轉換 '+file.name+'…';
            try { await stageWebp(file,style.format); }
            catch (error) { throw Error(file.name+'：'+error.message); }
          }
        }
        const result = await request('renameRun',{ids:files.map(file=>file.id),...style});
        $('renameOpen').hidden = !result.completed;
        files = files.filter(file=>!result.moved.includes(file.id));
        const detail = failures.size ? ' '+[...failures.values()][0] : '';
        $('renameStatus').textContent = result.cancelled ? '已取消移動。' :
          '已輸出 '+result.completed+' 個，失敗 '+result.failed+' 個。'+detail;
      } catch (error) { $('renameStatus').textContent = error.message; }
      finally {
        try { await request('renameClearStage'); } catch {}
        busy = false;
        paint();
      }
    });
    desktop.addEventListener('message',({data})=>{
      if (data.event !== 'renameProgress' || !busy) return;
      const row = data.value, file = files[row.index];
      const line = row.name+' · '+row.message;
      if (row.failed && file) failures.set(file.id,line);
      $('renameStatus').textContent = line;
    });
    paint();
  }

  globalThis.CampRename = {init};
})();
