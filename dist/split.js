(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const modeFields = {
    horizontal:['水平份數',2],
    vertical:['垂直份數',2],
    pixels:['每塊寬度（px）',500,'每塊高度（px）',500],
    grid:['欄數',2,'列數',2]
  };

  function init(desktop,request,addDrop) {
    const status = (id,text) => { $(id).textContent = text; $(id).hidden = !text; };
    if (!desktop) {
      $('splitPick').disabled = $('splitFolder').disabled = true;
      status('splitInputStatus','請使用 Windows 版 EXE 執行圖片拆分。');
      return;
    }

    const entries = new Map(), options = {};
    let active = false, shared = false, photo, previewRevision = 0, planRevision = 0;
    const value = id => $(id).value;
    function configure() {
      const mode = value('splitMode');
      const fields = modeFields[mode];
      $('splitFirstLabel').textContent = fields[0];
      $('splitSecondField').hidden = fields.length < 4;
      $('splitSecondLabel').textContent = fields[2] || '';
      const saved = options[mode];
      $('splitFirst').value = saved ? saved[0] : fields[1];
      $('splitSecond').value = saved ? saved[1] : fields[3] || 1;
    }
    function settings() {
      const mode = value('splitMode'), first = $('splitFirst'), second = $('splitSecond');
      if (!first.value || !first.validity.valid ||
        (!$('splitSecondField').hidden && (!second.value || !second.validity.valid))) return null;
      return {mode,first:first.valueAsNumber,second:$('splitSecondField').hidden ? 1 : second.valueAsNumber};
    }
    function updateActions() {
      $('splitPick').disabled = active;
      $('splitClear').disabled = $('splitRemove').disabled = active || !entries.size;
      $('splitFiles').disabled = active || !entries.size;
      for (const id of ['splitMode','splitFirst','splitSecond','splitFormat','splitFolder','splitReset']) $(id).disabled = active;
      $('splitStart').disabled = active || !entries.size || !settings();
      $('splitCancel').hidden = !active;
    }
    function drawLines(path) {
      for (const id of ['splitHalo','splitLines']) $(id).setAttribute('d',path);
    }
    async function updatePlan() {
      const revision = ++planRevision;
      drawLines('');
      if (!photo) return;
      const {width,height} = photo;
      const dimensions = width+' × '+height+' px';
      const config = settings();
      if (!config) {
        status('splitPreviewStatus',dimensions+' · 請輸入有效的正整數。');
        return;
      }
      try {
        const plan = await request('splitPlan',{width,height,...config});
        if (revision !== planRevision) return;
        drawLines([...plan.x.slice(1,-1).map(x=>'M'+x+' 0V'+height),
          ...plan.y.slice(1,-1).map(y=>'M0 '+y+'H'+width)].join(' '));
        const edge = config.mode === 'pixels' && (width%config.first || height%config.second)
          ? ' · 右側或底部保留剩餘像素' : '';
        status('splitPreviewStatus',dimensions+' · '+(plan.x.length-1)+' 欄 × '+(plan.y.length-1)+' 列 · '+plan.count+' 張'+edge);
      } catch (error) {
        if (revision === planRevision) status('splitPreviewStatus',dimensions+' · '+error.message);
      }
    }
    async function preview() {
      const revision = ++previewRevision;
      ++planRevision;
      photo = null;
      $('splitPreview').hidden = true;
      const file = value('splitFiles');
      status('splitPreviewStatus',file ? '正在載入預覽…' : '加入圖片即可預覽切線。');
      if (!file) return;
      try {
        const result = await request('splitPreview',{file});
        if (revision !== previewRevision) return;
        photo = result;
        $('splitCanvas').setAttribute('viewBox','0 0 '+photo.width+' '+photo.height);
        $('splitImage').setAttribute('width',photo.width);
        $('splitImage').setAttribute('height',photo.height);
        $('splitImage').setAttribute('href',photo.src);
        $('splitPreview').hidden = false;
        await updatePlan();
      } catch (error) {
        if (revision === previewRevision) status('splitPreviewStatus',error.message);
      }
    }
    function paintFiles() {
      const selected = value('splitFiles');
      $('splitFiles').replaceChildren(...[...entries.values()].map(entry=>new Option(entry.name,entry.id)));
      if (!entries.size) $('splitFiles').append(new Option('尚未加入圖片',''));
      else if (entries.has(selected)) $('splitFiles').value = selected;
      updateActions();
      if (selected !== value('splitFiles')) preview();
    }
    async function add(action,files) {
      if (active) return;
      try {
        const list = await request(action,{tool:'split'},files);
        if (active) return;
        for (const entry of list.items) entries.set(entry.id,entry);
        status('splitInputStatus','共 '+entries.size+' 張圖片。'+
          (list.skipped ? ' 有 '+list.skipped+' 個檔案無法加入。' : ''));
        paintFiles();
      } catch (error) { status('splitInputStatus',error.message); }
    }
    $('splitPick').addEventListener('click',()=>add('toolPick'));
    addDrop($('splitDrop'),files=>add('toolDrop',files));
    $('splitFiles').addEventListener('change',preview);
    $('splitClear').addEventListener('click',()=>{
      entries.clear(); status('splitInputStatus',''); paintFiles();
    });
    $('splitRemove').addEventListener('click',()=>{
      entries.delete(value('splitFiles'));
      status('splitInputStatus',entries.size ? '共 '+entries.size+' 張圖片。' : '');
      paintFiles();
    });
    $('splitMode').addEventListener('change',()=>{ configure(); updateActions(); updatePlan(); });
    for (const id of ['splitFirst','splitSecond']) $(id).addEventListener('input',()=>{
      options[value('splitMode')] = [value('splitFirst'),value('splitSecond')];
      updateActions();
      updatePlan();
    });
    $('splitFolder').addEventListener('click',async()=>{
      try {
        const folder = await request('toolFolder',{tool:'split'});
        if (!folder) return;
        shared = true;
        $('splitReset').hidden = false;
        $('splitDestination').textContent = folder;
      } catch (error) { status('splitInputStatus',error.message); }
    });
    $('splitReset').addEventListener('click',()=>{
      shared = false;
      $('splitReset').hidden = true;
      $('splitDestination').textContent = '各來源資料夾內的「圖片拆分」子資料夾';
    });
    $('splitOpen').addEventListener('click',async()=>{
      try { await request('toolOpen',{tool:'split',index:Number(value('splitResultFolder'))}); }
      catch (error) { status('splitStatus',error.message); }
    });
    $('splitCancel').addEventListener('click',async()=>{
      $('splitCancel').disabled = true;
      try { await request('splitCancel'); }
      catch (error) { status('splitStatus',error.message); }
    });
    $('splitStart').addEventListener('click',async()=>{
      const config = settings();
      if (active || !entries.size || !config) return;
      active = true;
      $('splitCancel').disabled = false;
      $('splitOpenRow').hidden = $('splitResults').hidden = true;
      $('splitResults').replaceChildren();
      $('splitProgress').hidden = false;
      $('splitProgress').max = entries.size;
      $('splitProgress').value = 0;
      status('splitStatus','正在拆分圖片…');
      updateActions();
      if (matchMedia('(max-width:699px),(max-height:540px)').matches)
        $('splitTool').querySelector('[data-tool-pane-target=preview]').click();
      try {
        const format = $('splitFormat').value;
        const result = await request('splitRun',{...config,ids:[...entries.keys()],shared,format});
        $('splitProgress').value = result.completed;
        $('splitResultFolder').replaceChildren(...result.folders.map((folder,index)=>new Option(folder,index)));
        $('splitOpenRow').hidden = !result.folders.length;
        $('splitResultFolder').hidden = result.folders.length < 2;
        status('splitStatus',(result.cancelled ? '已停止。' : '批次完成。')+
          ' 已處理 '+result.completed+'／'+entries.size+' 個來源，輸出 '+result.tiles+' 張 '+format.toUpperCase()+'，失敗 '+result.failed+' 項。');
      } catch (error) { status('splitStatus',error.message); }
      finally { active = false; updateActions(); }
    });
    desktop.addEventListener('message',({data})=>{
      if (data.event !== 'splitProgress' || !active) return;
      const row = data.value;
      $('splitProgress').value = Math.max($('splitProgress').value,row.completed);
      const li = document.createElement('li');
      li.classList.toggle('failed',row.failed);
      li.textContent = row.name+' · '+row.note;
      $('splitResults').append(li);
      $('splitResults').hidden = false;
    });
    paintFiles();
  }
  globalThis.CampSplit = {init};
})();
