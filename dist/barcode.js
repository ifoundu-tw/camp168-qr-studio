
(function () {
  'use strict';

  const {UserError,fontFamily,glyphBounds,xml} = CampQR;
  const barcodeViewBox = /\bviewBox="0 0 ([\d.]+) ([\d.]+)"/;
  const reference = [
    ['code128','Code 128（自動）'], ['code128a','Code 128 A','CAMP168'],
    ['code128b','Code 128 B','Camp168'], ['code128c','Code 128 C','0123456789'],
    ['gs1-128','UCC／EAN-128（GS1-128）'], ['ean13','GTIN-13／EAN-13','471123456789'],
    ['ean8','GTIN-8／EAN-8','4711234'], ['upca','UPC-A（UPC）','03600029145'],
    ['code39','Code 39','CAMP-168'], ['itf14','ITF-14','1001234567890'],
    ['msi','MSI','123456'], ['msi10','MSI-10','123456'], ['msi11','MSI-11','123456'],
    ['msi1010','MSI-1010','123456'], ['msi1110','MSI-1110','123456'],
    ['pharmacode','Pharmacode'], ['rationalizedCodabar','Codabar','A123456B'],
    ['qrcode','QR Code'], ['datamatrix','Data Matrix'], ['pdf417','PDF417']
  ];
  const matrixPattern = /qrcode|datamatrix|pdf417|aztec|codeone|hanxin|dotcode|ultracode|maxicode|codablock|code16k|code49|composite|gs1-cc|^d3aqr$/i;
  const postalPattern = /^(auspost|identcode|leitcode|onecode|postnet|planet|royalmail|kix|japanpost|mailmark|daft|flattermarken)$/;
  const formats = {
    code128:'Code128', code128a:'Code128', code128b:'Code128', code128c:'Code128', 'gs1-128':'Code128',
    ean13:'EAN13', ean8:'EAN8', upca:'UPCA', upce:'UPCE', code39:'Code39Std', code39ext:'Code39Ext',
    code93:'Code93', code93ext:'Code93', code32:'Code32', pzn:'PZN', rationalizedCodabar:'Codabar',
    interleaved2of5:'ITF', itf14:'ITF14', qrcode:'QRCode', gs1qrcode:'QRCode', microqrcode:'MicroQRCode',
    rectangularmicroqrcode:'RMQRCode', datamatrix:'DataMatrix', gs1datamatrix:'DataMatrix',
    datamatrixrectangular:'DataMatrix', gs1datamatrixrectangular:'DataMatrix', pdf417:'PDF417',
    pdf417compact:'CompactPDF417', micropdf417:'MicroPDF417', azteccode:'AztecCode',
    azteccodecompact:'AztecCode', aztecrune:'AztecRune', maxicode:'MaxiCode', telepen:'Telepen'
  };
  const checks = {msi10:'mod10', msi11:'mod11', msi1010:'mod1010', msi1110:'mod1110'};
  const hints = {
    code128a:'可使用大寫 A–Z、數字與部分 ASCII 符號。',
    code128b:'可使用大小寫英文字母、數字與 ASCII 符號。',
    code128c:'請輸入偶數位數字。',
    'gs1-128':'使用 GS1 應用識別碼，例如 (01)09506000134352(10)LOT123。',
    ean13:'輸入 12 位數字自動補檢核碼，或輸入完整 13 位。',
    ean8:'輸入 7 位數字自動補檢核碼，或輸入完整 8 位。',
    upca:'輸入 11 位數字自動補檢核碼，或輸入完整 12 位。',
    itf14:'輸入 13 位數字自動補檢核碼，或輸入完整 14 位。',
    rationalizedCodabar:'以 A、B、C 或 D 開頭和結尾，例如 A123456B。'
  };
  const extras = new Map(bwipjs.symbolList.map(spec => [spec.bcid,spec]));
  const common = reference.map(([id,label,sample]) => {
    const base = extras.get(id) || extras.get(id.startsWith('msi') ? 'msi' : 'code128');
    return {...base,id,label,sample:sample ?? base.text,common:true};
  });
  const used = new Set(common.map(item=>item.id));
  const additional = [...extras.values()].filter(spec=>!used.has(spec.bcid))
    .map(spec=>({...spec,id:spec.bcid,label:spec.desc,sample:spec.text}))
    .sort((a,b)=>a.label.localeCompare(b.label,'en'));
  const catalog = [...common,...additional].map(spec => ({
    ...spec,
    kind: matrixPattern.test(spec.bcid) ? 'matrix' : postalPattern.test(spec.bcid) ? 'postal' : 'linear',
    scan:formats[spec.id],
    hint:hints[spec.id] || ''
  }));
  const get = id => catalog.find(spec=>spec.id===id);

  function raw128(set,payload) {
    const start = {a:103,b:104,c:105}[set];
    let words;
    if (set === 'c') {
      if (!/^(?:\d\d)+$/.test(payload)) throw new UserError('Code 128 C 需要偶數位數字。');
      words = payload.match(/../g).map(Number);
    } else {
      const allowed = set === 'a' ? /^[\x00-\x5f]+$/ : /^[\x20-\x7f]+$/;
      if (!allowed.test(payload)) throw new UserError(set === 'a'
        ? 'Code 128 A 請使用大寫英文字母、數字或半形符號。'
        : 'Code 128 B 請使用英文字母、數字或半形符號。');
      words = Array.from(payload,char=>char.charCodeAt(0)<32 ? char.charCodeAt(0)+64 : char.charCodeAt(0)-32);
    }
    return [start,...words].map(word=>'^'+String(word).padStart(3,'0')).join('');
  }

  const digitCounts = {ean13:[12,13],ean8:[7,8],upca:[11,12],itf14:[13,14]};

  function encodingError(spec,error) {
    const raw = String(error?.message ?? error);
    const [,id = '',description = raw] = /^(bwipp\.[^:]+):\s*(.*)$/s.exec(raw) || [];
    const reason = id.toLowerCase();
    const aiNumber = /^AI\s+(\d{2,4}):/i.exec(description)?.[1];
    const subject = aiNumber ? '應用識別碼（AI）'+aiNumber+' 的資料' : '條碼內容';
    const prefix = (message) => new UserError(message);
    if (/checksum|check.?digit|check.?character/.test(reason) || /incorrect .*check digit|bad checksum/i.test(description)) {
      const count = digitCounts[spec.id]?.[0];
      return prefix(aiNumber ? subject+'檢核碼有誤，請重新核對。' : count
        ? '末位檢核碼不正確。可只輸入前 '+count+' 位數字，讓程式自動補上檢核碼。'
        : '檢核碼不正確，請核對原始號碼和資料格式。');
    }
    if (/addon/.test(reason)) return prefix('附加碼格式不正確。請確認附加碼是 2 位或 5 位數字。');
    if (/missingopenparen|missingcloseparen|missingparen|badai|unknownai|invalidai|badailength/.test(reason)) {
      return prefix('GS1 應用識別碼格式不正確。請使用半形括號標示識別碼，例如 (01) 後面接商品號碼。');
    }
    if (/badstartstop|badstartcharacter|badstopcharacter/.test(reason)) {
      if (spec.bcid === 'rationalizedCodabar') return prefix('Codabar 開頭和結尾都要使用 A、B、C 或 D，例如 A123456B。');
      return prefix('開頭或結尾的字元不符合此碼種規則。請按「帶入範例」對照格式。');
    }
    if (/novalidsymbol|inputtoolong|maxlength|maximum length|data is too long/.test(reason+' '+description.toLowerCase())) {
      return prefix('資料太長或格式超出此碼種能容納的範圍。請縮短資料，或改用容量較大的碼種。');
    }
    if (/length|tooshort|toolong|badcount/.test(reason) || /too short|wrong length/i.test(description)) {
      const counts = digitCounts[spec.id];
      if (counts) return prefix('請輸入 '+counts[0]+' 位數字自動補檢核碼，或輸入完整 '+counts[1]+' 位。');
      if (aiNumber) return prefix(subject+'長度不正確。請核對該識別碼需要的位數。');
      const lengths = /must be ((?:\d+\s*(?:,\s*|or\s+)?)+)\s*(digits|characters)/i.exec(description);
      if (lengths) {
        const unit = lengths[2].toLowerCase() === 'digits' ? '位數字' : '個字元';
        const qualifier = /excluding check digit/i.test(description) ? '（不含檢核碼）' : '';
        return prefix('請輸入 '+lengths[1].match(/\d+/g).join('、')+' '+unit+qualifier+'。');
      }
      return prefix('資料長度不符合此碼種的規則。請按「帶入範例」查看需要的位數。');
    }
    if (/badcharacter|invalidcharacter|illegalcharacter|baddata|badcharset|character|alphabet/.test(reason) ||
        /only digits|invalid character|non.?numeric/i.test(description)) {
      if (spec.id === 'code39') return prefix('Code 39 只能使用大寫英文字母、數字、空格及半形符號 - . $ / + %。');
      if (/only digits|numeric|digits only/i.test(description)) return prefix(subject+'只能使用半形數字 0–9。');
      return prefix(subject+'含有此碼種不支援的字元。請按「帶入範例」確認允許的字元。');
    }
    const range = /between (\d+) and (\d+)/i.exec(description);
    if (range && /value|range|number/.test(reason)) return prefix('請輸入 '+range[1]+' 到 '+range[2]+' 之間的數字。');
    if (/empty|missingdata|no data/i.test(reason+' '+description)) return prefix('請輸入條碼內容，再重新產生。');
    return prefix('資料不符合所選碼種的編碼規則。請按「帶入範例」對照格式，再重新產生。');
  }

  function optionsFrom(spec) {
    const options = {};
    for (const option of spec.opts.split(/\s+/).filter(Boolean)) {
      const [name,value] = option.split('=');
      options[name] = value ?? true;
    }
    if (spec.common && /^(msi|code39|rationalizedCodabar)/.test(spec.id)) {
      delete options.includecheck;
      delete options.includecheckintext;
    }
    if (checks[spec.id]) {
      options.includecheck = true;
      options.includecheckintext = true;
      options.checktype = checks[spec.id];
    }
    return options;
  }

  function customText(text,center,y,size,family,color,maxWidth,letterSpacing,bounds) {
    const width = Math.max(1,bounds.right-bounds.left);
    const fit = Math.min(1,maxWidth/width);
    const x = center-(bounds.left+bounds.right)/2*fit;
    return '<text transform="translate('+x+' '+y+') scale('+fit+' 1)" fill="#'+color+
      '" font-family="'+xml(family)+'" font-size="'+size+'" letter-spacing="'+letterSpacing+
      '" xml:space="preserve">'+xml(text)+'</text>\n';
  }

  function svgWithCaption(spec,options,payload,style,outputWidth) {
    const drawing = bwipjs.drawingSVG();
    const original = {...drawing};
    const labels = new Map();
    let top = Infinity, bottom = -Infinity, left = Infinity, right = -Infinity, padTop, padBottom, padLeft;
    let nextMarker = 0x010000;
    const ink = options.textcolor.toLowerCase();
    const requestedText = style.textOverride?.trim().replaceAll('{內容}',payload);
    const localFamily = style.font?.startsWith('local:') ? fontFamily(style.font) : '';

    drawing.setopts = function(config) {
      ({paddingtop:padTop,paddingbottom:padBottom,paddingleft:padLeft} = config);
      original.setopts.call(this,config);
    };
    function include(x,y) {
      left = Math.min(left,x);
      right = Math.max(right,x);
      top = Math.min(top,y);
      bottom = Math.max(bottom,y);
    }
    drawing.line = function(x1,y1,x2,y2,stroke,color) {
      const width = Math.round(stroke) || 1;
      const half = width/2;
      const adjust = width%2 ? -.5 : 0;
      if ((y1|0) === (y2|0)) {
        include((x1|0)+1,(y1|0)+adjust-half);
        include(x2|0,(y1|0)+adjust+half);
      } else if ((x1|0) === (x2|0)) {
        include((x1|0)+adjust-half,(y1|0)+1);
        include((x2|0)+adjust+half,y2|0);
      } else {
        include(x1|0,y1|0);
        include(x2|0,y2|0);
      }
      original.line.call(this,x1,y1,x2,y2,stroke,color);
    };
    drawing.polygon = function(points) {
      for (const [x,y] of points) include(x,y);
      original.polygon.call(this,points);
    };
    drawing.text = function(x,y,text,color,font) {
      let marker;
      do { marker = (nextMarker++).toString(16).padStart(6,'0'); }
      while (marker === ink || marker === options.backgroundcolor);
      const {ascent,descent,width} = drawing.measure(text,font.name,font.width,font.height);
      labels.set(marker,{x:x|0,y:y|0,text,color,font,ascent,descent,width});
      original.text.call(this,x,y,text,marker,font);
    };
    let svg = bwipjs.render(options,drawing);
    const [,viewWidth,viewHeight] = barcodeViewBox.exec(svg) || [];
    const numericWidth = Number(viewWidth);
    const symbolCenter = (left+right)/2+padLeft;
    const lower = [...labels.values()].filter(label=>!label.font.rotate && label.y >= (top+bottom)/2);
    const moduleDistance = (style.textDistance ?? 8)*numericWidth/outputWidth;
    const desiredTop = bottom+padTop+moduleDistance;
    const synthetic = requestedText || (!lower.length && !['ean2','ean5'].includes(spec.id) ? payload : '');
    let finalHeight = Number(viewHeight);
    let replacementText = '';
    if (Number.isFinite(desiredTop)) {
      if (synthetic) {
        const family = localFamily || fontFamily('mono');
        const size = style.textSize*options.scale;
        const letterSpacing = style.textGap*options.scale;
        const bounds = glyphBounds(synthetic,family,size,{letterSpacing});
        const {ascent,descent} = bounds;
        const baseline = desiredTop+ascent;
        const maxWidth = Math.max(1,2*Math.min(symbolCenter,numericWidth-symbolCenter)-2*padLeft);
        replacementText = customText(synthetic,symbolCenter,baseline,size,family,ink,maxWidth,letterSpacing,bounds);
        finalHeight = Math.max(finalHeight,baseline+descent+padBottom);
      } else if (lower.length) {
        if (localFamily) for (const label of lower) {
          const letterSpacing = label.font.dx || 0;
          label.bounds = glyphBounds(label.text,localFamily,label.font.height,{letterSpacing});
          label.ascent = label.bounds.ascent;
          label.descent = label.bounds.descent;
        }
        const oldTop = Math.min(...lower.map(label=>label.y+padTop-label.ascent));
        const shift = desiredTop-oldTop;
        for (const label of lower) {
          label.shift = shift;
          finalHeight = Math.max(finalHeight,label.y+padTop+shift+label.descent+padBottom);
        }
      }
    }
    svg = svg.replace(/<path\b[^>]* fill="#([0-9a-f]{6})"[^>]*\/>/gi,(path,marker) => {
      const label = labels.get(marker);
      if (!label) return path;
      const originalPath = path.replace('fill="#'+marker+'"','fill="#'+label.color+'"');
      if (replacementText && lower.includes(label)) return '';
      if (label.shift === undefined) return originalPath;
      if (localFamily) {
        // EAN/UPC have separate digit positions, while ordinary labels are a single line.
        const center = lower.length === 1 ? symbolCenter : label.x+padLeft+label.width/2;
        const maxWidth = lower.length === 1 ? Math.max(1,right-left) : Math.max(1,label.width);
        return customText(label.text,center,label.y+padTop+label.shift,label.font.height,
          localFamily,label.color,maxWidth,label.font.dx || 0,label.bounds);
      }
      return '<g transform="translate(0 '+label.shift+')">'+originalPath+'</g>';
    });
    return svg.replace(barcodeViewBox,'viewBox="0 0 '+viewWidth+' '+Math.ceil(finalHeight)+'"')
      .replace('</svg>',()=>replacementText+'</svg>');
  }

  function render(spec,payload,style,width) {
    const options = {
      ...optionsFrom(spec), bcid:spec.bcid, text:payload,
      scale:3, paddingwidth:style.marginX, paddingheight:style.marginY,
      barcolor:style.ink.slice(1), textcolor:style.ink.slice(1),
      ...(style.transparent ? {} : {backgroundcolor:style.bg.slice(1)})
    };
    if (spec.kind !== 'matrix') {
      options.includetext = style.text;
      if (!style.text) { delete options.includecheckintext; delete options.guardwhitespace; }
      options.textsize = style.textSize;
      options.textgaps = style.textGap;
      if (spec.kind === 'linear') options.height = style.height;
    }
    if (/^code128[abc]$/.test(spec.id)) {
      options.raw = true;
      options.text = raw128(spec.id.at(-1),payload);
      options.alttext = payload;
    }
    let svg;
    try {
      svg = style.text && spec.kind !== 'matrix' ? svgWithCaption(spec,options,payload,style,width) : bwipjs.toSVG(options);
    }
    catch (error) { throw encodingError(spec,error); }
    const viewBox = barcodeViewBox.exec(svg);
    if (!viewBox || Number(viewBox[1]) <= 0) throw new UserError('無法取得條碼尺寸。');
    const height = Math.max(1,Math.ceil(width * Number(viewBox[2])/Number(viewBox[1])));
    if (height > 16384) throw new UserError('輸出高度過大，請縮小影像寬度或條形高度。');
    return svg.replace('<svg ','<svg width="'+width+'" height="'+height+'" preserveAspectRatio="xMinYMin meet" ');
  }

  function csvRows(raw) {
    const rows = [];
    let fields = [], field = '', quoted = false;
    for (let i=0;i<raw.length;i++) {
      const char = raw[i];
      if (quoted) {
        if (char !== '"') field += char;
        else if (raw[i+1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else if (char === '"' && !field) quoted = true;
      else if (char === ',') { fields.push(field); field = ''; }
      else if (char === '\n') {
        fields.push(field.replace(/\r$/,''));
        rows.push(fields);
        fields = []; field = '';
      } else field += char;
    }
    if (quoted) throw new UserError('CSV 有尚未結束的引號。');
    fields.push(field.replace(/\r$/,''));
    rows.push(fields);
    const column = rows[0].findIndex(cell=>/^(barcode|data|code|payload|內容|條碼|條碼內容)$/i.test(cell.trim()));
    return rows.slice(column < 0 ? 0 : 1).map(row=>row[Math.max(column,0)] || '');
  }

  globalThis.CampBarcode = {catalog,get,render,csvRows};
})();
