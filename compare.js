/* ============================================================================
 *  compare.js  ―  기준 일정 대비 변경(추가 / 단축 / 지연) 표시
 *  · 변경 비교 모드에서는 위=변경 전 / 아래=변경 후 두 차트를 쓰고
 *    표시(화살표·알약)는 아래(변경 후) 차트에만 그립니다.
 * ========================================================================== */
(function (global) {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';

  /* 기본 색 — 설정(compareStyle) 또는 인스펙터에서 바꿀 수 있습니다 */
  var DEFAULT_STYLE = {
    add: { fill: '#E11D48', label: '추가' },
    shorten: { fill: '#EF4444', label: '단축' },
    delay: { fill: '#EA580C', label: '지연' },   /* 따뜻한 오렌지 */
    ghost: { fill: '#FB7185', label: '기존 일정' }
  };

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

  function uid(prefix) {
    return (prefix || 'e') + '-' + Math.random().toString(36).slice(2, 9);
  }

  function hexToRgba(hex, a) {
    var h = String(hex || '#999999').replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    if (isNaN(n)) return 'rgba(0,0,0,' + a + ')';
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }

  function resolveStyle(custom) {
    var out = {};
    ['add', 'shorten', 'delay', 'ghost'].forEach(function (key) {
      var base = DEFAULT_STYLE[key];
      var over = (custom && custom[key]) || {};
      var fill = over.fill || base.fill;
      out[key] = {
        fill: fill,
        label: over.label || base.label,
        soft: hexToRgba(fill, 0.12),
        ring: hexToRgba(fill, 0.45)
      };
    });
    return out;
  }

  function ensureIds(cfg) {
    if (!cfg) return cfg;
    (cfg.rows || []).forEach(function (row, ri) {
      (row.bars || []).forEach(function (b, i) {
        if (!b.id) b.id = 'bar-' + ri + '-' + i + '-' + uid('x');
      });
      (row.markers || []).forEach(function (m, i) {
        if (!m.id) m.id = 'mk-' + ri + '-' + i + '-' + uid('x');
      });
      (row.deliverables || []).forEach(function (d, i) {
        if (!d.id) d.id = 'dv-' + ri + '-' + i + '-' + uid('x');
      });
    });
    (cfg.milestones || []).forEach(function (ms, i) {
      if (!ms.id) ms.id = 'ms-' + i + '-' + uid('x');
    });
    return cfg;
  }

  function indexConfig(cfg) {
    var map = {};
    (cfg.rows || []).forEach(function (row, ri) {
      (row.bars || []).forEach(function (b, bi) {
        map[b.id] = { kind: 'bar', row: ri, index: bi, item: b };
      });
      (row.markers || []).forEach(function (m, mi) {
        map[m.id] = { kind: 'marker', row: ri, index: mi, item: m };
      });
      (row.deliverables || []).forEach(function (d, di) {
        map[d.id] = { kind: 'deliverable', row: ri, index: di, item: d };
      });
    });
    (cfg.milestones || []).forEach(function (ms, i) {
      map[ms.id] = {
        kind: 'milestone',
        row: typeof ms.row === 'number' ? ms.row : null,
        index: i,
        item: ms
      };
    });
    return map;
  }

  function nearly(a, b) {
    return Math.abs(a - b) < 0.02;
  }

  function nameOf(entry) {
    var it = entry.item;
    if (entry.kind === 'milestone') return String(it.title || '마일스톤').replace(/\n/g, ' ');
    return String(it.label || it.title || '항목').replace(/\n/g, ' ');
  }

  /* type: add | shorten | delay  (delay = 예전 extend) */
  function diff(baseline, current, scale) {
    ensureIds(baseline);
    ensureIds(current);
    var baseMap = indexConfig(baseline);
    var curMap = indexConfig(current);
    var changes = [];
    var id;

    for (id in curMap) {
      if (!Object.prototype.hasOwnProperty.call(curMap, id)) continue;
      var cur = curMap[id];
      var base = baseMap[id];
      if (!base) {
        changes.push({
          type: 'add', kind: cur.kind, row: cur.row, index: cur.index,
          id: id, item: cur.item, name: nameOf(cur)
        });
        continue;
      }

      if (cur.kind === 'bar') {
        var bs = scale.parse(base.item.start);
        var be = scale.parse(base.item.end);
        var cs = scale.parse(cur.item.start);
        var ce = scale.parse(cur.item.end);
        if (nearly(bs, cs) && nearly(be, ce)) continue;

        /*
         * 구간 단축/지연은 종점(end)만 기준으로 판단합니다.
         *   단축: 종점이 앞으로(더 이르게) 이동
         *   지연: 종점이 뒤로(더 늦게) 이동
         * 시작만 바뀌고 종점이 같으면 마커를 띄우지 않습니다.
         * (예전: 길이 증가를 지연으로 봐서 시작만 앞당긴 경우에도 지연이 뜨던 문제)
         */
        if (ce < be - 0.02) {
          changes.push({
            type: 'shorten', kind: 'bar', row: cur.row, index: cur.index,
            id: id, item: cur.item, name: nameOf(cur),
            oldStart: base.item.start, oldEnd: base.item.end,
            newStart: cur.item.start, newEnd: cur.item.end,
            from: be, to: ce
          });
        } else if (ce > be + 0.02) {
          changes.push({
            type: 'delay', kind: 'bar', row: cur.row, index: cur.index,
            id: id, item: cur.item, name: nameOf(cur),
            oldStart: base.item.start, oldEnd: base.item.end,
            newStart: cur.item.start, newEnd: cur.item.end,
            from: be, to: ce
          });
        }
      } else {
        var bat = scale.parse(base.item.at);
        var cat = scale.parse(cur.item.at);
        if (nearly(bat, cat) && base.row === cur.row) continue;
        if (cat < bat - 0.02) {
          changes.push({
            type: 'shorten', kind: cur.kind, row: cur.row, index: cur.index,
            id: id, item: cur.item, name: nameOf(cur),
            oldAt: base.item.at, newAt: cur.item.at, from: bat, to: cat
          });
        } else if (cat > bat + 0.02) {
          changes.push({
            type: 'delay', kind: cur.kind, row: cur.row, index: cur.index,
            id: id, item: cur.item, name: nameOf(cur),
            oldAt: base.item.at, newAt: cur.item.at, from: bat, to: cat
          });
        }
      }
    }

    return changes;
  }

  function isHidden(ch) {
    return !!(ch && ch.item && ch.item.compareHidden);
  }

  function summarize(changes) {
    var s = { add: 0, shorten: 0, delay: 0, hidden: 0 };
    changes.forEach(function (c) {
      if (isHidden(c)) {
        s.hidden++;
        return;
      }
      if (s[c.type] !== undefined) s[c.type]++;
    });
    return s;
  }

  function affectedRows(changes) {
    var map = {};
    (changes || []).forEach(function (c) {
      if (isHidden(c)) return;
      if (typeof c.row === 'number') map[c.row] = true;
    });
    return map;
  }

  /* 막대 기준선(0) 기준, 비교 표시(화살표·알약)가 차지하는 위/아래 */
  var OVERLAY_FROM_BAR = 18;
  var PILL_H = 22;
  var PILL_BELOW_ARROW = 14; /* 단축·지연 알약 중심 = 화살표 + 14 */
  var PILL_SHADOW = 2;
  var OVERLAY_AIR = 6;       /* 알약 아래 숨 쉴 자리 (문구 measure 의 +3 보다 큼) */

  function overlayBoundsRel(ch, layout) {
    if (!ch || isHidden(ch) || typeof ch.row !== 'number') return null;
    var yBar = (ch.item && ch.item.dy) || 0;
    if (ch.kind === 'milestone') {
      yBar += (layout && layout.rowMilestoneOffset != null)
        ? +layout.rowMilestoneOffset
        : 0;
    }
    var user = (ch.item && ch.item.compareOffsetDy) || 0;
    var yOv = yBar + OVERLAY_FROM_BAR + user;
    var half = PILL_H / 2;
    if (ch.type === 'add') {
      return {
        top: Math.min(yBar, yOv - half),
        bottom: yOv + half + PILL_SHADOW + OVERLAY_AIR
      };
    }
    /* 단축 / 지연: 알약은 화살표 바로 아래, 기존 일정 꼬리표도 화살표 아래 */
    var pillBot = yOv + PILL_BELOW_ARROW + half + PILL_SHADOW;
    var ghostBot = yOv + 5.2 + 1 + 15;
    return {
      top: Math.min(yBar - 4.2, yOv),
      bottom: Math.max(pillBot, ghostBot) + OVERLAY_AIR
    };
  }

  /* 행별 비교 표시에 필요한 아래쪽 끝(px, 막대 기준선 기준) */
  function comparePadMap(changes, layout) {
    var map = {};
    (changes || []).forEach(function (c) {
      var b = overlayBoundsRel(c, layout);
      if (!b) return;
      map[c.row] = Math.max(map[c.row] || 0, b.bottom);
    });
    return map;
  }

  /* ---------------------------------------------------------------- drawing */

  function pillWidth(label) {
    return Math.max(48, String(label).length * 11 + 9 * 2 + 16);
  }

  function pill(parent, x, y, label, theme, opts) {
    opts = opts || {};
    var h = 22;
    var w = pillWidth(label);
    /* dot = 왼쪽 흰 점을 x 에 맞춤 (추가 알약·일정 정렬용) */
    var ax =
      opts.anchor === 'start' ? x :
      opts.anchor === 'end' ? x - w :
      opts.anchor === 'dot' ? x - 11 :
      x - w / 2;
    var g = el('g', { 'data-compare': 'pill' }, parent);
    if (opts.itemKind != null && opts.index != null) {
      /* 알약 클릭 → 해당 일정 선택 (높이 조절). 범례는 compareStyle 유지 */
      g.setAttribute('data-kind', opts.itemKind);
      if (opts.row != null) g.setAttribute('data-row', String(opts.row));
      g.setAttribute('data-index', String(opts.index));
      g.setAttribute('data-part', 'compare');
      if (opts.changeType) g.setAttribute('data-compare-type', opts.changeType);
      g.setAttribute('style', 'cursor:ns-resize');
    } else if (opts.kind) {
      g.setAttribute('data-kind', 'compareStyle');
      g.setAttribute('data-part', opts.kind);
      g.setAttribute('style', 'cursor:pointer');
    }

    el('rect', {
      x: ax + 1, y: y - h / 2 + 1.5, width: w, height: h, rx: h / 2,
      fill: 'rgba(15,23,42,0.14)'
    }, g);
    el('rect', {
      x: ax, y: y - h / 2, width: w, height: h, rx: h / 2,
      fill: theme.fill
    }, g);
    el('circle', { cx: ax + 11, cy: y, r: 3.4, fill: '#FFFFFF' }, g);
    var t = el('text', {
      x: ax + 20, y: y + 4.3,
      'font-size': 12, 'font-weight': 'bold', fill: '#FFFFFF',
      'text-anchor': 'start'
    }, g);
    t.textContent = label;
    return { x: ax, y: y - h / 2, w: w, h: h, cx: ax + w / 2 };
  }

  /*
   * 막대 아래를 지나는 곧은 화살표.
   * 화살촉은 도착점 원 "바깥"에서 끝나고, 흰 외곽선을 둘러 알약·격자 위에서도 보이게 합니다.
   */
  function straightArrow(parent, x1, x2, y, theme, ghostFill) {
    if (Math.abs(x2 - x1) < 6) return;
    var dir = x2 > x1 ? 1 : -1;

    var rFrom = 5.2;
    var rTo = 5.2;
    var headLen = 11;
    var headHalf = 6.5;

    /* 출발/도착 원을 먼저 깔고, 그 위에 화살표를 그립니다 */
    el('circle', {
      cx: x1, cy: y, r: rFrom,
      fill: '#FFFFFF', stroke: ghostFill || theme.fill, 'stroke-width': 2.2,
      'stroke-dasharray': '2.5 2'
    }, parent);
    el('circle', {
      cx: x2, cy: y, r: rTo,
      fill: theme.fill, stroke: '#FFFFFF', 'stroke-width': 1.5
    }, parent);

    /* 화살촉 끝 = 도착 원 가장자리 바로 앞 */
    var tipX = x2 - dir * (rTo + 2.5);
    var baseX = tipX - dir * headLen;
    var shaftFrom = x1 + dir * (rFrom + 1);
    if ((baseX - shaftFrom) * dir < 2) baseX = shaftFrom + dir * 2;

    el('line', {
      x1: shaftFrom, y1: y, x2: baseX, y2: y,
      stroke: '#FFFFFF', 'stroke-width': 7, 'stroke-linecap': 'round', opacity: 0.95
    }, parent);
    el('line', {
      x1: shaftFrom, y1: y, x2: baseX, y2: y,
      stroke: theme.fill, 'stroke-width': 2.6, 'stroke-linecap': 'round'
    }, parent);

    el('path', {
      d: 'M ' + baseX + ' ' + (y - headHalf) +
         ' L ' + tipX + ' ' + y +
         ' L ' + baseX + ' ' + (y + headHalf) + ' Z',
      fill: theme.fill, stroke: '#FFFFFF', 'stroke-width': 1.8, 'stroke-linejoin': 'round'
    }, parent);
  }

  /* 일정 라인(yBar) ↔ 화살표. skipTop~skipBot 구간(제목)은 건너뛰어 글자를 가리지 않음 */
  function leader(parent, x, yBar, yEnd, color, skipTop, skipBot) {
    function seg(ya, yb) {
      if (Math.abs(yb - ya) < 3) return;
      el('line', {
        x1: x, y1: ya, x2: x, y2: yb,
        stroke: color, 'stroke-width': 1.5,
        'stroke-dasharray': '3.5 2.5', opacity: 0.9
      }, parent);
    }
    if (skipTop == null || skipBot == null || skipBot <= skipTop) {
      var y1 = yEnd > yBar ? yBar + 5 : yBar - 5;
      seg(y1, yEnd);
      return;
    }
    if (yEnd > yBar) {
      seg(yBar + 5, Math.min(skipTop, yEnd));
      seg(Math.max(skipBot, yBar + 5), yEnd);
    } else {
      seg(yBar - 5, Math.max(skipBot, yEnd));
      seg(Math.min(skipTop, yBar - 5), yEnd);
    }
  }

  function ghostMarker(parent, x, yBar, yLabel, theme) {
    leader(parent, x, yBar, yLabel - 8, theme.fill);
    el('circle', {
      cx: x, cy: yBar, r: 4.2,
      fill: '#FFFFFF', stroke: theme.fill, 'stroke-width': 1.7,
      'stroke-dasharray': '2 1.5'
    }, parent);

    var label = theme.label || '기존 일정';
    var tw = label.length * 9.2 + 10;
    el('rect', {
      x: x - tw / 2, y: yLabel - 10, width: tw, height: 15, rx: 4,
      fill: '#FFFFFF', stroke: theme.fill, 'stroke-width': 1, opacity: 0.96
    }, parent);
    var t = el('text', {
      x: x, y: yLabel + 1, 'text-anchor': 'middle',
      'font-size': 10, 'font-weight': 'bold', fill: theme.fill
    }, parent);
    t.textContent = label;
  }

  function draw(svg, api, changes, style, interactive) {
    var theme = resolveStyle(style);
    if (!changes || !changes.length) return null;

    var g = el('g', { 'data-compare': 'layer' }, svg);
    var scale = api.scale;
    var L = api.layout;

    function xOf(t) {
      if (api.xOf) return api.xOf(t);
      return api.plotX + scale.clamp(typeof t === 'number' ? t : scale.parse(t)) * L.periodWidth;
    }

    function rowBand(rowIdx) {
      if (rowIdx === null || rowIdx === undefined || rowIdx < 0) {
        return { top: api.plotBottom + 8, base: api.plotBottom + 20, bottom: api.plotBottom + 50, h: 40 };
      }
      var top = api.rowTops[rowIdx];
      var h = api.rowHeights[rowIdx];
      var base = api.rowBaselines[rowIdx];
      return { top: top, base: base, bottom: top + h, h: h };
    }

    /* 같은 행·가까운 X 에 여러 표시가 있을 때만 살짝 아래로 */
    var rowSlots = {};

    function yBarOf(ch, band) {
      var dy = (ch.item && ch.item.dy) || 0;
      if (ch.kind === 'milestone') {
        return band.base + L.rowMilestoneOffset + dy;
      }
      return band.base + dy;
    }

    function overlayY(ch, band, slotDy) {
      var user = (ch.item && ch.item.compareOffsetDy) || 0;
      /* 기본은 일정에 가깝게(18px). 겹치면 인스펙터에서 compareOffsetDy 로 내림 */
      return yBarOf(ch, band) + 18 + user + slotDy;
    }

    function pillOpts(ch) {
      if (!interactive || ch.index == null) return { kind: ch.type };
      return {
        itemKind: ch.kind,
        row: ch.row,
        index: ch.index,
        changeType: ch.type
      };
    }

    function takeSlot(ch, xCenter) {
      var list = rowSlots[ch.row] || (rowSlots[ch.row] = []);
      var slot = 0;
      list.forEach(function (prev) {
        if (Math.abs(prev.x - xCenter) < 70) slot = Math.max(slot, prev.slot + 1);
      });
      list.push({ x: xCenter, slot: slot });
      return slot * 14;
    }

    changes.forEach(function (ch) {
      if (isHidden(ch)) return;

      var th = theme[ch.type] || theme.add;
      var band = rowBand(ch.row);
      var yBar = yBarOf(ch, band);

      if (ch.type === 'add') {
        var ax = ch.kind === 'bar'
          ? (xOf(ch.item.start) + xOf(ch.item.end)) / 2
          : xOf(ch.item.at) + ((ch.item && ch.item.dx) || 0);
        var slotDy = takeSlot(ch, ax);
        var addY = overlayY(ch, band, slotDy);
        el('circle', {
          cx: ax, cy: yBar, r: 7.5,
          fill: 'none', stroke: th.fill, 'stroke-width': 2.2, opacity: 0.9
        }, g);
        leader(g, ax, yBar, addY - 12, th.fill);
        /* 흰 점(●)을 일정 X 에 맞춰 정렬 */
        var addOpts = pillOpts(ch);
        addOpts.anchor = 'dot';
        pill(g, ax, addY, th.label, th, addOpts);
        return;
      }

      /* 단축 / 지연 */
      var fromX = xOf(ch.from);
      var toX = xOf(ch.to);
      var dir = toX >= fromX ? 1 : -1;
      var midX = (fromX + toX) / 2;
      var slotDy2 = takeSlot(ch, midX);
      var yArrow = overlayY(ch, band, slotDy2);

      el('circle', {
        cx: fromX, cy: yBar, r: 4.2,
        fill: '#FFFFFF', stroke: theme.ghost.fill, 'stroke-width': 1.7,
        'stroke-dasharray': '2 1.5'
      }, g);
      leader(g, fromX, yBar, yArrow, theme.ghost.fill);
      leader(g, toX, yBar, yArrow, th.fill);
      straightArrow(g, fromX, toX, yArrow, th, theme.ghost.fill);

      /* 기존 일정 꼬리표 = 점선 원 우측 하단에 붙임 */
      var gl = theme.ghost.label || '기존 일정';
      var tw = gl.length * 9.2 + 10;
      var ghostR = 5.2;
      var ghostLeft = fromX + 3;
      if (ghostLeft + tw > api.plotX + api.plotW - 4) {
        ghostLeft = fromX - tw - 3;
      }
      var ghostTop = yArrow + ghostR + 1;
      el('rect', {
        x: ghostLeft, y: ghostTop, width: tw, height: 15, rx: 4,
        fill: '#FFFFFF', stroke: theme.ghost.fill, 'stroke-width': 1, opacity: 0.96
      }, g);
      var gt = el('text', {
        x: ghostLeft + tw / 2, y: ghostTop + 11, 'text-anchor': 'middle',
        'font-size': 10, 'font-weight': 'bold', fill: theme.ghost.fill
      }, g);
      gt.textContent = gl;

      /* 단축·지연 알약은 항상 화살표 바로 아래 (전체 높이는 compareOffsetDy 로 조절) */
      var pw = pillWidth(th.label);
      var badgeX = Math.min(
        api.plotX + api.plotW - pw / 2 - 4,
        Math.max(api.plotX + pw / 2 + 4, midX)
      );
      var badgeY = yArrow + 14;

      pill(g, badgeX, badgeY, th.label, th, pillOpts(ch));
    });

    return g;
  }

  function drawLegend(svg, api, summary, style, interactive) {
    var theme = resolveStyle(style);
    var items = [
      { key: 'add', label: theme.add.label + ' ' + summary.add },
      { key: 'shorten', label: theme.shorten.label + ' ' + summary.shorten },
      { key: 'delay', label: theme.delay.label + ' ' + summary.delay }
    ].filter(function (it) { return summary[it.key] > 0; });

    var g = el('g', { 'data-compare': 'legend' }, svg);

    if (!items.length) {
      el('rect', {
        x: api.totalWidth - 168, y: 10, width: 144, height: 28, rx: 14,
        fill: '#F3F4F6', stroke: '#D1D5DB'
      }, g);
      var t = el('text', {
        x: api.totalWidth - 96, y: 28, 'text-anchor': 'middle',
        'font-size': 11.5, fill: '#6B7280', 'font-weight': 'bold'
      }, g);
      t.textContent = '변경 없음';
      return g;
    }

    var w = items.length * 78 + 20;
    var x0 = api.totalWidth - w - 16;
    el('rect', {
      x: x0, y: 8, width: w, height: 34, rx: 17,
      fill: 'rgba(255,255,255,0.95)', stroke: '#E5E7EB', 'stroke-width': 1
    }, g);

    items.forEach(function (it, i) {
      var th = theme[it.key];
      var cx = x0 + 18 + i * 78;
      var hit = el('g', {
        'data-kind': interactive ? 'compareStyle' : null,
        'data-part': interactive ? it.key : null,
        style: interactive ? 'cursor:pointer' : null
      }, g);
      el('circle', { cx: cx, cy: 25, r: 5.5, fill: th.fill }, hit);
      var tx = el('text', {
        x: cx + 10, y: 29, 'font-size': 12, 'font-weight': 'bold', fill: '#374151'
      }, hit);
      tx.textContent = it.label;
    });
    return g;
  }

  /* SVG 루트가 아니라 자식만 꺼내 중첩 <svg> 깨짐을 피합니다 */
  function flattenBody(svg) {
    var clone = svg.cloneNode(true);
    Array.prototype.slice.call(clone.querySelectorAll('[data-editor="hit"], [data-editor="select"]')).forEach(function (n) {
      n.parentNode.removeChild(n);
    });
    var parts = [];
    Array.prototype.forEach.call(clone.childNodes, function (node) {
      if (node.nodeType === 1) parts.push(new XMLSerializer().serializeToString(node));
    });
    return {
      width: +svg.getAttribute('data-width'),
      height: +svg.getAttribute('data-height'),
      body: parts.join('')
    };
  }

  /* 두 SVG 를 세로로 이어 하나의 SVG 로 (내보내기용) */
  function composeDual(svgBefore, svgAfter, labels) {
    labels = labels || { before: '변경 전', after: '변경 후' };
    var a = flattenBody(svgBefore);
    var b = flattenBody(svgAfter);
    var W = Math.max(a.width, b.width);
    var bannerH = 40;
    var gap = 12;
    var y0 = 0;
    var y1 = bannerH;
    var y2 = bannerH + a.height + gap;
    var y3 = y2 + bannerH;
    var totalH = y3 + b.height;

    function banner(y, text, color) {
      return (
        '<g>' +
        '<rect x="0" y="' + y + '" width="' + W + '" height="' + bannerH + '" fill="' + color + '"/>' +
        '<text x="24" y="' + (y + 26) + '" font-size="16" font-weight="bold" fill="#FFFFFF" ' +
        'font-family="Malgun Gothic, Apple SD Gothic Neo, Nanum Gothic, sans-serif">' +
        text +
        '</text></g>'
      );
    }

    var xml =
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<svg xmlns="' + NS + '" width="' + W + '" height="' + totalH + '" ' +
      'viewBox="0 0 ' + W + ' ' + totalH + '">' +
      '<rect width="100%" height="100%" fill="#FFFFFF"/>' +
      banner(y0, labels.before, '#475569') +
      '<g transform="translate(0,' + y1 + ')">' + a.body + '</g>' +
      banner(y2, labels.after, '#BE123C') +
      '<g transform="translate(0,' + y3 + ')">' + b.body + '</g>' +
      '</svg>';

    return { xml: xml, width: W, height: totalH };
  }

  /* PNG 는 캔버스에 순서대로 그려 붙입니다 (중첩 SVG 렌더 버그 회피) */
  function rasterize(svg) {
    var w = +svg.getAttribute('data-width');
    var h = +svg.getAttribute('data-height');
    var clone = svg.cloneNode(true);
    Array.prototype.slice.call(clone.querySelectorAll('[data-editor="hit"], [data-editor="select"]')).forEach(function (n) {
      n.parentNode.removeChild(n);
    });
    clone.setAttribute('xmlns', NS);
    clone.setAttribute('width', String(w));
    clone.setAttribute('height', String(h));
    var xml =
      '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(clone);
    var src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);

    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () {
        resolve({ img: img, width: w, height: h });
      };
      img.onerror = reject;
      img.src = src;
    });
  }

  function exportDualPNG(svgBefore, svgAfter, scale, filename, labels) {
    labels = labels || { before: '변경 전', after: '변경 후' };
    scale = scale || 2;
    var bannerH = 40;

    return Promise.all([rasterize(svgBefore), rasterize(svgAfter)]).then(function (parts) {
      var a = parts[0];
      var b = parts[1];
      var W = Math.max(a.width, b.width);
      var gap = 12;
      var totalH = bannerH + a.height + gap + bannerH + b.height;
      var canvas = document.createElement('canvas');
      canvas.width = Math.round(W * scale);
      canvas.height = Math.round(totalH * scale);
      var ctx = canvas.getContext('2d');
      ctx.scale(scale, scale);
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, W, totalH);

      function paintBanner(y, text, color) {
        ctx.fillStyle = color;
        ctx.fillRect(0, y, W, bannerH);
        ctx.fillStyle = '#FFFFFF';
        ctx.font = 'bold 16px "Malgun Gothic","Apple SD Gothic Neo","Nanum Gothic",sans-serif';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, 24, y + bannerH / 2);
      }

      var y = 0;
      paintBanner(y, labels.before, '#475569');
      y += bannerH;
      ctx.drawImage(a.img, 0, y, a.width, a.height);
      y += a.height + gap;
      paintBanner(y, labels.after, '#BE123C');
      y += bannerH;
      ctx.drawImage(b.img, 0, y, b.width, b.height);

      return new Promise(function (resolve) {
        canvas.toBlob(function (blob) {
          var url = URL.createObjectURL(blob);
          var link = document.createElement('a');
          link.href = url;
          link.download = filename || 'gantt.png';
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          setTimeout(function () {
            URL.revokeObjectURL(url);
          }, 1000);
          resolve();
        }, 'image/png');
      });
    });
  }

  global.GanttCompare = {
    DEFAULT_STYLE: DEFAULT_STYLE,
    resolveStyle: resolveStyle,
    ensureIds: ensureIds,
    diff: diff,
    summarize: summarize,
    affectedRows: affectedRows,
    overlayBoundsRel: overlayBoundsRel,
    comparePadMap: comparePadMap,
    draw: draw,
    drawLegend: drawLegend,
    composeDual: composeDual,
    exportDualPNG: exportDualPNG
  };
})(window);
