/* ============================================================================
 *  gantt.js  ―  설정(JSON) → SVG 간트차트 렌더러
 *  외부 라이브러리 없음. SVG 로 그리므로 PNG / SVG 저장이 깨지지 않습니다.
 * ========================================================================== */
(function (global) {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';

  var DEFAULT_LAYOUT = {
    padding: 24,
    labelColWidth: 152,
    periodWidth: 74,
    yearHeaderHeight: 34,
    periodHeaderHeight: 30,
    rowHeight: 86,             // 수동 높이의 참고값 (자동일 때는 내용에 맞춤)
    rowPadding: 9,             // 행 위/아래 여유 (자동 높이일 때 모든 행 동일)
    rowBarOffset: 52,
    rowMilestoneOffset: -10, // 막대 기준선 대비 삼각형 (음수면 위로)
    calloutGap: 26,            // 표 아래쪽 마일스톤 영역까지의 간격
    calloutTriangleWidth: 15,
    calloutTriangleHeight: 13,
    calloutTextGap: 10,
    calloutLineHeight: 17,
    calloutItemIndent: 46,
    legendGap: 18,
    legendPadding: 14,
    legendLineHeight: 22,
    showPeriodGrid: true,      // 분기마다 세로 구분선
    periodGridStyle: 'solid',  // 'solid' | 'dashed'
    showYearGrid: true,        // 연도 경계 세로선
    zebra: true,               // 한 행씩 건너뛰며 배경색
    zebraStart: 1,             // 0 = 첫 행부터, 1 = 두 번째 행부터
    rowComparePad: 34,         // 변경 비교 표시 — 일정 라인 바로 아래 짧은 여유
    widthMode: 'auto',         // 'auto' = 그림 폭을 autoWidth 근처로 맞춤, 'manual' = chartWidth 고정
    autoWidth: 1000,           // 자동일 때 목표 그림 폭(px)
    chartWidth: 1000,          // 직접 지정일 때 그림 폭(px)
    fontScale: 1               // 글자·행 높이 배율. 기간 축 폭은 그대로라 글자만 커집니다
  };

  /* 표시 칸 하나의 최소/최대 폭(글자 배율 1 기준). 자동 폭에서 칸이 너무 좁거나 넓어지지 않게 */
  var CELL_LIMITS = {
    quarter: { min: 38, max: 180 },
    month: { min: 30, max: 90 }
  };

  /* 색 후보군 — 편집 화면의 색상 드롭다운에 그대로 나옵니다 */
  var DEFAULT_PALETTE = [
    { name: 'sky', label: '하늘색', color: '#9DC3E6' },
    { name: 'navy', label: '남색', color: '#1F3864' },
    { name: 'blue', label: '파랑', color: '#2E75B6' },
    { name: 'steel', label: '연한 남색', color: '#8FAADC' },
    { name: 'teal', label: '청록', color: '#2A9D8F' },
    { name: 'green', label: '초록', color: '#548235' },
    { name: 'gold', label: '금색', color: '#BF9000' },
    { name: 'orange', label: '주황', color: '#E36C0A' },
    { name: 'red', label: '빨강', color: '#FF0000' },
    { name: 'crimson', label: '진한 빨강', color: '#C00000' },
    { name: 'purple', label: '보라', color: '#7030A0' },
    { name: 'gray', label: '회색', color: '#808080' }
  ];

  var DEFAULT_COLORS = {
    header: '#404040',
    subHeader: '#F2F2F2',
    grid: '#D9D9D9',        // 표 테두리 / 행 구분선
    gridYear: '#A8ADB6',    // 연도 경계 세로선 (더 진함)
    gridPeriod: '#D4D8DF',  // 분기 세로선 (1Q·2Q·3Q 구분)
    rowAlt: '#F5F7FB',      // 격행 배경색 (옅은 음영)
    text: '#000000',
    /* 예전 설정 파일 호환용 이름 */
    blue: '#9DC3E6'
  };

  var FONT_STACK =
    "'Malgun Gothic','맑은 고딕','Noto Sans KR','Apple SD Gothic Neo','Nanum Gothic',sans-serif";

  var SELECT_COLOR = '#0F62FE';

  /* ---------------------------------------------------------------- helpers */

  function el(name, attrs, parent) {
    var node = document.createElementNS(NS, name);
    if (attrs) {
      for (var k in attrs) {
        if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      }
    }
    if (parent) parent.appendChild(node);
    return node;
  }

  function merge(base, over) {
    var out = {};
    var k;
    for (k in base) out[k] = base[k];
    if (over) for (k in over) if (over[k] !== undefined) out[k] = over[k];
    return out;
  }

  function pick(value, fallback) {
    return value === undefined || value === null ? fallback : value;
  }

  function lines(text) {
    if (text === undefined || text === null || text === '') return [];
    if (Array.isArray(text)) return text;
    return String(text).split('\n');
  }

  /* 한글은 폭이 넓으므로 글자 종류별 가중치로 근사 (범례 줄바꿈용) */
  function textWidth(text, size) {
    var w = 0;
    var s = String(text);
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      w += c > 0x1100 && c < 0xffdc ? 1.0 : 0.55;
    }
    return w * size;
  }

  /* --------------------------------------------------------- 시점(時點) 변환 */

  function makeScale(cfg) {
    var P = cfg.periodLabels.length;

    /* 절대 구간 인덱스: year * P + (분기-1) + 분기내 비율 */
    function parseAbs(value) {
      if (typeof value === 'number') return value;
      var s = String(value).trim();
      var m;

      m = s.match(/^(\d{4})[-/](\d{1,2})(?:[-/](\d{1,2}))?$/); /* 2026-08 / 2026-08-15 */
      if (m) {
        var mon = +m[2];
        var day = m[3] ? +m[3] : 1;
        return +m[1] * P + ((mon - 1 + (day - 1) / 30.4) / 12) * P;
      }

      m = s.match(/^(\d{4})\s*[-/ ]?\s*(?:Q\s*(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*Q)$/i); /* 2026-Q3.5 */
      if (m) {
        var q = parseFloat(m[2] !== undefined ? m[2] : m[3]);
        return +m[1] * P + (q - 1);
      }

      m = s.match(/^(\d{4})$/); /* 2026 */
      if (m) return +m[1] * P;

      console.warn('[gantt] 시점 형식을 알 수 없습니다: ' + value);
      return 0;
    }

    var startAbs = Math.floor(parseAbs(cfg.range.start));
    var endAbs = Math.floor(parseAbs(cfg.range.end)) + 1; /* 끝 분기 포함 */
    if (endAbs <= startAbs) endAbs = startAbs + 1;
    var total = endAbs - startAbs;

    function parse(value) {
      return parseAbs(value) - startAbs;
    }

    function split(value) {
      var abs = typeof value === 'number' ? value + startAbs : parseAbs(value);
      var year = Math.floor(abs / P);
      var pi = abs - year * P;
      var q = Math.floor(pi + 1e-6);
      return { year: year, period: q + 1, frac: Math.max(0, pi - q) };
    }

    function compose(year, period, frac) {
      /* 부동소수 잔여를 없애 0.25 / 0.5 / 0.75 가 깨지지 않게 합니다 */
      var f = Math.round((frac || 0) * 1000) / 1000;
      f = Math.round(f * 100) / 100;
      var p = period;
      if (f >= 0.999) { f = 0; p += 1; }
      if (p > P) { p -= P; year += 1; }
      if (f < 0.001) return year + '-Q' + p;
      var body = f.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
      return year + '-Q' + p + body.replace(/^0/, '');
    }

    function format(t) {
      var s = split(t);
      return compose(s.year, s.period, s.frac);
    }

    /* 월 단위 표시용: 내부는 분기 축 그대로, 문자열만 "2027-03" / "2027-03-15" */
    var monthsPerPeriod = 12 % P === 0 ? 12 / P : 0;

    function splitMonth(value) {
      var abs = typeof value === 'number' ? value + startAbs : parseAbs(value);
      var year = Math.floor(abs / P + 1e-9);
      var mf = (abs - year * P) * (12 / P);
      var m = Math.floor(mf + 1e-6);
      var frac = Math.max(0, mf - m);
      if (m >= 12) {
        m -= 12;
        year += 1;
      }
      return { year: year, month: m + 1, frac: frac };
    }

    function composeMonth(year, month, frac) {
      var day = Math.round((frac || 0) * 30.4);
      var mm = month;
      var yy = year;
      if (day >= 30) {
        day = 0;
        mm += 1;
      }
      while (mm > 12) {
        mm -= 12;
        yy += 1;
      }
      while (mm < 1) {
        mm += 12;
        yy -= 1;
      }
      var s = yy + '-' + (mm < 10 ? '0' : '') + mm;
      if (day > 0) s += '-' + (day + 1 < 10 ? '0' : '') + (day + 1);
      return s;
    }

    function formatMonth(t) {
      var s = splitMonth(t);
      return composeMonth(s.year, s.month, s.frac);
    }

    return {
      periods: P,
      monthsPerPeriod: monthsPerPeriod,
      splitMonth: splitMonth,
      composeMonth: composeMonth,
      formatMonth: formatMonth,
      total: total,
      startAbs: startAbs,
      endAbs: endAbs,
      firstYear: Math.floor(startAbs / P),
      lastYear: Math.floor((endAbs - 1) / P),
      parse: parse,
      parseAbs: parseAbs,
      split: split,
      compose: compose,
      format: format,
      clamp: function (t) {
        return Math.max(0, Math.min(total, t));
      }
    };
  }

  /* 미래 연도처럼 칸이 많은 구간을 좁은 폭 + 물결 끊음으로 접습니다 */
  function makeVisualMap(scale, cfg) {
    var compress = cfg.compress || {};
    var P = scale.periods;
    function yearNum(v) {
      if (v === null || v === undefined || v === '') return NaN;
      var n = +v;
      return isFinite(n) ? n : NaN;
    }
    var sy = yearNum(compress.startYear);
    var ey = yearNum(compress.endYear);
    if (!isFinite(sy) && compress.start) sy = Math.floor(scale.parseAbs(compress.start) / P);
    if (!isFinite(ey) && compress.end) ey = Math.floor(scale.parseAbs(compress.end) / P);
    if (isFinite(sy) && isFinite(ey) && ey < sy) {
      var swap = sy;
      sy = ey;
      ey = swap;
    }

    var c0 = 0;
    var c1 = 0;
    var vw = 0;
    var slices = [];
    var slot = 0;
    var enabled = !!(compress.enabled && isFinite(sy) && isFinite(ey));
    if (enabled) {
      var abs0 = Math.max(scale.startAbs, sy * P);
      var abs1 = Math.min(scale.endAbs, (ey + 1) * P);
      c0 = abs0 - scale.startAbs;
      c1 = abs1 - scale.startAbs;
      var span = c1 - c0;
      if (span < 1.05 || (c0 <= 0.001 && c1 >= scale.total - 0.001)) {
        enabled = false;
      } else {
        var y;
        for (y = sy; y <= ey; y++) {
          var a0 = Math.max(abs0, y * P);
          var a1 = Math.min(abs1, (y + 1) * P);
          if (a1 > a0) slices.push({ year: y, t0: a0 - scale.startAbs, t1: a1 - scale.startAbs });
        }
        /* 축약 구간 전체 폭 = 펼친 1년(1Q~4Q)과 동일. 연도마다 그 폭을 나눠 가집니다 */
        vw = pick(compress.width, P);
        if (slices.length < 1) enabled = false;
        else slot = vw / slices.length;
      }
    }

    var visualTotal = enabled ? c0 + vw + (scale.total - c1) : scale.total;

    function sliceAtT(t) {
      var i;
      for (i = 0; i < slices.length; i++) {
        if (t < slices[i].t1 - 1e-9 || i === slices.length - 1) return i;
      }
      return slices.length - 1;
    }

    function tToV(t) {
      t = scale.clamp(t);
      if (!enabled) return t;
      if (t <= c0) return t;
      if (t >= c1) return c0 + vw + (t - c1);
      var i = sliceAtT(t);
      var s = slices[i];
      var local = s.t1 <= s.t0 ? 0 : (t - s.t0) / (s.t1 - s.t0);
      if (local < 0) local = 0;
      if (local > 1) local = 1;
      return c0 + i * slot + local * slot;
    }

    function vToT(v) {
      if (!enabled) return v;
      if (v <= c0) return Math.max(0, v);
      if (v >= c0 + vw) return Math.min(scale.total, c1 + (v - c0 - vw));
      var i = Math.min(slices.length - 1, Math.max(0, Math.floor((v - c0) / slot)));
      var s = slices[i];
      var local = slot <= 0 ? 0 : (v - (c0 + i * slot)) / slot;
      if (local < 0) local = 0;
      if (local > 1) local = 1;
      return s.t0 + local * (s.t1 - s.t0);
    }

    var breaks = [];
    if (enabled) {
      for (var bi = 1; bi < slices.length; bi++) breaks.push(slices[bi].t0);
    }

    return {
      enabled: enabled,
      startYear: sy,
      endYear: ey,
      c0: c0,
      c1: c1,
      vw: vw,
      slices: slices,
      breaks: breaks,
      visualTotal: visualTotal,
      tToV: tToV,
      vToT: vToT
    };
  }

  function yearBands(scale, visual) {
    var P = scale.periods;
    var bands = [];
    var y;
    for (y = scale.firstYear; y <= scale.lastYear; y++) {
      bands.push({
        label: String(y),
        fromAbs: Math.max(scale.startAbs, y * P),
        toAbs: Math.min(scale.endAbs, (y + 1) * P),
        compressed: !!(visual.enabled && y >= visual.startYear && y <= visual.endYear)
      });
    }
    return bands;
  }

  /* 'auto' 는 보이는 기간이 18개월 이하일 때 월 단위로 표시 */
  function resolveUnit(cfg, scale) {
    if (!scale.monthsPerPeriod) return 'quarter';
    var u = cfg.timeUnit || 'auto';
    if (u === 'month' || u === 'quarter') return u;
    return scale.total * scale.monthsPerPeriod <= 18 ? 'month' : 'quarter';
  }

  function numIn(v, lo, hi, fallback) {
    var n = +v;
    if (v === null || v === undefined || v === '' || !isFinite(n)) return fallback;
    return Math.max(lo, Math.min(hi, n));
  }

  function wavePath(points) {
    if (!points.length) return '';
    var d = 'M ' + points[0][0] + ' ' + points[0][1];
    var i;
    for (i = 1; i < points.length; i++) d += ' L ' + points[i][0] + ' ' + points[i][1];
    return d;
  }

  function sineSamples(x0, y0, y1, amp, period) {
    var h = Math.max(1, y1 - y0);
    var steps = Math.max(12, Math.ceil(h / 2));
    var out = [];
    var i;
    for (i = 0; i <= steps; i++) {
      var y = y0 + (h * i) / steps;
      out.push([x0 + Math.sin(((y - y0) / period) * Math.PI * 2) * amp, y]);
    }
    return out;
  }

  /* ------------------------------------------------------------- 설정 정규화 */

  function normalize(input) {
    var cfg = merge({}, input);

    cfg.periodLabels =
      cfg.periodLabels && cfg.periodLabels.length ? cfg.periodLabels.slice() : ['1Q', '2Q', '3Q', '4Q'];

    /* 기간: range 우선, 없으면 옛 years 배열에서 만들기 */
    if (!cfg.range || !cfg.range.start || !cfg.range.end) {
      var ys = cfg.years && cfg.years.length ? cfg.years : [new Date().getFullYear()];
      cfg.range = {
        start: ys[0] + '-Q1',
        end: ys[ys.length - 1] + '-Q' + cfg.periodLabels.length
      };
    }

    cfg.palette = (cfg.palette && cfg.palette.length ? cfg.palette : DEFAULT_PALETTE).slice();
    cfg.colors = merge(DEFAULT_COLORS, cfg.colors);
    cfg.barColorCycle = cfg.barColorCycle && cfg.barColorCycle.length ? cfg.barColorCycle.slice() : ['sky', 'navy'];
    cfg.layout = merge(DEFAULT_LAYOUT, cfg.layout);
    cfg.rows = (cfg.rows || []).slice();
    cfg.milestones = (cfg.milestones || []).slice();
    cfg.legend = merge({ show: true, title: '범례', items: [] }, cfg.legend);
    cfg.compress = merge({ enabled: false, startYear: null, endYear: null }, cfg.compress);

    /* 문구 위치 labelAt: 왼(0.15)/중(0.5)/오(0.85)에 가깝면 정확히 스냅
       (예전 0.4·0.45 등이 UI상 '중앙'으로 보이지만 실제론 안 맞던 문제 보정) */
    cfg.rows.forEach(function (row) {
      (row.bars || []).forEach(function (bar) {
        if (bar.labelAt === undefined || bar.labelAt === null) return;
        var snapped = snapLabelAt(bar.labelAt);
        if (snapped !== bar.labelAt) bar.labelAt = snapped;
      });
    });

    var map = {};
    cfg.palette.forEach(function (p) {
      map[p.name] = p.color;
    });
    for (var k in cfg.colors) if (map[k] === undefined) map[k] = cfg.colors[k];
    cfg._colorMap = map;

    if (global.GanttCompare && GanttCompare.ensureIds) GanttCompare.ensureIds(cfg);

    return cfg;
  }

  var LABEL_AT_PRESETS = [0.15, 0.5, 0.85];

  function snapLabelAt(v) {
    var n = +v;
    if (isNaN(n)) return v;
    var best = LABEL_AT_PRESETS[0];
    var bestD = Math.abs(best - n);
    LABEL_AT_PRESETS.forEach(function (p) {
      var d = Math.abs(p - n);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    });
    return bestD <= 0.12 ? best : n;
  }

  function color(cfg, name, fallback) {
    if (!name) return fallback;
    return cfg._colorMap[name] || name;
  }

  /* ------------------------------------------------------------- 그리기 도구 */

  function text(parent, x, y, str, opt) {
    opt = opt || {};
    var node = el(
      'text',
      {
        x: x,
        y: y,
        'text-anchor': opt.anchor || 'middle',
        'font-size': opt.size || 12,
        'font-weight': opt.weight || 'normal',
        fill: opt.fill || '#000'
      },
      parent
    );
    node.textContent = str;
    return node;
  }

  function multiline(parent, x, y, arr, opt) {
    opt = opt || {};
    var lh = opt.lineHeight || (opt.size || 12) + 4;
    var n = arr.length;
    var nodes = [];
    for (var i = 0; i < n; i++) {
      var yy = opt.grow === 'up' ? y - (n - 1 - i) * lh : y + i * lh;
      nodes.push(text(parent, x, yy, arr[i], opt));
    }
    return nodes;
  }

  /* 글자가 일정에서 멀어지면 점선으로 연결 */
  function labelLeader(parent, ax, ay, lx, ly, stroke) {
    if (Math.abs(ly - ay) < 18 && Math.abs(lx - ax) < 6) return;
    var y1 = ly > ay ? ay + 5 : ay - 5;
    var y2 = ly > ay ? ly - 3 : ly + 3;
    el(
      'line',
      {
        x1: ax,
        y1: y1,
        x2: lx,
        y2: y2,
        stroke: stroke || '#94A3B8',
        'stroke-width': 1,
        'stroke-dasharray': '2.5 2.5',
        opacity: 0.9
      },
      parent
    );
  }

  function marker(parent, x, y, type, fill, size) {
    var s = size || 5;
    switch (type) {
      case 'filled':
        el('circle', { cx: x, cy: y, r: s, fill: fill, stroke: '#FFFFFF', 'stroke-width': 1.1 }, parent);
        break;
      case 'circle':
        el('circle', { cx: x, cy: y, r: s, fill: '#FFFFFF', stroke: fill, 'stroke-width': 2 }, parent);
        break;
      case 'diamond':
        el(
          'path',
          {
            d: 'M ' + x + ' ' + (y - s * 1.25) + ' L ' + (x + s * 1.1) + ' ' + y +
               ' L ' + x + ' ' + (y + s * 1.25) + ' L ' + (x - s * 1.1) + ' ' + y + ' Z',
            fill: fill
          },
          parent
        );
        break;
      case 'triangle':
        el(
          'path',
          {
            d: 'M ' + (x - s * 1.2) + ' ' + (y - s) + ' L ' + (x + s * 1.2) + ' ' + (y - s) +
               ' L ' + x + ' ' + (y + s * 1.1) + ' Z',
            fill: fill
          },
          parent
        );
        break;
      case 'star':
        el('path', { d: starPath(x, y, s * 1.5, s * 0.65), fill: fill }, parent);
        break;
      case 'arrow':
        el(
          'path',
          {
            d: 'M ' + (x - s * 1.4) + ' ' + (y - s * 1.1) + ' L ' + (x + s * 1.2) + ' ' + y +
               ' L ' + (x - s * 1.4) + ' ' + (y + s * 1.1) + ' Z',
            fill: fill
          },
          parent
        );
        break;
      case 'square':
        el('rect', { x: x - s, y: y - s, width: s * 2, height: s * 2, fill: fill }, parent);
        break;
      default:
        break;
    }
  }

  function starPath(cx, cy, outer, inner) {
    var d = '';
    for (var i = 0; i < 10; i++) {
      var r = i % 2 === 0 ? outer : inner;
      var a = (Math.PI / 5) * i - Math.PI / 2;
      d += (i === 0 ? 'M ' : ' L ') + (cx + r * Math.cos(a)) + ' ' + (cy + r * Math.sin(a));
    }
    return d + ' Z';
  }

  /* 클릭·드래그를 받는 투명 도형 */
  function hit(parent, tag, attrs, meta) {
    var node = el(tag, merge(attrs, { 'pointer-events': 'all' }), parent);
    node.setAttribute('data-kind', meta.kind);
    if (meta.row !== undefined && meta.row !== null) node.setAttribute('data-row', meta.row);
    if (meta.index !== undefined && meta.index !== null) node.setAttribute('data-index', meta.index);
    if (meta.part) node.setAttribute('data-part', meta.part);
    if (meta.cursor) node.setAttribute('style', 'cursor:' + meta.cursor);
    node.setAttribute('data-editor', 'hit');
    return node;
  }

  /* -------------------------------------------------------------- main render */

  function render(inputConfig, container, options) {
    options = options || {};
    var interactive = !!options.interactive;
    var sel = options.selection || null;

    var cfg = normalize(inputConfig);
    var L = cfg.layout;
    var scale = makeScale(cfg);
    var P = scale.periods;

    var visual = makeVisualMap(scale, cfg);
    var unit = resolveUnit(cfg, scale);
    var cellsPerPeriod = unit === 'month' ? scale.monthsPerPeriod : 1;

    /*
     * 크기 계산 — 그림은 내부 좌표로 그린 뒤 fontScale 배로 키워 내보냅니다.
     * 기간 축의 내부 폭을 fontScale 로 나눠 두면, 최종 그림에서 축 폭은 그대로이고
     * 글자·행 높이·행 이름 칸만 커집니다.
     */
    var fontScale = numIn(L.fontScale, 0.5, 3, 1);
    var fixedOut = (L.padding * 2 + L.labelColWidth) * fontScale;
    var cols = Math.max(1, visual.visualTotal * cellsPerPeriod);
    var limits = CELL_LIMITS[unit];
    var plotOut;
    if (L.widthMode === 'manual') {
      plotOut = Math.max(cols * 8 * fontScale, numIn(L.chartWidth, 200, 20000, 1000) - fixedOut);
    } else {
      var cellOut = (numIn(L.autoWidth, 200, 20000, 1000) - fixedOut) / cols;
      cellOut = Math.max(limits.min * fontScale, Math.min(limits.max * fontScale, cellOut));
      plotOut = cellOut * cols;
    }
    L.periodWidth = plotOut / fontScale / visual.visualTotal;
    var cellW = L.periodWidth / cellsPerPeriod;

    var plotX = L.padding + L.labelColWidth;
    var plotW = visual.visualTotal * L.periodWidth;
    var totalWidth = plotX + plotW + L.padding;

    function xAtT(t) {
      return plotX + visual.tToV(scale.clamp(t)) * L.periodWidth;
    }

    function xOf(value) {
      var t = typeof value === 'number' ? value : scale.parse(value);
      return xAtT(t);
    }

    /* ---- 마일스톤을 행 안 / 표 아래로 분류 ---- */
    var rowMilestones = cfg.rows.map(function () {
      return [];
    });
    var bottomMilestones = [];
    cfg.milestones.forEach(function (ms, idx) {
      var entry = { ms: ms, index: idx };
      if (typeof ms.row === 'number' && ms.row >= 0 && ms.row < cfg.rows.length) rowMilestones[ms.row].push(entry);
      else bottomMilestones.push(entry);
    });

    function msBlockHeight(ms) {
      return lines(ms.title).length * L.calloutLineHeight + (ms.items || []).length * L.calloutLineHeight;
    }

    /* 막대 기준선(0) 기준, 역삼각형+문구가 실제로 차지하는 위/아래 범위 */
    function measureMilestone(ms, note) {
      var yTop = L.rowMilestoneOffset + pick(ms.dy, 0);
      var th = L.calloutTriangleHeight;
      var titleDy = pick(ms.titleDy, 0);
      var nTitle = Math.max(1, lines(ms.title).length);
      var nItems = (ms.items || []).length;
      var lh = L.calloutLineHeight;
      var gap = L.calloutTextGap;
      var aboveTri = titleDy < 0;
      var ty = aboveTri ? yTop - gap + titleDy : yTop + th + gap + titleDy;

      note(yTop, yTop + th);

      if (aboveTri) {
        note(ty - (nTitle - 1) * lh - 11, ty + 3);
        if (nItems) note(yTop + th + gap - 11, yTop + th + gap + (nItems - 1) * lh + 3);
      } else {
        var last = nItems
          ? ty + nTitle * lh + 2 + (nItems - 1) * lh
          : ty + (nTitle - 1) * lh;
        note(ty - 11, last + 3);
      }
    }

    /* ---- 세로 위치 계산 ---- */
    var y = L.padding;
    var titleLines = lines(cfg.title);
    var subtitleLines = lines(cfg.subtitle);
    var titleTop = y;
    if (titleLines.length) y += titleLines.length * 26;
    if (subtitleLines.length) y += subtitleLines.length * 18 + 2;
    if (titleLines.length || subtitleLines.length) y += 10;

    var headerTop = y;
    var periodTop = headerTop + L.yearHeaderHeight;
    var plotTop = periodTop + L.periodHeaderHeight;

    /* 행 안의 글자 · 표식 · 마일스톤이 잘리지 않도록 위/아래 필요 공간을 재서
       행 높이와 막대 기준선을 자동으로 맞춥니다. */
    function measureRow(row, msList, rowIdx) {
      /*
       * 막대 기준선은 눈에 보이지 않으므로 내용 범위에 넣지 않습니다.
       * (예전에는 0 을 항상 포함해서, 삼각형이 기준선 아래에 있으면
       *  그 오프셋만큼 행 위쪽이 빈 채로 남았습니다.)
       */
      var minY = null;
      var maxY = null;

      function note(top, bot) {
        if (minY === null || top < minY) minY = top;
        if (maxY === null || bot > maxY) maxY = bot;
      }

      function labelExtent(dy, labelDy, count, size, lh, grow) {
        var top = grow === 'up' ? dy + labelDy - (count - 1) * lh - size * 0.85 : dy + labelDy - size * 0.85;
        var bot = grow === 'up' ? dy + labelDy + size * 0.3 : dy + labelDy + (count - 1) * lh + size * 0.3;
        note(top, bot);
      }

      (row.bars || []).forEach(function (bar) {
        var dy = pick(bar.dy, 0);
        var r = pick(bar.width, 3) / 2 + pick(bar.capSize, 4.6) + 2;
        note(dy - r, dy + r);
        var bl = lines(bar.label);
        if (bl.length) {
          var bDy = pick(bar.labelDy, -12);
          labelExtent(dy, bDy, bl.length, pick(bar.labelSize, 12.5), 16, bDy >= 0 ? 'down' : 'up');
        }
      });

      function measurePoint(mk, defaults) {
        var m = merge(defaults, mk);
        var dy = pick(m.dy, 0);
        var r = pick(m.size, 5.5) + 3;
        note(dy - r, dy + r);
        var ml = lines(m.label);
        if (ml.length) {
          var below2 = pick(m.labelPos, 'above') === 'below';
          labelExtent(dy, pick(m.labelDy, below2 ? 16 : -12), ml.length, pick(m.labelSize, 12.5), 15, below2 ? 'down' : 'up');
        }
      }

      (row.markers || []).forEach(function (mk) {
        measurePoint(mk, {});
      });
      (row.deliverables || []).forEach(function (d) {
        measurePoint(d, { type: 'diamond', size: 4.6, labelPos: 'below', labelSize: 11, labelDy: 16 });
      });

      msList.forEach(function (e) {
        measureMilestone(e.ms, note);
      });

      /* 단축·지연·추가 화살표+알약도 행 내용(컨텍스트)에 포함 */
      if (global.GanttCompare && GanttCompare.overlayBoundsRel && options.compareChanges) {
        options.compareChanges.forEach(function (ch) {
          if (ch.row !== rowIdx) return;
          var b = GanttCompare.overlayBoundsRel(ch, L);
          if (b) note(b.top, b.bottom);
        });
      }

      if (minY === null) {
        minY = -8;
        maxY = 8;
      }

      return { top: minY, bottom: maxY };
    }

    var comparePadRows = options.comparePadRows || {};

    var rowTops = [];
    var rowHeights = [];
    var rowBaselines = [];
    var cur = plotTop;
    cfg.rows.forEach(function (row, i) {
      var m = measureRow(row, rowMilestones[i], i);
      var padVal = comparePadRows[i];
      var wantPad = padVal ? (typeof padVal === 'number' ? padVal : 40) : 0;
      if (wantPad) m.bottom = Math.max(m.bottom, wantPad);

      var autoH = m.bottom - m.top + L.rowPadding * 2;

      var manual = row.height != null && row.height !== '' && isFinite(+row.height);
      var h = manual ? Math.max(+row.height, autoH) : autoH;

      var extra = h - autoH;
      if (extra < 0) extra = 0;
      var nudge = row.barDy != null && row.barDy !== '' ? +row.barDy || 0 : 0;
      /* 내용의 맨 위가 항상 rowPadding 자리에. 수동으로 키우면 가운데로 */
      var baseline = cur + L.rowPadding - m.top + extra / 2 + nudge;

      rowTops.push(cur);
      rowHeights.push(h);
      rowBaselines.push(baseline);
      cur += h;
    });
    var plotBottom = cur;

    /* ---- 표 아래 마일스톤 영역 ---- */
    var calloutTop = plotBottom + L.calloutGap;
    var calloutTextTop = calloutTop + L.calloutTriangleHeight + L.calloutTextGap;
    var calloutBodyHeight = 0;
    bottomMilestones.forEach(function (e) {
      var h = msBlockHeight(e.ms);
      if (h > calloutBodyHeight) calloutBodyHeight = h;
    });
    var calloutBottom = bottomMilestones.length ? calloutTextTop + calloutBodyHeight + 4 : plotBottom;

    /* ---- 범례 줄바꿈 미리 계산 ---- */
    var legendRows = [];
    var legendHeight = 0;
    var legendTop = calloutBottom + L.legendGap;
    if (cfg.legend.show && cfg.legend.items.length) {
      var availW = L.labelColWidth + plotW - L.legendPadding * 2;
      var titleW = cfg.legend.title ? textWidth(cfg.legend.title, 12) + 16 : 0;
      var rowItems = [];
      var rowW = titleW;
      cfg.legend.items.forEach(function (item) {
        var symbolW = item.type === 'lineAlt' ? 54 : 34;
        var w = symbolW + textWidth(item.label, 12) + 22;
        if (rowItems.length && rowW + w > availW) {
          legendRows.push(rowItems);
          rowItems = [];
          rowW = titleW;
        }
        rowItems.push({ item: item, x: rowW, symbolW: symbolW });
        rowW += w;
      });
      if (rowItems.length) legendRows.push(rowItems);
      legendHeight = legendRows.length * L.legendLineHeight + L.legendPadding * 2 - 6;
    }

    var totalHeight = (legendHeight ? legendTop + legendHeight : calloutBottom) + L.padding;

    /* ---- SVG 루트 ---- */
    var outW = Math.round(totalWidth * fontScale * 100) / 100;
    var outH = Math.round(totalHeight * fontScale * 100) / 100;
    var svg = el('svg', {
      xmlns: NS,
      viewBox: '0 0 ' + totalWidth + ' ' + totalHeight,
      width: outW,
      height: outH,
      'data-width': outW,
      'data-height': outH,
      'data-scale': fontScale,
      preserveAspectRatio: 'xMidYMid meet'
    });
    var style = el('style', null, svg);
    style.textContent = 'text{font-family:' + FONT_STACK + ';white-space:pre;}';

    el('rect', { x: 0, y: 0, width: totalWidth, height: totalHeight, fill: '#FFFFFF' }, svg);

    if (titleLines.length) {
      multiline(svg, totalWidth / 2, titleTop + 22, titleLines, { size: 20, weight: 'bold', fill: '#222' });
    }
    if (subtitleLines.length) {
      multiline(svg, totalWidth / 2, titleTop + titleLines.length * 26 + 16, subtitleLines, {
        size: 13,
        fill: '#666'
      });
    }

    var gridColor = cfg.colors.grid;

    /* ---- 헤더 (연도 칸은 실제로 보이는 분기 수만큼만 차지) ---- */
    var gHeader = el('g', null, svg);
    el(
      'rect',
      {
        x: L.padding,
        y: headerTop,
        width: L.labelColWidth,
        height: L.yearHeaderHeight + L.periodHeaderHeight,
        fill: cfg.colors.header
      },
      gHeader
    );
    text(
      gHeader,
      L.padding + L.labelColWidth / 2,
      headerTop + (L.yearHeaderHeight + L.periodHeaderHeight) / 2 + 5,
      cfg.cornerLabel || '',
      { size: 15, weight: 'bold', fill: '#FFFFFF' }
    );

    yearBands(scale, visual).forEach(function (band, bi) {
      var x0 = xAtT(band.fromAbs - scale.startAbs);
      var x1 = xAtT(band.toAbs - scale.startAbs);
      var w = Math.max(1, x1 - x0);

      el('rect', { x: x0, y: headerTop, width: w, height: L.yearHeaderHeight, fill: cfg.colors.header }, gHeader);
      text(gHeader, x0 + w / 2, headerTop + L.yearHeaderHeight / 2 + 6, band.label, {
        size: 16,
        weight: 'bold',
        fill: '#FFFFFF'
      });
      if (bi > 0) {
        el(
          'line',
          { x1: x0, y1: headerTop, x2: x0, y2: headerTop + L.yearHeaderHeight, stroke: '#FFFFFF', 'stroke-width': 2 },
          gHeader
        );
      }

      if (band.compressed) {
        el(
          'rect',
          {
            x: x0,
            y: periodTop,
            width: w,
            height: L.periodHeaderHeight,
            fill: '#E8EBEF',
            stroke: gridColor,
            'stroke-width': 1
          },
          gHeader
        );
        text(gHeader, x0 + w / 2, periodTop + L.periodHeaderHeight / 2 + 4.5, '⋯', {
          size: 14,
          fill: '#6B7280'
        });
      } else {
        var abs;
        var k;
        for (abs = band.fromAbs; abs < band.toAbs; abs++) {
          var periodIdx = abs - Math.floor(abs / P) * P;
          for (k = 0; k < cellsPerPeriod; k++) {
            var t0 = abs - scale.startAbs + k / cellsPerPeriod;
            var px = xAtT(t0);
            var pw = xAtT(t0 + 1 / cellsPerPeriod) - px;
            el(
              'rect',
              {
                x: px,
                y: periodTop,
                width: pw,
                height: L.periodHeaderHeight,
                fill: cfg.colors.subHeader,
                stroke: gridColor,
                'stroke-width': 1
              },
              gHeader
            );
            var cellLabel;
            if (unit === 'month') {
              var mon = periodIdx * cellsPerPeriod + k + 1;
              if (cellW < 16 && (mon - 1) % 3 !== 0) cellLabel = '';
              else cellLabel = cellW >= 30 ? mon + '월' : String(mon);
            } else {
              cellLabel = cfg.periodLabels[periodIdx];
            }
            if (cellLabel) {
              text(gHeader, px + pw / 2, periodTop + L.periodHeaderHeight / 2 + 4.5, cellLabel, {
                size: 12.5,
                fill: '#3F3F3F'
              });
            }
          }
        }
      }
    });

    /* ---- 행 배경 / 행 이름 ---- */
    var gRows = el('g', null, svg);
    cfg.rows.forEach(function (row, i) {
      var top = rowTops[i];
      var h = rowHeights[i];
      var zebra = L.zebra && i % 2 === (L.zebraStart ? 1 : 0);
      var band = zebra ? cfg.colors.rowAlt : '#FFFFFF';
      el(
        'rect',
        {
          x: L.padding,
          y: top,
          width: L.labelColWidth,
          height: h,
          fill: row.labelFill || band,
          stroke: gridColor,
          'stroke-width': 1
        },
        gRows
      );
      el(
        'rect',
        { x: plotX, y: top, width: plotW, height: h, fill: row.fill || band, stroke: gridColor, 'stroke-width': 1 },
        gRows
      );
      var ll = lines(row.label);
      var lh = 21;
      var cy = top + h / 2 + 6 - ((ll.length - 1) * lh) / 2;
      multiline(gRows, L.padding + L.labelColWidth / 2, cy, ll, {
        size: pick(row.labelSize, 15),
        weight: 'bold',
        fill: cfg.colors.text,
        lineHeight: lh
      });

      if (interactive) {
        hit(
          gRows,
          'rect',
          { x: L.padding, y: top, width: L.labelColWidth, height: h, fill: 'transparent' },
          { kind: 'row', row: i, cursor: 'pointer' }
        );
      }
    });

    /* ---- 축약 물결 (격자 위 · 막대/글자 아래, 투명도 30%) ---- */
    if (visual.enabled && visual.breaks && visual.breaks.length) {
      var gBreak = el('g', { 'data-compress': 'break', 'pointer-events': 'none', opacity: '0.3' }, svg);
      function drawWaveBreak(x) {
        var amp = 6;
        var gap = 10;
        var period = 18;
        var left = sineSamples(x - gap / 2, headerTop, plotBottom, amp, period);
        var right = sineSamples(x + gap / 2, headerTop, plotBottom, amp, period);
        var fillD = wavePath(left);
        var ri;
        for (ri = right.length - 1; ri >= 0; ri--) {
          fillD += ' L ' + right[ri][0] + ' ' + right[ri][1];
        }
        fillD += ' Z';
        el('path', { d: fillD, fill: '#FFFFFF', stroke: 'none' }, gBreak);
        el('path', { d: wavePath(left), fill: 'none', stroke: '#4B5563', 'stroke-width': 1.6 }, gBreak);
        el('path', { d: wavePath(right), fill: 'none', stroke: '#4B5563', 'stroke-width': 1.6 }, gBreak);
      }
      visual.breaks.forEach(function (t) {
        drawWaveBreak(xAtT(t));
      });
    }

    /* ---- 세로 격자 ---- */
    var gGrid = el('g', null, svg);
    var gridSteps = scale.total * cellsPerPeriod;
    for (var gi = 1; gi < gridSteps; gi++) {
      var p = gi / cellsPerPeriod;
      if (visual.enabled && p > visual.c0 + 0.001 && p < visual.c1 - 0.001) continue;
      var isPeriodBoundary = gi % cellsPerPeriod === 0;
      var isYearBoundary = isPeriodBoundary && (scale.startAbs + p) % P === 0;
      if (isYearBoundary ? !L.showYearGrid : !L.showPeriodGrid) continue;
      var isMonthOnly = !isPeriodBoundary;
      el(
        'line',
        {
          x1: xAtT(p),
          y1: plotTop,
          x2: xAtT(p),
          y2: plotBottom,
          stroke: isYearBoundary ? cfg.colors.gridYear : cfg.colors.gridPeriod,
          'stroke-width': isYearBoundary ? 1.25 : isMonthOnly ? 0.7 : unit === 'month' ? 1.15 : 1,
          'stroke-opacity': isMonthOnly ? 0.75 : null,
          'stroke-dasharray': !isYearBoundary && L.periodGridStyle === 'dashed' ? '3.5 3' : null
        },
        gGrid
      );
    }

    /* ---- 마일스톤 점선 (막대보다 아래 레이어) ---- */
    var gDrop = el('g', null, svg);
    function milestoneY(entry) {
      if (typeof entry.ms.row === 'number' && rowBaselines[entry.ms.row] !== undefined) {
        return rowBaselines[entry.ms.row] + pick(entry.ms.dy, 0) + L.rowMilestoneOffset;
      }
      return calloutTop;
    }

    cfg.milestones.forEach(function (ms, idx) {
      var lineStyle = pick(ms.line, 'dashed');
      if (lineStyle === 'none' || ms.fromRow === null || ms.fromRow === undefined) return;
      var x = xOf(ms.at) + pick(ms.dx, 0);

      /* 시작행: 그 행의 막대 기준선 (또는 표 맨 위) */
      var yStart =
        ms.fromRow === 'top' ? plotTop : rowBaselines[Math.min(ms.fromRow, cfg.rows.length - 1)];

      /* 종료행(toRow):
         - 숫자행 이고 표시 위치(row) 와 같으면 → 그 행 안 삼각형까지
         - 숫자행 이고 표시 위치와 다르면 → 그 행의 막대 기준선까지
         - 'bottom' → 표 아래
         - 생략 → 삼각형(표시 위치)까지
         예) fromRow:0, toRow:1, row:1  → 1행 막대에서 2행 삼각형까지 */
      var yEnd;
      if (typeof ms.toRow === 'number' && rowBaselines[ms.toRow] !== undefined) {
        yEnd = ms.toRow === ms.row ? milestoneY({ ms: ms, index: idx }) : rowBaselines[ms.toRow];
      } else if (ms.toRow === 'bottom') {
        yEnd = calloutTop;
      } else {
        yEnd = milestoneY({ ms: ms, index: idx });
      }

      /* 위→아래가 아니면(시작이 끝보다 아래) 방향을 뒤집어 그립니다 */
      var y1 = yStart;
      var y2 = yEnd;
      if (y2 < y1) {
        y1 = yEnd;
        y2 = yStart;
      }
      if (y2 - y1 < 2) return;

      el(
        'line',
        {
          x1: x,
          y1: y1,
          x2: x,
          y2: y2,
          stroke: color(cfg, ms.color, '#FF0000'),
          'stroke-width': pick(ms.lineWidth, 1.6),
          'stroke-dasharray': lineStyle === 'dashed' ? '5 4' : null
        },
        gDrop
      );
    });

    /* ---- 막대 / 표식 ---- */
    var gBars = el('g', null, svg);
    var gHit = el('g', null, svg);

    cfg.rows.forEach(function (row, i) {
      var base = rowBaselines[i];
      var cycleIdx = 0;

      (row.bars || []).forEach(function (bar, j) {
        var by = base + pick(bar.dy, 0);
        var x1 = xOf(bar.start);
        var x2 = xOf(bar.end);
        var c;
        if (bar.color) {
          c = color(cfg, bar.color, '#9DC3E6');
        } else {
          c = color(cfg, cfg.barColorCycle[cycleIdx % cfg.barColorCycle.length], '#9DC3E6');
          cycleIdx++;
        }
        var w = pick(bar.width, 3);

        el('line', { x1: x1, y1: by, x2: x2, y2: by, stroke: c, 'stroke-width': w }, gBars);
        marker(gBars, x1, by, pick(bar.capStart, 'circle'), color(cfg, bar.capStartColor, c), pick(bar.capSize, 4.6));
        marker(gBars, x2, by, pick(bar.capEnd, 'circle'), color(cfg, bar.capEndColor, c), pick(bar.capSize, 4.6));

        var bl = lines(bar.label);
        if (bl.length) {
          var lx = x1 + (x2 - x1) * pick(bar.labelAt, 0.5) + pick(bar.labelDx, 0);
          var bLabelDy = pick(bar.labelDy, -12);
          var bGrow = bLabelDy >= 0 ? 'down' : 'up';
          var ly = by + bLabelDy;
          labelLeader(gBars, lx, by, lx, ly, '#94A3B8');
          multiline(gBars, lx, ly, bl, {
            size: pick(bar.labelSize, 12.5),
            weight: pick(bar.labelWeight, 'bold'),
            fill: color(cfg, bar.labelColor, cfg.colors.text),
            anchor: pick(bar.labelAnchor, 'middle'),
            lineHeight: 16,
            grow: bGrow
          });
        }

        if (interactive) {
          hit(
            gHit,
            'line',
            { x1: x1 + 8, y1: by, x2: x2 - 8, y2: by, stroke: 'transparent', 'stroke-width': 16 },
            { kind: 'bar', row: i, index: j, part: 'body', cursor: 'grab' }
          );
          hit(
            gHit,
            'circle',
            { cx: x1, cy: by, r: 9, fill: 'transparent' },
            { kind: 'bar', row: i, index: j, part: 'start', cursor: 'ew-resize' }
          );
          hit(
            gHit,
            'circle',
            { cx: x2, cy: by, r: 9, fill: 'transparent' },
            { kind: 'bar', row: i, index: j, part: 'end', cursor: 'ew-resize' }
          );
          if (bl.length) {
            var lw = 0;
            bl.forEach(function (s) {
              lw = Math.max(lw, textWidth(s, pick(bar.labelSize, 12.5)));
            });
            var lcx = x1 + (x2 - x1) * pick(bar.labelAt, 0.5) + pick(bar.labelDx, 0);
            var lby = by + pick(bar.labelDy, -12);
            var hitY = lby >= by ? lby - 3 : lby - bl.length * 16 + 3;
            hit(
              gHit,
              'rect',
              {
                x: lcx - lw / 2 - 4,
                y: hitY,
                width: lw + 8,
                height: bl.length * 16 + 4,
                fill: 'transparent'
              },
              { kind: 'bar', row: i, index: j, part: 'label', cursor: 'ns-resize' }
            );
          }
        }

        if (sel && sel.kind === 'bar' && sel.row === i && sel.index === j) {
          el(
            'rect',
            {
              x: Math.min(x1, x2) - 7,
              y: by - 9,
              width: Math.abs(x2 - x1) + 14,
              height: 18,
              rx: 9,
              fill: 'none',
              stroke: SELECT_COLOR,
              'stroke-width': 1.6,
              'stroke-dasharray': '4 3',
              'data-editor': 'select'
            },
            gHit
          );
        }
      });

      /* markers + deliverables */
      var pts = [];
      (row.markers || []).forEach(function (mk, j) {
        pts.push({ mk: mk, kind: 'marker', index: j });
      });
      (row.deliverables || []).forEach(function (d, j) {
        pts.push({
          mk: merge({ type: 'diamond', color: 'green', size: 4.6, labelPos: 'below', labelSize: 11, labelDy: 16 }, d),
          kind: 'deliverable',
          index: j
        });
      });

      pts.forEach(function (entry) {
        var mk = entry.mk;
        var mx = xOf(mk.at) + pick(mk.dx, 0);
        var my = base + pick(mk.dy, 0);
        marker(gBars, mx, my, pick(mk.type, 'filled'), color(cfg, mk.color, '#1F3864'), pick(mk.size, 5.5));
        var ml = lines(mk.label);
        if (ml.length) {
          var below = pick(mk.labelPos, 'above') === 'below';
          var mLabelDy = pick(mk.labelDy, below ? 16 : -12);
          var mlx = mx + pick(mk.labelDx, 0);
          var mly = my + mLabelDy;
          labelLeader(gBars, mx, my, mlx, mly, '#94A3B8');
          multiline(gBars, mlx, mly, ml, {
            size: pick(mk.labelSize, 12.5),
            weight: pick(mk.labelWeight, 'bold'),
            fill: color(cfg, mk.labelColor, cfg.colors.text),
            lineHeight: 15,
            grow: below ? 'down' : 'up'
          });
        }
        if (interactive) {
          hit(
            gHit,
            'circle',
            { cx: mx, cy: my, r: 10, fill: 'transparent' },
            { kind: entry.kind, row: i, index: entry.index, part: 'at', cursor: 'ew-resize' }
          );
          if (ml.length) {
            var mlw = 0;
            ml.forEach(function (s) {
              mlw = Math.max(mlw, textWidth(s, pick(mk.labelSize, 12.5)));
            });
            var mHitY = below ? mly - 3 : mly - ml.length * 15 + 3;
            hit(
              gHit,
              'rect',
              {
                x: mlx - mlw / 2 - 4,
                y: mHitY,
                width: mlw + 8,
                height: ml.length * 15 + 4,
                fill: 'transparent'
              },
              { kind: entry.kind, row: i, index: entry.index, part: 'label', cursor: 'ns-resize' }
            );
          }
        }
        if (sel && sel.kind === entry.kind && sel.row === i && sel.index === entry.index) {
          el(
            'circle',
            {
              cx: mx,
              cy: my,
              r: 11,
              fill: 'none',
              stroke: SELECT_COLOR,
              'stroke-width': 1.6,
              'stroke-dasharray': '4 3',
              'data-editor': 'select'
            },
            gHit
          );
        }
      });
    });

    /* ---- 마일스톤 삼각형 + 설명 (행 안 / 표 아래 공통) ---- */
    var gCallout = el('g', null, svg);
    cfg.milestones.forEach(function (ms, idx) {
      var entry = { ms: ms, index: idx };
      var x = xOf(ms.at) + pick(ms.dx, 0);
      var yTop = milestoneY(entry);
      var c = color(cfg, ms.color, '#FF0000');
      var tw = L.calloutTriangleWidth;
      var th = L.calloutTriangleHeight;

      if (pick(ms.triangle, true)) {
        el(
          'path',
          {
            d: 'M ' + (x - tw / 2) + ' ' + yTop + ' L ' + (x + tw / 2) + ' ' + yTop + ' L ' + x + ' ' + (yTop + th) + ' Z',
            fill: c
          },
          gCallout
        );
      }

      var tl = lines(ms.title);
      var titleDy = pick(ms.titleDy, 0);
      var gap = L.calloutTextGap;
      var ty = titleDy < 0 ? yTop - gap + titleDy : yTop + th + gap + titleDy;
      var aboveTri = titleDy < 0;
      var titleGrow = aboveTri ? 'up' : 'down';
      if (Math.abs(titleDy) > 8) {
        labelLeader(
          gCallout,
          x,
          aboveTri ? yTop : yTop + th,
          x,
          aboveTri ? ty + 2 : ty - 2,
          color(cfg, ms.color, '#94A3B8')
        );
      }
      multiline(gCallout, x, ty, tl, {
        size: pick(ms.titleSize, 12.5),
        weight: 'bold',
        fill: color(cfg, ms.titleColor, cfg.colors.text),
        lineHeight: L.calloutLineHeight,
        grow: titleGrow
      });

      var items = ms.items || [];
      if (items.length) {
        var ix = x - pick(ms.itemsDx, L.calloutItemIndent);
        var iy = aboveTri
          ? yTop + th + gap
          : ty + tl.length * L.calloutLineHeight + 2;
        items.forEach(function (item, ii) {
          text(gCallout, ix, iy + ii * L.calloutLineHeight, '• ' + item, {
            size: pick(ms.itemSize, 12),
            anchor: 'start',
            fill: cfg.colors.text
          });
        });
      }

      var nTitle = Math.max(1, tl.length);
      var titleTop = aboveTri ? ty - (nTitle - 1) * L.calloutLineHeight - 11 : ty - 11;
      var titleBot = aboveTri ? ty + 3 : ty + (nTitle - 1) * L.calloutLineHeight + 3;
      if (items.length) {
        var itemsTop = aboveTri ? yTop + th + gap - 11 : ty + nTitle * L.calloutLineHeight - 9;
        var itemsBot = (aboveTri ? yTop + th + gap : ty + nTitle * L.calloutLineHeight + 2) + (items.length - 1) * L.calloutLineHeight + 3;
        titleBot = Math.max(titleBot, itemsBot);
        titleTop = Math.min(titleTop, itemsTop);
      }
      var blockTop = Math.min(yTop - 4, titleTop);
      var blockBot = Math.max(yTop + th, titleBot);
      var blockH = blockBot - blockTop;
      var blockW = 34;
      tl.forEach(function (line) {
        blockW = Math.max(blockW, textWidth(line, pick(ms.titleSize, 12.5)) + 10);
      });
      (ms.items || []).forEach(function (item) {
        blockW = Math.max(blockW, textWidth('• ' + item, pick(ms.itemSize, 12)) + 10);
      });
      blockW = Math.min(blockW, 190);

      if (interactive) {
        /* 삼각형 = 시점 이동, 문구 영역 = 세로 위치 이동 */
        hit(
          gHit,
          'rect',
          {
            x: x - Math.max(tw, 16),
            y: yTop - 4,
            width: Math.max(tw, 16) * 2,
            height: th + 10,
            fill: 'transparent'
          },
          { kind: 'milestone', index: idx, part: 'at', cursor: 'ew-resize' }
        );
        var labelH = Math.max(16, titleBot - titleTop + 4);
        hit(
          gHit,
          'rect',
          {
            x: x - blockW / 2,
            y: titleTop,
            width: blockW,
            height: labelH,
            fill: 'transparent'
          },
          { kind: 'milestone', index: idx, part: 'label', cursor: 'ns-resize' }
        );
      }
      if (sel && sel.kind === 'milestone' && sel.index === idx) {
        el(
          'rect',
          {
            x: x - blockW / 2 - 3,
            y: blockTop - 4,
            width: blockW + 6,
            height: blockH + 8,
            rx: 6,
            fill: 'none',
            stroke: SELECT_COLOR,
            'stroke-width': 1.6,
            'stroke-dasharray': '4 3',
            'data-editor': 'select'
          },
          gHit
        );
      }
    });

    /* ---- 표 외곽선 ---- */
    el(
      'rect',
      {
        x: L.padding,
        y: headerTop,
        width: L.labelColWidth + plotW,
        height: plotBottom - headerTop,
        fill: 'none',
        stroke: gridColor,
        'stroke-width': 1
      },
      svg
    );

    /* ---- 범례 ---- */
    if (legendHeight) {
      var gLegend = el('g', null, svg);
      el(
        'rect',
        {
          x: L.padding,
          y: legendTop,
          width: L.labelColWidth + plotW,
          height: legendHeight,
          rx: 6,
          fill: '#FAFAFA',
          stroke: gridColor,
          'stroke-width': 1
        },
        gLegend
      );
      if (interactive) {
        hit(
          gHit,
          'rect',
          { x: L.padding, y: legendTop, width: L.labelColWidth + plotW, height: legendHeight, fill: 'transparent' },
          { kind: 'legend', cursor: 'pointer' }
        );
      }
      if (sel && sel.kind === 'legend') {
        el(
          'rect',
          {
            x: L.padding - 2,
            y: legendTop - 2,
            width: L.labelColWidth + plotW + 4,
            height: legendHeight + 4,
            rx: 7,
            fill: 'none',
            stroke: SELECT_COLOR,
            'stroke-width': 1.6,
            'stroke-dasharray': '4 3',
            'data-editor': 'select'
          },
          gHit
        );
      }
      if (cfg.legend.title) {
        text(gLegend, L.padding + L.legendPadding, legendTop + L.legendPadding + 11, cfg.legend.title, {
          size: 12.5,
          weight: 'bold',
          anchor: 'start',
          fill: '#333'
        });
      }
      legendRows.forEach(function (rowItems, ri) {
        var ly = legendTop + L.legendPadding + 11 + ri * L.legendLineHeight;
        rowItems.forEach(function (entry) {
          var item = entry.item;
          var itemIndex = cfg.legend.items.indexOf(item);
          var sx = L.padding + L.legendPadding + entry.x;
          var boxW = entry.symbolW + textWidth(item.label, 12.5) + 8;

          if (interactive) {
            hit(
              gHit,
              'rect',
              { x: sx - 5, y: ly - 15, width: boxW, height: 21, fill: 'transparent' },
              { kind: 'legendItem', index: itemIndex, cursor: 'pointer' }
            );
          }
          if (sel && sel.kind === 'legendItem' && sel.index === itemIndex) {
            el(
              'rect',
              {
                x: sx - 6,
                y: ly - 16,
                width: boxW + 2,
                height: 23,
                rx: 4,
                fill: 'none',
                stroke: SELECT_COLOR,
                'stroke-width': 1.4,
                'stroke-dasharray': '4 3',
                'data-editor': 'select'
              },
              gHit
            );
          }
          var c = color(cfg, item.color, '#9DC3E6');
          var symMid = sx + 13;

          if (item.type === 'line') {
            el('line', { x1: sx, y1: ly - 4, x2: sx + 26, y2: ly - 4, stroke: c, 'stroke-width': 3 }, gLegend);
            marker(gLegend, sx, ly - 4, 'circle', c, 4.2);
            marker(gLegend, sx + 26, ly - 4, 'circle', c, 4.2);
          } else if (item.type === 'lineAlt') {
            var pair = item.colors && item.colors.length ? item.colors : cfg.barColorCycle;
            var c1 = color(cfg, pair[0], '#9DC3E6');
            var c2 = color(cfg, pair[1] || pair[0], '#1F3864');
            el('line', { x1: sx, y1: ly - 4, x2: sx + 22, y2: ly - 4, stroke: c1, 'stroke-width': 3 }, gLegend);
            el('line', { x1: sx + 22, y1: ly - 4, x2: sx + 46, y2: ly - 4, stroke: c2, 'stroke-width': 3 }, gLegend);
            marker(gLegend, sx, ly - 4, 'circle', c1, 4.2);
            marker(gLegend, sx + 22, ly - 4, 'circle', c2, 4.2);
            marker(gLegend, sx + 46, ly - 4, 'circle', c2, 4.2);
          } else if (item.type === 'milestone') {
            el(
              'line',
              { x1: symMid, y1: ly - 15, x2: symMid, y2: ly - 7, stroke: c, 'stroke-width': 1.6, 'stroke-dasharray': '4 3' },
              gLegend
            );
            el(
              'path',
              { d: 'M ' + (symMid - 6) + ' ' + (ly - 7) + ' L ' + (symMid + 6) + ' ' + (ly - 7) + ' L ' + symMid + ' ' + (ly + 2) + ' Z', fill: c },
              gLegend
            );
          } else if (item.type === 'triangle') {
            el(
              'path',
              { d: 'M ' + (symMid - 6) + ' ' + (ly - 7) + ' L ' + (symMid + 6) + ' ' + (ly - 7) + ' L ' + symMid + ' ' + (ly + 3) + ' Z', fill: c },
              gLegend
            );
          } else {
            marker(gLegend, symMid, ly - 4, item.marker || 'filled', c, 5);
          }

          text(gLegend, sx + entry.symbolW, ly, item.label, { size: 12.5, anchor: 'start', fill: '#222' });
        });
      });
    }

    /* 클릭 판정용 투명 레이어 (비교 알약보다 아래 — 알약 클릭 가능해야 함) */
    if (interactive) {
      /* 선택된 일정의 시점·종점 히트를 맨 위로 — 이어진 구간에서 이웃이 잡히지 않게 */
      if (sel) {
        Array.prototype.slice.call(gHit.querySelectorAll('[data-kind]')).forEach(function (n) {
          var sameKind = n.getAttribute('data-kind') === sel.kind;
          var sameIdx = n.hasAttribute('data-index') && +n.getAttribute('data-index') === sel.index;
          var sameRow =
            sel.kind === 'milestone' ||
            (n.hasAttribute('data-row') && +n.getAttribute('data-row') === sel.row);
          if (sameKind && sameIdx && sameRow) gHit.appendChild(n);
        });
      }
      svg.appendChild(gHit);
    }

    /* ---- 변경 비교 오버레이 (변경 후 차트에만 전달됨) ---- */
    var compareSummary = null;
    if (options.compareChanges && global.GanttCompare) {
      compareSummary = GanttCompare.summarize(options.compareChanges);
      var apiProbe = {
        scale: scale,
        layout: L,
        plotX: plotX,
        plotW: plotW,
        plotTop: plotTop,
        plotBottom: plotBottom,
        rowTops: rowTops,
        rowHeights: rowHeights,
        rowBaselines: rowBaselines,
        totalWidth: totalWidth,
        totalHeight: totalHeight,
        xOf: xOf
      };
      GanttCompare.draw(svg, apiProbe, options.compareChanges, options.compareStyle, interactive);
    }

    /* ---- 편집용 정보 노출 ---- */
    svg.__gantt = {
      config: cfg,
      scale: scale,
      visual: visual,
      layout: L,
      plotX: plotX,
      plotW: plotW,
      plotTop: plotTop,
      plotBottom: plotBottom,
      rowTops: rowTops,
      rowHeights: rowHeights,
      rowBaselines: rowBaselines,
      xOf: xOf,
      timeAtX: function (px) {
        return visual.vToT((px - plotX) / L.periodWidth);
      },
      unit: unit,
      format: unit === 'month' ? scale.formatMonth : scale.format,
      totalWidth: totalWidth,
      totalHeight: totalHeight,
      outputWidth: outW,
      outputHeight: outH,
      fontScale: fontScale,
      compareSummary: compareSummary
    };

    if (container) {
      container.innerHTML = '';
      container.appendChild(svg);
    }
    return svg;
  }

  /* ------------------------------------------------------------------ export */

  function serialize(svg) {
    var clone = svg.cloneNode(true);
    Array.prototype.slice.call(clone.querySelectorAll('[data-editor="hit"], [data-editor="select"]')).forEach(function (n) {
      n.parentNode.removeChild(n);
    });
    clone.setAttribute('xmlns', NS);
    clone.setAttribute('width', svg.getAttribute('data-width'));
    clone.setAttribute('height', svg.getAttribute('data-height'));
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(clone);
  }

  function download(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 1000);
  }

  function exportSVG(svg, filename) {
    download(new Blob([serialize(svg)], { type: 'image/svg+xml;charset=utf-8' }), filename || 'gantt.svg');
  }

  function exportPNG(svg, scale, filename) {
    scale = scale || 2;
    var w = +svg.getAttribute('data-width');
    var h = +svg.getAttribute('data-height');
    var src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(serialize(svg));

    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () {
        var canvas = document.createElement('canvas');
        canvas.width = Math.round(w * scale);
        canvas.height = Math.round(h * scale);
        var ctx = canvas.getContext('2d');
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.setTransform(scale, 0, 0, scale, 0, 0);
        ctx.drawImage(img, 0, 0);
        canvas.toBlob(function (blob) {
          download(blob, filename || 'gantt.png');
          resolve();
        }, 'image/png');
      };
      img.onerror = reject;
      img.src = src;
    });
  }

  global.Gantt = {
    render: render,
    exportPNG: exportPNG,
    exportSVG: exportSVG,
    serialize: serialize,
    normalize: normalize,
    makeScale: makeScale,
    snapLabelAt: snapLabelAt,
    DEFAULT_PALETTE: DEFAULT_PALETTE
  };
})(window);
