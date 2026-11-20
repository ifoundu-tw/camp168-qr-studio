
(function () {
  'use strict';

  class UserError extends Error {}
  const errorMessage = (error,fallback) => error instanceof UserError ? error.message : fallback;

  const defaultBase = 'https://www.camp168.com/searchall-products/?keywords=';
  const defaults = Object.freeze({
    module: 'square', paint: 'solid', angle: 'diag', ink: '#000000', ink2: '#00369a',
    bg: '#ffffff', transparent: false, outer: 'square', inner: 'square',
    eyeOuter: '#000000', eyeInner: '#000000', ecc: 'H', margin: 4, version: 0,
    center: 'digits', badge: 'square', width: 30, textColor: '#000000',
    font: 'sans', fontSize: 0, text: '', logo: '', x: 0, y: 0, frame: ''
  });
  const presets = [
    {name:'純黑白', ink:'#000000'},
    {name:'鈷藍', ink:'#00339e', outer:'soft', badge:'pill'},
    {name:'深藍漸層', ink:'#00173f', ink2:'#005276', paint:'linear', outer:'soft', badge:'cut'},
    {name:'皇家紫', ink:'#53008c', module:'soft', outer:'soft', badge:'oval'},
    {name:'正紅', ink:'#9d001d', font:'serif'},
    {name:'深琥珀', ink:'#753400', module:'soft', outer:'soft', font:'serif', badge:'oval'},
    {name:'海軍藍', ink:'#001c56', font:'narrow', badge:'cut'},
    {name:'墨綠', ink:'#004e2b', module:'soft', badge:'shield'},
    {name:'靛藍圓點', ink:'#270070', module:'dot', outer:'soft', font:'mono', badge:'oval'},
    {name:'黑橘', ink:'#000000', textColor:'#9d2d00', badge:'pill', font:'narrow'}
  ];

  function presetAt(index) {
    const {name, ...look} = presets[index];
    return {...defaults, eyeOuter:look.ink, eyeInner:look.ink, textColor:look.ink, ...look};
  }

  function parseBatch(raw, base) {
    const lines = raw.replace(/^\uFEFF/, '').trim().split(/\r?\n/);
    const columnNames = /^(?:suffix|keywords?|code|尾綴|商品尾綴)$/i;
    const header = lines[0].split(/[,，\t]/).map(cell => cell.trim().replace(/^"|"$/g, ''));
    const col = header.findIndex(cell => columnNames.test(cell));
    const tokens = col >= 0
      ? lines.slice(1).map(line => (line.split(/[,，\t]/)[col] || '').trim().replace(/^"|"$/g, '')).filter(Boolean)
      : raw.split(/[\s,，;；]+/).map(cell => cell.replace(/^"|"$/g, '')).filter(Boolean);
    const invalid = [...new Set(tokens.filter(token => !/^[\w-]+$/.test(token)))];
    const valid = [...new Set(tokens.filter(token => /^[\w-]+$/.test(token)))];
    base = base.trim();
    let badBase = false;
    try {
      const probe = new URL(base.replaceAll('{suffix}', 'qr') + (base.includes('{suffix}') ? '' : 'qr'));
      badBase = !/^https?:$/.test(probe.protocol);
    } catch {
      badBase = true;
    }
    const items = badBase ? [] : valid.map(name => {
      const encoded = encodeURIComponent(name);
      const target = base.includes('{suffix}') ? base.replaceAll('{suffix}', encoded) : base + encoded;
      return { name, target, digits: name.match(/\d+$/)?.[0] || '' };
    });
    return {items, invalid, badBase, duplicates: tokens.length - valid.length - tokens.filter(t => !/^[\w-]+$/.test(t)).length};
  }

  const wifiEscape = value => value.replace(/([\\;,":])/g, '\\$1');
  function singleTarget(type, data) {
    const field = data.main.trim();
    if (!field) return '';
    if (type === 'url') {
      let parsed;
      try { parsed = new URL(field); } catch { throw new UserError('請輸入完整網址，包含 https://。'); }
      if (!/^https?:$/.test(parsed.protocol)) throw new UserError('網址需以 http:// 或 https:// 開頭。');
      return field;
    }
    if (type === 'text') return data.main;
    if (type === 'wifi') return 'WIFI:T:' + data.security + ';S:' + wifiEscape(field) +
      (data.security === 'nopass' ? '' : ';P:' + wifiEscape(data.extra)) + ';;';
    if (type === 'email') {
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(field)) throw new UserError('請輸入有效的電子郵件地址。');
      const query = new URLSearchParams();
      if (data.extra) query.set('subject', data.extra);
      if (data.body) query.set('body', data.body);
      return 'mailto:' + field + (query.size ? '?' + query.toString().replaceAll('+', '%20') : '');
    }
    if (!/^\+?[\d ().-]+$/.test(field)) throw new UserError('請輸入有效的電話號碼。');
    const tel = field.replace(/[ ().-]/g, '');
    return type === 'phone' ? 'tel:' + tel : 'sms:' + tel + (data.extra ? '?body=' + encodeURIComponent(data.extra) : '');
  }

  const encoder = new TextEncoder();
  function makeEncoder(target, settings) {
    const bytes = encoder.encode(target);
    const qr = new AraseQR.QRCode(settings.version || -1, AraseQR.levels[settings.ecc]);
    qr.trackCodewords = true;
    qr.addData(Array.from(bytes, byte => String.fromCharCode(byte)).join(''));
    try { qr.make(); } catch { throw new UserError('內容超過目前 QR 版本或容錯等級的容量。'); }
    return qr;
  }

  function maskVariants(qr) {
    if (qr.variants) return qr.variants;
    const preferred = qr.modules;
    const variants = [preferred];
    for (let mask=0; mask<8; mask++) {
      if (mask === qr.maskPattern) continue;
      qr.makeImpl(false,mask);
      variants.push(qr.modules);
    }
    qr.modules = preferred;
    qr.variants = variants;
    return variants;
  }

  function correctionBlocks(qr) {
    const blocks = AraseQR.blocks(qr.typeNumber,qr.errorCorrectLevel);
    const limit = blocks.map(block => Math.floor((block.totalCount-block.dataCount)/2));
    const wordBlock = [-1];
    for (const length of [block=>block.dataCount,block=>block.totalCount-block.dataCount]) {
      const lengths = blocks.map(length);
      for (let byte=0;byte<Math.max(...lengths);byte++) {
        lengths.forEach((count,index) => { if (byte < count) wordBlock.push(index); });
      }
    }
    return {limit,wordBlock};
  }

  function chooseMask(qr, clearing, count) {
    if (!clearing.length) return qr.modules;
    const {limit,wordBlock} = qr.correctionBlocks ??= correctionBlocks(qr);
    let best, bestScore = Infinity;
    for (const matrix of maskVariants(qr)) {
      const seen = new Uint8Array(wordBlock.length);
      const damage = new Uint16Array(limit.length);
      let words = 0, dots = 0;
      for (const index of clearing) {
        const row = Math.floor(index/count), col = index%count;
        if (!matrix[row][col]) continue;
        dots++;
        const word = qr.codewordAt[index];
        if (seen[word]) continue;
        seen[word] = 1;
        damage[wordBlock[word]]++;
        words++;
      }
      // A block that runs out of correction capacity cannot borrow it from another block.
      const worst = Math.max(...limit.map((capacity,index)=>damage[index]/capacity));
      const score = worst*10000 + words*4 + dots/Math.max(1,clearing.length);
      if (score < bestScore) { best = matrix; bestScore = score; }
    }
    return best;
  }

  const xml = value => String(value).replace(/[&<>"']/g, c => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&apos;'
  })[c]);
  const n = value => Number(value.toFixed(3));
  const fonts = {
    sans: '"Arial","Microsoft JhengHei",sans-serif', serif: 'Georgia,serif',
    mono: 'Consolas,monospace', narrow: 'Impact,"Arial Narrow",sans-serif'
  };

  function fontFamily(selection) {
    if (!selection.startsWith('local:')) return fonts[selection] || fonts.sans;
    const name = selection.slice(6).replace(/[\\"]/g, c => '\\' + c).replace(/[\u0000-\u001f]/g,'');
    return '"' + name + '",' + fonts.sans;
  }

  let fontMeasure;
  const fontMetrics = new Map();
  function glyphBounds(text,family,size,{weight=400,letterSpacing=0}={}) {
    const width = Array.from(text).reduce((sum,char)=>sum+(/[^\x00-\x7f]/.test(char) ? 1 : .67),0)*size;
    const fallback = {left:0,right:width,ascent:.77*size,descent:.05*size};
    if (typeof document === 'undefined') return fallback;
    fontMeasure ??= document.createElement('canvas').getContext('2d');
    const scale = 4;
    fontMeasure.font = weight+' '+(size*scale)+'px '+family;
    fontMeasure.textAlign = 'left';
    fontMeasure.textBaseline = 'alphabetic';
    if ('letterSpacing' in fontMeasure) fontMeasure.letterSpacing = letterSpacing*scale+'px';
    const metrics = fontMeasure.measureText(text);
    if (!metrics.actualBoundingBoxAscent && !metrics.actualBoundingBoxDescent) return fallback;
    return {left:-metrics.actualBoundingBoxLeft/scale,right:metrics.actualBoundingBoxRight/scale,
      ascent:metrics.actualBoundingBoxAscent/scale,descent:metrics.actualBoundingBoxDescent/scale};
  }

  function textMetrics(text, font) {
    const key = JSON.stringify([text,font]);
    if (fontMetrics.has(key)) return fontMetrics.get(key);
    const shape = glyphBounds(text,fontFamily(font),100,{weight:700});
    const metrics = [Math.max(.2,(shape.right-shape.left)/100),Math.max(.4,(shape.ascent+shape.descent)/100)];
    if (fontMetrics.size >= 192) fontMetrics.clear();
    fontMetrics.set(key,metrics);
    return metrics;
  }

  function badgeFontSizing(badge,s,count,outputWidth) {
    if (!badge?.text || !outputWidth) return {max:0,actual:0};
    const [textWidth,textHeight] = textMetrics(badge.text,s.font);
    const unitsToPixels = outputWidth / (count + 2*s.margin);
    const max = Math.max(1,Math.floor(Math.min(badge.width*.76/textWidth,badge.height*.68/textHeight)*unitsToPixels));
    return {max,actual:s.fontSize ? Math.min(s.fontSize,max) : Math.max(1,Math.floor(max*.83))};
  }

  function fontSizing(item,s,qr,outputWidth) {
    return badgeFontSizing(badgeLayout(item,s,qr.moduleCount),s,qr.moduleCount,outputWidth);
  }

  function rectPath(x, y, side, radius) {
    if (!radius) return 'M'+x+','+y+'h'+side+'v'+side+'h-'+side+'z';
    const end = side - radius;
    return 'M'+n(x+radius)+','+y+'h'+n(side-2*radius)+'q'+radius+',0 '+radius+','+radius+
      'v'+n(side-2*radius)+'q0,'+radius+' -'+radius+','+radius+'h-'+n(side-2*radius)+
      'q-'+radius+',0 -'+radius+',-'+radius+'V'+n(y+radius)+'q0,-'+radius+' '+radius+',-'+radius+'z';
  }

  function cellPath(x, y, module) {
    if (module === 'dot') {
      const cy = y + .5;
      return 'M'+n(x+.04)+','+cy+'a.46,.46 0 1 0 .92,0a.46,.46 0 1 0 -.92,0z';
    }
    if (module === 'diamond') {
      return 'M'+n(x+.5)+','+y+' '+n(x+1)+','+n(y+.5)+' '+n(x+.5)+','+n(y+1)+' '+x+','+n(y+.5)+'z';
    }
    return rectPath(x, y, 1, module === 'soft' ? .14 : 0);
  }

  const finderRadius = {square:0, soft:.95, round:1.7};
  function finder(x, y, s) {
    const inside = s.inner === 'round'
      ? '<circle cx="'+(x+3.5)+'" cy="'+(y+3.5)+'" r="1.52"'
      : '<path d="'+rectPath(x+2,y+2,3,s.inner === 'soft' ? .64 : 0)+'"';
    return '<path fill="'+s.eyeOuter+'" fill-rule="evenodd" d="'+rectPath(x,y,7,finderRadius[s.outer])+
      rectPath(x+1,y+1,5,Math.max(0,finderRadius[s.outer]-.45))+'"/>'+inside+' fill="'+s.eyeInner+'"/>';
  }

  function badgeLayout(item, s, count) {
    const text = s.center === 'digits' ? item.digits : s.center === 'text' ? s.text : '';
    const logo = s.center === 'logo' ? s.logo : '';
    if (!text && !logo) return null;
    const width = n(count * s.width / 100);
    const ratio = s.badge === 'circle' || logo ? 1 : s.badge === 'oval' ? .73 : s.badge === 'shield' ? .8 : .64;
    const height = n(width*ratio);
    return {text,logo,width,height,x:n((count-width)/2+count*s.x/100),y:n((count-height)/2+count*s.y/100)};
  }

  function clearsCell(badge, shape, col, row) {
    const {x,y,width,height} = badge;
    const gap = .3;
    const dx = Math.abs(col+.5-x-width/2);
    const dy = row+.5-y;
    const vertical = Math.abs(dy-height/2);
    const horizontalLimit = width/2 + gap;
    const verticalLimit = height/2 + gap;
    if (dx >= horizontalLimit || vertical >= verticalLimit) return false;
    if (shape === 'oval' || shape === 'circle') {
      return (dx/horizontalLimit)**2 + (vertical/verticalLimit)**2 < 1;
    }
    if (shape === 'pill') {
      return Math.max(0,dx-(width-height)/2)**2 + vertical**2 < verticalLimit**2;
    }
    if (shape === 'cut') {
      const cut = n(height*.19);
      return dx+vertical < width/2+height/2-cut+gap*Math.SQRT2;
    }
    if (shape === 'shield' && dy > height*.66) {
      return dx < (width/2)*Math.max(0,1-(dy-height*.66)/(height*.34)) + gap;
    }
    return true;
  }

  function centralBadge(badge, s, count, margin, outputWidth) {
    if (!badge) return '';
    const {text,logo,width,height,x,y} = badge;
    let background;
    if (s.badge === 'oval' || s.badge === 'circle') {
      background = '<ellipse cx="'+width/2+'" cy="'+height/2+'" rx="'+width/2+'" ry="'+height/2+'" fill="#fff"/>';
    } else if (s.badge === 'shield') {
      background = '<path d="M0 0H'+width+'V'+n(height*.66)+'L'+n(width/2)+' '+height+' 0 '+n(height*.66)+'Z" fill="#fff"/>';
    } else if (s.badge === 'cut') {
      const cut = n(height*.19);
      background = '<path d="M'+cut+' 0H'+n(width-cut)+'L'+width+' '+cut+'V'+n(height-cut)+
        'L'+n(width-cut)+' '+height+'H'+cut+'L0 '+n(height-cut)+'V'+cut+'Z" fill="#fff"/>';
    } else {
      background = '<rect width="'+width+'" height="'+height+'" rx="'+(s.badge === 'pill' ? n(height/2) : 0)+'" fill="#fff"/>';
    }
    let mark;
    if (logo) {
      const padding = n(width * (s.badge === 'circle' || s.badge === 'shield' ? .18 : .12));
      mark = '<image x="'+padding+'" y="'+padding+'" width="'+n(width-2*padding)+'" height="'+
        n(height-2*padding)+'" preserveAspectRatio="xMidYMid meet" href="'+xml(logo)+'"/>';
    } else {
      const referenceWidth = outputWidth || 1024;
      const {actual} = badgeFontSizing(badge,s,count,referenceWidth);
      const fontSize = n(actual*(count + 2*margin)/referenceWidth);
      const family = fontFamily(s.font);
      const shape = glyphBounds(text,family,fontSize,{weight:700});
      mark = '<text x="'+n(width/2-(shape.left+shape.right)/2)+'" y="'+
        n(height*(s.badge === 'shield' ? .49 : .5)+(shape.ascent-shape.descent)/2)+'" fill="'+s.textColor+
        '" font-family="'+xml(family)+
        '" font-weight="700" font-size="'+fontSize+'">'+xml(text)+'</text>';
    }
    return '<g transform="translate('+n(x+margin)+' '+n(y+margin)+')">'+background+mark+'</g>';
  }

  function svgFor(item, s, width, qr = makeEncoder(item.target,s)) {
    const count = qr.moduleCount;
    const margin = s.margin;
    const badge = badgeLayout(item,s,count);
    const cleared = new Uint8Array(count*count);
    const clearing = [];
    if (badge) for (let y=0;y<count;y++) for (let x=0;x<count;x++) {
      const index = y*count+x;
      if (qr.codewordAt[index] && clearsCell(badge,s.badge,x,y)) {
        cleared[index] = 1;
        clearing.push(index);
      }
    }
    const matrix = chooseMask(qr,clearing,count);
    const total = count + 2*margin;
    const labelBand = s.frame.trim() ? n(total*.14) : 0;
    const height = width ? Math.round(width*(total+labelBand)/total) : undefined;
    const sizing = width ? ' width="'+width+'" height="'+height+'"' : '';
    const parts = ['<svg xmlns="http://www.w3.org/2000/svg"'+sizing+' viewBox="0 0 '+total+' '+n(total+labelBand)+'">'];
    if (!s.transparent) parts.push('<rect width="'+total+'" height="'+n(total+labelBand)+'" fill="'+s.bg+'"/>');
    let fill = s.ink;
    if (s.paint !== 'solid') {
      const tag = s.paint === 'linear' ? 'linearGradient' : 'radialGradient';
      const direction = s.paint === 'radial' ? '' : s.angle === 'down' ? ' x2="0%" y2="100%"' :
        s.angle === 'diag' ? ' x2="100%" y2="100%"' : ' x2="100%" y2="0%"';
      parts.push('<defs><'+tag+' id="colors"'+direction+'><stop offset="0" stop-color="'+s.ink+
        '"/><stop offset="1" stop-color="'+s.ink2+'"/></'+tag+'></defs>');
      fill = 'url(#colors)';
    }
    let path = '';
    for (let y=0; y<count; y++) for (let x=0; x<count; x++) {
      const eye = (y < 7 && (x < 7 || x >= count-7)) || (y >= count-7 && x < 7);
      if (!eye && matrix[y][x] && !cleared[y*count+x]) {
        const shape = (x === 6 || y === 6) ? 'square' : s.module;
        path += cellPath(x+margin,y+margin,shape);
      }
    }
    parts.push('<path fill="'+fill+'"'+(s.module === 'square' ? ' shape-rendering="crispEdges"' : '')+' d="'+path+'"/>');
    const far = count+margin-7;
    parts.push(finder(margin,margin,s), finder(far,margin,s), finder(margin,far,s), centralBadge(badge,s,count,margin,width));
    if (labelBand) {
      const length = Math.max(1,Array.from(s.frame.trim()).length);
      const fontSize = n(Math.min(labelBand*.47,total*.86/length));
      parts.push('<rect y="'+total+'" width="'+total+'" height="'+labelBand+'" fill="'+s.eyeOuter+'"/>');
      parts.push('<text x="'+total/2+'" y="'+n(total+labelBand*.52)+'" text-anchor="middle" dominant-baseline="central" '+
        'font-family="'+xml(fonts.sans)+'" font-size="'+fontSize+'" font-weight="700" fill="#fff">'+xml(s.frame.trim())+'</text>');
    }
    parts.push('</svg>');
    return parts.join('');
  }

  globalThis.CampQR = {UserError,errorMessage,defaults,presets,presetAt,defaultBase,parseBatch,singleTarget,
    makeEncoder,fontFamily,glyphBounds,fontSizing,svgFor,xml};
})();
