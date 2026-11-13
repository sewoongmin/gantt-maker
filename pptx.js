/*
 * 간트 SVG → PowerPoint(.pptx)
 * 사각형·선·원·패스·글자를 PowerPoint 도형/텍스트 상자로 옮겨, 슬라이드에서 바로 고칠 수 있게 합니다.
 * PptxGenJS(vendor/pptxgen.bundle.js)는 처음 저장할 때만 불러옵니다.
 */
(function (global) {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';
  var LIB_SRC = 'vendor/pptxgen.bundle.js?v=4.0.1';
  var FONT = 'Malgun Gothic';
  var SLIDE_W = 13.333;
  var SLIDE_H = 7.5;
  var MARGIN = 0.3;
  var libPromise = null;

  function loadLib() {
    if (global.PptxGenJS) return Promise.resolve(global.PptxGenJS);
    if (libPromise) return libPromise;
    libPromise = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = LIB_SRC;
      s.onload = function () {
        if (global.PptxGenJS) resolve(global.PptxGenJS);
        else reject(new Error('PptxGenJS 를 불러오지 못했습니다'));
      };
      s.onerror = function () {
        libPromise = null;
        reject(new Error('vendor/pptxgen.bundle.js 를 불러오지 못했습니다'));
      };
      document.head.appendChild(s);
    });
    return libPromise;
  }

  /* ------------------------------------------------------------------ 색 */

  function parseColor(v) {
    if (!v || v === 'none' || v.indexOf('url(') === 0) return null;
    var m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?\s*\)/.exec(v);
    if (!m) return null;
    var a = m[4] === undefined ? 1 : m[4].slice(-1) === '%' ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    if (a <= 0) return null;
    var hex = [m[1], m[2], m[3]]
      .map(function (n) {
        var h = Math.round(+n).toString(16).toUpperCase();
        return h.length < 2 ? '0' + h : h;
      })
      .join('');
    return { hex: hex, a: a };
  }

  function transparency(alpha) {
    var t = Math.round((1 - alpha) * 100);
    return t > 0 ? Math.min(100, t) : 0;
  }

  /* SVG 점선 → PowerPoint 기본 점선 모양 */
  function dashType(cs) {
    var d = cs.strokeDasharray;
    if (!d || d === 'none') return null;
    var first = parseFloat(d);
    if (!(first > 0)) return null;
    if (first < 3) return 'sysDot';
    if (first < 4.5) return 'sysDash';
    return 'dash';
  }

  /* ------------------------------------------------------------- 좌표 변환 */

  function matrixOf(root, node) {
    var rm = root.getScreenCTM();
    var nm = node.getScreenCTM();
    if (!rm || !nm) return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
    return rm.inverse().multiply(nm);
  }

  function apply(m, x, y) {
    return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f };
  }

  function scaleOf(m) {
    return Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) || 1;
  }

  function opacityOf(node, root) {
    var o = 1;
    for (var n = node; n && n !== root.parentNode; n = n.parentNode) {
      if (n.nodeType !== 1) continue;
      var v = parseFloat(getComputedStyle(n).opacity);
      if (!isNaN(v)) o *= v;
    }
    return o;
  }

  /* ------------------------------------------------------------ 패스 해석 */

  function parsePath(d) {
    var tokens = String(d || '').match(/[MmLlHhVvCcSsQqTtAaZz]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g) || [];
    var out = [];
    var i = 0;
    var cmd = '';
    var x = 0;
    var y = 0;
    var sx = 0;
    var sy = 0;
    var lc = null;
    function num() {
      return parseFloat(tokens[i++]);
    }
    function more() {
      return i < tokens.length && !/[A-Za-z]/.test(tokens[i]);
    }
    while (i < tokens.length) {
      if (/[A-Za-z]/.test(tokens[i])) cmd = tokens[i++];
      var rel = cmd === cmd.toLowerCase();
      var C = cmd.toUpperCase();
      var bx = rel ? x : 0;
      var by = rel ? y : 0;
      if (C === 'Z') {
        out.push({ close: true });
        x = sx;
        y = sy;
        lc = null;
        continue;
      }
      if (!more()) {
        i++;
        continue;
      }
      if (C === 'M') {
        x = bx + num();
        y = by + num();
        sx = x;
        sy = y;
        out.push({ x: x, y: y, moveTo: true });
        cmd = rel ? 'l' : 'L';
        lc = null;
      } else if (C === 'L') {
        x = bx + num();
        y = by + num();
        out.push({ x: x, y: y });
        lc = null;
      } else if (C === 'H') {
        x = bx + num();
        out.push({ x: x, y: y });
        lc = null;
      } else if (C === 'V') {
        y = (rel ? y : 0) + num();
        out.push({ x: x, y: y });
        lc = null;
      } else if (C === 'C' || C === 'S') {
        var x1;
        var y1;
        if (C === 'C') {
          x1 = bx + num();
          y1 = by + num();
        } else {
          x1 = lc && lc.t === 'c' ? 2 * x - lc.x : x;
          y1 = lc && lc.t === 'c' ? 2 * y - lc.y : y;
        }
        var x2 = bx + num();
        var y2 = by + num();
        x = bx + num();
        y = by + num();
        out.push({ x: x, y: y, cubic: [x1, y1, x2, y2] });
        lc = { t: 'c', x: x2, y: y2 };
      } else if (C === 'Q' || C === 'T') {
        var qx;
        var qy;
        if (C === 'Q') {
          qx = bx + num();
          qy = by + num();
        } else {
          qx = lc && lc.t === 'q' ? 2 * x - lc.x : x;
          qy = lc && lc.t === 'q' ? 2 * y - lc.y : y;
        }
        x = bx + num();
        y = by + num();
        out.push({ x: x, y: y, quad: [qx, qy] });
        lc = { t: 'q', x: qx, y: qy };
      } else if (C === 'A') {
        i += 5;
        x = bx + num();
        y = by + num();
        out.push({ x: x, y: y });
        lc = null;
      } else {
        i++;
      }
    }
    return out;
  }

  function polyToPath(node) {
    var pts = node.points;
    var out = [];
    for (var i = 0; i < pts.numberOfItems; i++) {
      var p = pts.getItem(i);
      out.push(i === 0 ? { x: p.x, y: p.y, moveTo: true } : { x: p.x, y: p.y });
    }
    if (node.tagName.toLowerCase() === 'polygon') out.push({ close: true });
    return out;
  }

  /* ------------------------------------------------------------- 변환기 */

  function Converter(slide, root, box) {
    var vb = root.viewBox && root.viewBox.baseVal;
    var vw = vb && vb.width ? vb.width : root.width.baseVal.value;
    var vh = vb && vb.height ? vb.height : root.height.baseVal.value;
    var k = Math.min((box.w) / vw, (box.h) / vh);
    this.slide = slide;
    this.root = root;
    this.k = k;
    this.ox = box.x + (box.w - vw * k) / 2;
    this.oy = box.y + (box.h - vh * k) / 2;
  }

  Converter.prototype.X = function (u) {
    return this.ox + u * this.k;
  };
  Converter.prototype.Y = function (u) {
    return this.oy + u * this.k;
  };
  Converter.prototype.pt = function (u) {
    return u * this.k * 72;
  };

  Converter.prototype.paint = function (node, m) {
    var cs = getComputedStyle(node);
    var op = opacityOf(node, this.root);
    if (op <= 0.001 || cs.visibility === 'hidden' || cs.display === 'none') return null;
    var fill = parseColor(cs.fill);
    var stroke = parseColor(cs.stroke);
    var fo = parseFloat(cs.fillOpacity);
    var so = parseFloat(cs.strokeOpacity);
    var sw = parseFloat(cs.strokeWidth) * scaleOf(m);
    var out = {};
    if (fill) out.fill = { color: fill.hex, transparency: transparency(fill.a * (isNaN(fo) ? 1 : fo) * op) };
    if (stroke && sw > 0) {
      out.line = {
        color: stroke.hex,
        width: Math.max(0.25, this.pt(sw)),
        transparency: transparency(stroke.a * (isNaN(so) ? 1 : so) * op)
      };
      var dt = dashType(cs);
      if (dt) out.line.dashType = dt;
    }
    if (!out.fill && !out.line) return null;
    return out;
  };

  Converter.prototype.rect = function (node, m) {
    var p = this.paint(node, m);
    if (!p) return;
    var x = node.x.baseVal.value;
    var y = node.y.baseVal.value;
    var w = node.width.baseVal.value;
    var h = node.height.baseVal.value;
    if (w <= 0 || h <= 0) return;
    var a = apply(m, x, y);
    var b = apply(m, x + w, y + h);
    var rx = node.rx && node.rx.baseVal ? node.rx.baseVal.value : 0;
    var opts = {
      x: this.X(Math.min(a.x, b.x)),
      y: this.Y(Math.min(a.y, b.y)),
      w: Math.abs(b.x - a.x) * this.k,
      h: Math.abs(b.y - a.y) * this.k
    };
    if (p.fill) opts.fill = p.fill;
    if (p.line) opts.line = p.line;
    if (rx > 0) {
      opts.rectRadius = Math.min(rx * scaleOf(m) * this.k, Math.min(opts.w, opts.h) / 2);
      this.slide.addShape('roundRect', opts);
    } else {
      this.slide.addShape('rect', opts);
    }
  };

  Converter.prototype.ellipse = function (node, m) {
    var p = this.paint(node, m);
    if (!p) return;
    var cx = node.cx.baseVal.value;
    var cy = node.cy.baseVal.value;
    var rx = node.r ? node.r.baseVal.value : node.rx.baseVal.value;
    var ry = node.r ? rx : node.ry.baseVal.value;
    if (rx <= 0 || ry <= 0) return;
    var a = apply(m, cx - rx, cy - ry);
    var b = apply(m, cx + rx, cy + ry);
    var opts = {
      x: this.X(Math.min(a.x, b.x)),
      y: this.Y(Math.min(a.y, b.y)),
      w: Math.abs(b.x - a.x) * this.k,
      h: Math.abs(b.y - a.y) * this.k
    };
    if (p.fill) opts.fill = p.fill;
    if (p.line) opts.line = p.line;
    this.slide.addShape('ellipse', opts);
  };

  Converter.prototype.line = function (node, m) {
    var p = this.paint(node, m);
    if (!p || !p.line) return;
    var a = apply(m, node.x1.baseVal.value, node.y1.baseVal.value);
    var b = apply(m, node.x2.baseVal.value, node.y2.baseVal.value);
    var dx = b.x - a.x;
    var dy = b.y - a.y;
    if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) return;
    this.slide.addShape('line', {
      x: this.X(Math.min(a.x, b.x)),
      y: this.Y(Math.min(a.y, b.y)),
      w: Math.abs(dx) * this.k,
      h: Math.abs(dy) * this.k,
      flipV: dx * dy < 0,
      line: p.line
    });
  };

  Converter.prototype.path = function (node, m, segs) {
    var p = this.paint(node, m);
    if (!p || !segs.length) return;
    var self = this;
    var minX = Infinity;
    var minY = Infinity;
    var maxX = -Infinity;
    var maxY = -Infinity;
    var mapped = segs.map(function (s) {
      if (s.close) return s;
      var q = apply(m, s.x, s.y);
      var o = { x: q.x, y: q.y, moveTo: s.moveTo };
      var ctrl = [q];
      if (s.cubic) {
        o.c1 = apply(m, s.cubic[0], s.cubic[1]);
        o.c2 = apply(m, s.cubic[2], s.cubic[3]);
        ctrl.push(o.c1, o.c2);
      } else if (s.quad) {
        o.q1 = apply(m, s.quad[0], s.quad[1]);
        ctrl.push(o.q1);
      }
      ctrl.forEach(function (c) {
        minX = Math.min(minX, c.x);
        minY = Math.min(minY, c.y);
        maxX = Math.max(maxX, c.x);
        maxY = Math.max(maxY, c.y);
      });
      return o;
    });
    if (!isFinite(minX)) return;
    var w = Math.max((maxX - minX) * this.k, 0.001);
    var h = Math.max((maxY - minY) * this.k, 0.001);
    function rx(v) {
      return (v - minX) * self.k;
    }
    function ry(v) {
      return (v - minY) * self.k;
    }
    var points = mapped.map(function (s, i) {
      if (s.close) return { close: true };
      if (s.c1) {
        return { x: rx(s.x), y: ry(s.y), curve: { type: 'cubic', x1: rx(s.c1.x), y1: ry(s.c1.y), x2: rx(s.c2.x), y2: ry(s.c2.y) } };
      }
      if (s.q1) return { x: rx(s.x), y: ry(s.y), curve: { type: 'quadratic', x1: rx(s.q1.x), y1: ry(s.q1.y) } };
      var pt = { x: rx(s.x), y: ry(s.y) };
      if (s.moveTo && i > 0) pt.moveTo = true;
      return pt;
    });
    var opts = { x: this.X(minX), y: this.Y(minY), w: w, h: h, points: points };
    if (p.fill) opts.fill = p.fill;
    if (p.line) opts.line = p.line;
    this.slide.addShape('custGeom', opts);
  };

  function textInfo(node, root) {
    var cs = getComputedStyle(node);
    var op = opacityOf(node, root);
    var color = parseColor(cs.fill);
    var str = node.textContent;
    if (!color || op <= 0.001 || !str || !str.trim()) return null;
    var xs = node.x.baseVal;
    var ys = node.y.baseVal;
    var len = 0;
    try {
      len = node.getComputedTextLength();
    } catch (e) {
      len = str.length * parseFloat(cs.fontSize) * 0.6;
    }
    return {
      node: node,
      text: str,
      x: xs.numberOfItems ? xs.getItem(0).value : 0,
      y: ys.numberOfItems ? ys.getItem(0).value : 0,
      size: parseFloat(cs.fontSize) || 12,
      bold: (parseInt(cs.fontWeight, 10) || (cs.fontWeight === 'bold' ? 700 : 400)) >= 600,
      anchor: cs.textAnchor || 'start',
      color: color,
      alpha: color.a * op,
      len: len
    };
  }

  /* 같은 위치·모양으로 줄만 바뀌는 글자(여러 줄 문구)는 텍스트 상자 하나로 묶습니다 */
  function sameBlock(a, b, step) {
    if (!a || !b || a.node.parentNode !== b.node.parentNode) return false;
    if (a.anchor !== b.anchor || a.bold !== b.bold || a.color.hex !== b.color.hex) return false;
    if (Math.abs(a.size - b.size) > 0.01 || Math.abs(a.x - b.x) > 0.01) return false;
    var dy = b.y - a.y;
    if (step !== null) return Math.abs(dy - step) < 0.01;
    return dy > a.size * 0.9 && dy < a.size * 2.2;
  }

  Converter.prototype.textBlock = function (lines) {
    var first = lines[0];
    var m = matrixOf(this.root, first.node);
    var sc = scaleOf(m);
    var n = lines.length;
    var size = first.size * sc;
    var lh = n > 1 ? (lines[n - 1].y - first.y) / (n - 1) * sc : size * 1.25;
    var maxLen = 0;
    lines.forEach(function (l) {
      maxLen = Math.max(maxLen, l.len * sc);
    });
    var pad = size * 0.6;
    var w = maxLen + pad * 2;
    var h = n * lh;
    var a = apply(m, first.x, first.y);
    var lastY = a.y + (n - 1) * lh;
    var midY = (a.y + lastY) / 2 - size * 0.33;
    var left = first.anchor === 'middle' ? a.x - w / 2 : first.anchor === 'end' ? a.x - w : a.x;
    var runs = lines.map(function (l, i) {
      return { text: l.text, options: i < n - 1 ? { breakLine: true } : {} };
    });
    this.slide.addText(runs, {
      x: this.X(left),
      y: this.Y(midY - h / 2),
      w: w * this.k,
      h: h * this.k,
      margin: 0,
      fontFace: FONT,
      lang: 'ko-KR',
      fontSize: Math.round(this.pt(size) * 10) / 10,
      bold: first.bold,
      color: first.color.hex,
      transparency: transparency(first.alpha) || undefined,
      align: first.anchor === 'middle' ? 'center' : first.anchor === 'end' ? 'right' : 'left',
      valign: 'middle',
      lineSpacing: Math.round(this.pt(lh) * 10) / 10,
      wrap: false,
      fit: 'none',
      isTextBox: true
    });
  };

  Converter.prototype.run = function () {
    var self = this;
    var root = this.root;
    var nodes = root.querySelectorAll('rect, circle, ellipse, line, path, polygon, polyline, text');
    var pending = [];
    var step = null;
    function flush() {
      if (pending.length) self.textBlock(pending);
      pending = [];
      step = null;
    }
    Array.prototype.forEach.call(nodes, function (node) {
      if (node.closest('defs, clipPath, mask, pattern, marker, [data-editor]')) return;
      var tag = node.tagName.toLowerCase();
      if (tag === 'text') {
        var info = textInfo(node, root);
        if (!info) return;
        var last = pending[pending.length - 1];
        if (last && sameBlock(last, info, step)) {
          if (step === null) step = info.y - last.y;
          pending.push(info);
        } else {
          flush();
          pending.push(info);
        }
        return;
      }
      flush();
      var m = matrixOf(root, node);
      if (tag === 'rect') self.rect(node, m);
      else if (tag === 'circle' || tag === 'ellipse') self.ellipse(node, m);
      else if (tag === 'line') self.line(node, m);
      else if (tag === 'path') self.path(node, m, parsePath(node.getAttribute('d')));
      else self.path(node, m, polyToPath(node));
    });
    flush();
  };

  /* SVG 문자열을 화면 밖에 잠시 붙여 크기·글자 폭을 잽니다 */
  function mount(xml) {
    var doc = new DOMParser().parseFromString(xml, 'image/svg+xml');
    var svg = document.importNode(doc.documentElement, true);
    var host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:-100000px;top:0;pointer-events:none;';
    host.appendChild(svg);
    document.body.appendChild(host);
    return {
      svg: svg,
      remove: function () {
        document.body.removeChild(host);
      }
    };
  }

  /*
   * slides: [{ xml: SVG 문자열, title?: 슬라이드 위 작은 제목, titleColor? }]
   * 반환: PptxGenJS 프레젠테이션 (writeFile / write 로 꺼냄)
   */
  function build(slides, meta) {
    return loadLib().then(function (PptxGenJS) {
      var pres = new PptxGenJS();
      pres.layout = 'LAYOUT_WIDE';
      pres.title = (meta && meta.title) || '간트차트';
      pres.theme = { headFontFace: FONT, bodyFontFace: FONT };
      slides.forEach(function (s) {
        var slide = pres.addSlide();
        var top = MARGIN;
        if (s.title) {
          slide.addText(s.title, {
            x: MARGIN,
            y: 0.12,
            w: 4,
            h: 0.4,
            margin: 0,
            fontFace: FONT,
            fontSize: 16,
            bold: true,
            color: (s.titleColor || '#334155').replace('#', '')
          });
          top = 0.6;
        }
        var mounted = mount(s.xml);
        try {
          new Converter(slide, mounted.svg, {
            x: MARGIN,
            y: top,
            w: SLIDE_W - MARGIN * 2,
            h: SLIDE_H - top - MARGIN
          }).run();
        } finally {
          mounted.remove();
        }
      });
      return pres;
    });
  }

  function exportPPTX(slides, filename, meta) {
    return build(slides, meta).then(function (pres) {
      return pres.writeFile({ fileName: filename || 'gantt.pptx' });
    });
  }

  global.GanttPptx = {
    build: build,
    exportPPTX: exportPPTX,
    parsePath: parsePath
  };
})(window);
