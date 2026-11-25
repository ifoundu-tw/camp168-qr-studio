(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const heifExtension = /^\.(heic|heif|heics|heifs|hif)$/i;
  const batchBytes = 256*1024;
  const readData = blob => new Promise((resolve,reject)=>{
    const reader = new FileReader();
    reader.onload = ()=>resolve(String(reader.result).split(',',2)[1]);
    reader.onerror = ()=>reject(new Error('無法讀取轉檔資料。'));
    reader.readAsDataURL(blob);
  });

  async function decodeHeic(blob) {
    const bytes = await blob.arrayBuffer();
    const worker = new Worker('heic-worker.js');
    try {
      return await new Promise((resolve,reject)=>{
        worker.onmessage = ({data})=>data.error ? reject(new Error('無法讀取 HEIC。')) : resolve(data);
        worker.onerror = ()=>reject(new Error('無法啟動 HEIC 解碼。'));
        worker.postMessage(bytes,[bytes]);
      });
    } finally { worker.terminate(); }
  }

  function rasterize(source,format) {
    const canvas = document.createElement('canvas');
    canvas.width = source.width;
    canvas.height = source.height;
    const brush = canvas.getContext('2d');
    if (!brush || !source.width || !source.height) throw new Error('圖片尺寸無效。');
    if (source.pixels) {
      brush.putImageData(new ImageData(source.pixels,source.width,source.height),0,0);
    } else {
      brush.drawImage(source,0,0);
    }
    if (format === 'jpg') {
      brush.globalCompositeOperation = 'destination-over';
      brush.fillStyle = '#fff';
      brush.fillRect(0,0,canvas.width,canvas.height);
    }
    return new Promise((resolve,reject)=>{
      canvas.toBlob(blob=>{
        canvas.width = canvas.height = 1;
        if (blob?.size) resolve(blob);
        else reject(new Error('無法匯出這張圖片，請檢查尺寸。'));
      },format === 'jpg' ? 'image/jpeg' : 'image/png',.94);
    });
  }

  async function inBrowser(file,format) {
    const response = await fetch('convert-image/'+file.id);
    if (!response.ok) throw new Error('無法讀取來源圖片。');
    const blob = await response.blob();
    if (heifExtension.test(file.extension)) return rasterize(await decodeHeic(blob),format);
    if (file.extension.toLowerCase() === '.svg') {
      const url = URL.createObjectURL(new Blob([blob],{type:'image/svg+xml'}));
      try {
        const image = new Image();
        image.src = url;
        await image.decode();
        return await rasterize(image,format);
      } finally { URL.revokeObjectURL(url); }
    }
    const bitmap = await createImageBitmap(blob);
    try { return await rasterize(bitmap,format); }
    finally { bitmap.close(); }
  }

  function init(desktop,request,addDrop) {
    const status = text=>{ $('convertStatus').textContent = text; };
    if (!desktop) {
      $('convertPick').disabled = $('convertFolder').disabled = true;
      status('請使用 Windows 版 EXE 執行轉檔。');
      return;
    }
    const entries = new Map(), folders = new Map();
    let busy = false, shared = false, stopping = false;
    function controls() {
      for (const id of ['convertPick','convertFormat','convertFolder','convertReset','convertFiles']) $(id).disabled = busy;
      $('convertClear').disabled = $('convertStart').disabled = busy || !entries.size;
      $('convertRemove').disabled = busy || !$('convertFiles').selectedOptions.length;
      $('convertCancel').hidden = $('convertCancelNarrow').hidden = !busy;
    }
    function paintFiles() {
      const selected = new Set([...$('convertFiles').selectedOptions].map(option=>option.value));
      $('convertFiles').replaceChildren(...[...entries.values()].map(file=>new Option(file.name,file.id,false,selected.has(file.id))));
      $('convertCount').textContent = entries.size+' 個檔案';
      controls();
    }
    async function add(action,files) {
      if (busy) return;
      try {
        const result = await request(action,{tool:'convert'},files);
        if (busy) return;
        for (const item of result.items) entries.set(item.id,item);
        paintFiles();
        if (result.skipped) status('有 '+result.skipped+' 個檔案無法加入。');
      } catch (error) { status(error.message); }
    }
    async function convert(file,format) {
      const fields = {file:file.id,format,shared};
      const result = await request('convertFile',{...fields,nativeOnly:false});
      if (!result.browser) return result;
      let blob;
      try { blob = await inBrowser(file,format); }
      catch {
        const fallback = await request('convertFile',{...fields,nativeOnly:true});
        if (!fallback.browser) return fallback;
        throw new Error(heifExtension.test(file.extension) ? '無法解讀此 HEIC／HEIF；請檢查檔案是否完整。' :
          '目前無法解讀這個格式或檔案已損壞。特殊格式可能需要 Windows 解碼器。');
      }
      await request('convertBegin',fields);
      try {
        for (let offset=0; offset<blob.size; offset+=batchBytes) {
          const data = await readData(blob.slice(offset,offset+batchBytes,blob.type));
          await request('convertChunk',{data});
        }
        return await request('convertFinish');
      } catch (error) {
        await request('convertAbort').catch(()=>{});
        throw error;
      }
    }
    $('convertPick').addEventListener('click',()=>add('toolPick'));
    addDrop($('convertDrop'),files=>add('toolDrop',files));
    $('convertFiles').addEventListener('change',controls);
    $('convertClear').addEventListener('click',()=>{ entries.clear(); paintFiles(); });
    $('convertRemove').addEventListener('click',()=>{
      for (const option of $('convertFiles').selectedOptions) entries.delete(option.value);
      paintFiles();
    });
    $('convertFolder').addEventListener('click',async()=>{
      try {
        const folder = await request('toolFolder',{tool:'convert'});
        if (!folder) return;
        shared = true;
        $('convertReset').hidden = false;
        $('convertDestination').textContent = folder;
      } catch (error) { status(error.message); }
    });
    $('convertReset').addEventListener('click',()=>{
      shared = false;
      $('convertReset').hidden = true;
      $('convertDestination').textContent = '各來源資料夾內的「轉檔輸出」子資料夾';
    });
    for (const id of ['convertCancel','convertCancelNarrow']) $(id).addEventListener('click',()=>{
      stopping = true;
      $('convertCancel').disabled = $('convertCancelNarrow').disabled = true;
    });
    $('convertOpen').addEventListener('click',async()=>{
      try { await request('toolOpen',{tool:'convert',index:Number($('convertResultFolder').value)}); }
      catch (error) { status(error.message); }
    });
    $('convertStart').addEventListener('click',async()=>{
      if (busy || !entries.size) return;
      busy = true;
      stopping = false;
      $('convertCancel').disabled = false;
      $('convertCancelNarrow').disabled = false;
      $('convertResults').replaceChildren();
      $('convertOpenRow').hidden = true;
      folders.clear();
      const format = $('convertFormat').value;
      $('convertProgress').max = entries.size;
      $('convertProgress').value = 0;
      $('convertProgress').hidden = false;
      controls();
      if (matchMedia('(max-width:699px),(max-height:540px)').matches)
        $('convertTool').querySelector('[data-tool-pane-target=output]').click();
      let completed = 0, success = 0, failed = 0;
      try {
        await request('convertReset');
        for (const file of entries.values()) {
          if (stopping) break;
          status('正在轉檔 · '+file.name);
          const item = document.createElement('li');
          try {
            const result = await convert(file,format);
            folders.set(result.index,result.folder);
            success += result.names.length;
            item.textContent = file.name+' → '+result.names.join('、');
          } catch (error) {
            failed++;
            item.className = 'failed';
            item.textContent = file.name+' · '+error.message;
          }
          $('convertResults').append(item);
          $('convertProgress').value = ++completed;
        }
        $('convertResultFolder').replaceChildren(...[...folders].map(([id,folder])=>new Option(folder,id)));
        $('convertResultFolder').hidden = folders.size < 2;
        $('convertOpenRow').hidden = folders.size === 0;
        status((stopping?'已停止。':'處理完成。')+' 已處理 '+completed+'／'+entries.size+' 個檔案，輸出 '+success+' 張，失敗 '+failed+' 項。');
      } catch (error) { status(error.message); }
      finally { busy = false; controls(); }
    });
    paintFiles();
  }
  globalThis.CampConvert = {init};
})();
