/* ============================================================================
 *  editor.js  ―  차트를 직접 클릭 / 드래그해서 고치는 편집기
 *    · 막대 몸통을 끌면 구간 이동, 끝점을 끌면 시작·끝 시점 변경
 *    · 점 / 마일스톤도 끌어서 시점 변경
 *    · 선택하면 오른쪽 패널에서 문구 · 색 · 시점 · 삭제
 * ========================================================================== */
(function (global) {
  'use strict';

  var ctx = null;          // { inspectorEl, getConfig, isCompareMode, onChange, pushHistory, getSnap }
  var svg = null;
  var api = null;
  var selection = null;    // { kind, row, index }
  var drag = null;

  var CAP_OPTIONS = [
    ['circle', '빈 동그라미'],
    ['filled', '꽉 찬 점'],
    ['diamond', '다이아몬드'],
    ['arrow', '화살표'],
    ['none', '없음']
  ];

  var MARKER_OPTIONS = [
    ['filled', '꽉 찬 점'],
    ['circle', '빈 동그라미'],
    ['diamond', '다이아몬드'],
    ['triangle', '삼각형'],
    ['square', '사각형'],
    ['star', '별']
  ];

  var KIND_LABEL = {
    bar: '구간',
    marker: '이벤트 점',
    deliverable: '산출물',
    milestone: '마일스톤',
    row: '행',
    legend: '범례',
    legendItem: '범례 항목',
    compareStyle: '비교 표시'
  };

  var COMPARE_KEYS = {
    add: '추가',
    shorten: '단축',
    delay: '지연',
    ghost: '기존 일정'
  };

  var LEGEND_TYPES = [
    ['line', '선 (단색)'],
    ['lineAlt', '선 (두 색 교대)'],
    ['marker', '점 / 도형'],
    ['milestone', '점선 + 삼각형'],
    ['triangle', '삼각형']
  ];

  /* ------------------------------------------------------------- DOM 도우미 */

  function h(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      }
    }
    (children || []).forEach(function (c) {
      if (c) node.appendChild(c);
    });
    return node;
  }

  function field(labelText, control, hint) {
    return h('div', { class: 'ins-field' }, [
      h('label', { class: 'ins-label', text: labelText }),
      control,
      hint ? h('span', { class: 'ins-hint', text: hint }) : null
    ]);
  }

  function select(options, value, onchange) {
    var sel = h('select', { class: 'ins-select', onchange: function () { onchange(sel.value); } });
    options.forEach(function (opt) {
      var o = h('option', { value: String(opt[0]), text: opt[1] });
      sel.appendChild(o);
    });
    sel.value = String(value);
    return sel;
  }

  function textInput(value, oninput, opts) {
    opts = opts || {};
    return h('input', {
      class: 'ins-input',
      type: opts.type || 'text',
      value: value === undefined || value === null ? '' : value,
      placeholder: opts.placeholder || '',
      onfocus: function () { ctx.pushHistory(); },
      oninput: function (e) { oninput(e.target.value); }
    });
  }

  function areaInput(value, oninput, rows) {
    var ta = h('textarea', {
      class: 'ins-area',
      rows: rows || 2,
      onfocus: function () { ctx.pushHistory(); },
      oninput: function (e) { oninput(e.target.value); }
    });
    ta.value = value === undefined || value === null ? '' : value;
    return ta;
  }

  function button(label, onclick, cls) {
    return h('button', { class: 'ins-btn ' + (cls || ''), text: label, onclick: onclick });
  }

  /* 색 후보군 스와치 + 직접 지정 */
  function colorPicker(current, onpick, allowAuto) {
    var cfg = ctx.getConfig();
    var palette = (cfg.palette && cfg.palette.length ? cfg.palette : Gantt.DEFAULT_PALETTE);
    var wrap = h('div', { class: 'swatches' }, []);

    if (allowAuto) {
      wrap.appendChild(
        h('button', {
          class: 'swatch auto' + (!current ? ' on' : ''),
          title: '자동 (하늘색 · 남색 교대)',
          text: '자동',
          onclick: function () { ctx.pushHistory(); onpick(undefined); }
        })
      );
    }

    palette.forEach(function (p) {
      var btn = h('button', {
        class: 'swatch' + (current === p.name ? ' on' : ''),
        title: p.label + ' (' + p.color + ')',
        onclick: function () { ctx.pushHistory(); onpick(p.name); }
      });
      btn.style.background = p.color;
      wrap.appendChild(btn);
    });

    var custom = h('input', {
      class: 'swatch-custom',
      type: 'color',
      title: '직접 지정',
      value: /^#/.test(current || '') ? current : '#666666',
      onchange: function (e) { ctx.pushHistory(); onpick(e.target.value); }
    });
    wrap.appendChild(custom);
    return wrap;
  }

  function nudgeButtons(value, onchange) {
    var scale = api.scale;
    var nudge = function (dir) {
      return function () {
        ctx.pushHistory();
        var step = ctx.getSnap() || 0.05;
        var t = scale.parseAbs(value) - scale.startAbs + dir * step;
        onchange(api.format(Math.max(0, Math.min(scale.total, t))));
      };
    };
    return h('div', { class: 'nudge' }, [button('◀', nudge(-1), 'tiny'), button('▶', nudge(1), 'tiny')]);
  }

  /* 연도 / 월 / 일 드롭다운 + 미세 이동 (월 단위 표시일 때) */
  function monthTimeControl(value, onchange) {
    var scale = api.scale;
    var parts = scale.splitMonth(value);
    var years = [];
    var y0 = Math.min(scale.firstYear, parts.year) - 1;
    var y1 = Math.max(scale.lastYear, parts.year) + 1;
    for (var y = y0; y <= y1; y++) years.push([y, y + '년']);

    var months = [];
    for (var m = 1; m <= 12; m++) months.push([m, m + '월']);

    var dayOptions = [[0, '1일'], [Math.round((14 / 30.4) * 1000) / 1000, '15일']];
    var fr = Math.round(parts.frac * 1000) / 1000;
    if (!dayOptions.some(function (o) { return Math.abs(o[0] - fr) < 0.002; })) {
      dayOptions.push([fr, Math.round(fr * 30.4) + 1 + '일']);
    }

    function emit() {
      onchange(scale.composeMonth(parts.year, parts.month, parts.frac));
    }

    return h('div', { class: 'time-ctrl' }, [
      select(years, parts.year, function (v) {
        ctx.pushHistory();
        parts.year = +v;
        emit();
      }),
      select(months, parts.month, function (v) {
        ctx.pushHistory();
        parts.month = +v;
        emit();
      }),
      select(dayOptions, fr, function (v) {
        ctx.pushHistory();
        parts.frac = +v;
        emit();
      }),
      nudgeButtons(value, onchange)
    ]);
  }

  /* 연도 / 분기 / 분기내 위치 드롭다운 + 미세 이동 */
  function timeControl(value, onchange) {
    if (api.unit === 'month') return monthTimeControl(value, onchange);
    var scale = api.scale;
    var parts = scale.split(value);
    var years = [];
    var y0 = Math.min(scale.firstYear, parts.year) - 1;
    var y1 = Math.max(scale.lastYear, parts.year) + 1;
    for (var y = y0; y <= y1; y++) years.push([y, y + '년']);

    var periods = ctx.getConfig().periodLabels.map(function (label, i) {
      return [i + 1, label];
    });

    var fracOptions = [[0, '시작'], [0.25, '¼'], [0.5, '중간'], [0.75, '¾']];
    var fr = Math.round(parts.frac * 100) / 100;
    if (!fracOptions.some(function (o) { return Math.abs(o[0] - fr) < 0.001; })) {
      fracOptions.push([fr, '+' + fr]);
    }

    function emit(next) {
      onchange(scale.compose(next.year, next.period, next.frac));
    }

    var ySel = select(years, parts.year, function (v) {
      ctx.pushHistory();
      parts.year = +v;
      emit(parts);
    });
    var pSel = select(periods, parts.period, function (v) {
      ctx.pushHistory();
      parts.period = +v;
      emit(parts);
    });
    var fSel = select(fracOptions, fr, function (v) {
      ctx.pushHistory();
      parts.frac = +v;
      emit(parts);
    });

    return h('div', { class: 'time-ctrl' }, [ySel, pSel, fSel, nudgeButtons(value, onchange)]);
  }

  /* --------------------------------------------------------------- 편집 동작 */

  function apply(keepInspector) {
    ctx.onChange({ keepInspector: !!keepInspector });
  }

  function snap(t) {
    var step = ctx.getSnap();
    if (!step) return Math.round(t * 100) / 100;
    return Math.round(t / step) * step;
  }

  function fmt(t) {
    return api.format(Math.max(0, Math.min(api.scale.total, t)));
  }

  function targetOf(sel) {
    var cfg = ctx.getConfig();
    if (!sel) return null;
    if (sel.kind === 'compareStyle') {
      cfg.compareStyle = cfg.compareStyle || {};
      var key = sel.part || 'add';
      if (!cfg.compareStyle[key]) {
        var def = (GanttCompare.DEFAULT_STYLE && GanttCompare.DEFAULT_STYLE[key]) || {};
        cfg.compareStyle[key] = { fill: def.fill, label: def.label };
      }
      return cfg.compareStyle[key];
    }
    if (sel.kind === 'row') return cfg.rows[sel.row];
    if (sel.kind === 'milestone') return cfg.milestones[sel.index];
    if (sel.kind === 'legend') return cfg.legend;
    if (sel.kind === 'legendItem') return cfg.legend && (cfg.legend.items || [])[sel.index];
    var row = cfg.rows[sel.row];
    if (!row) return null;
    if (sel.kind === 'bar') return (row.bars || [])[sel.index];
    if (sel.kind === 'marker') return (row.markers || [])[sel.index];
    if (sel.kind === 'deliverable') return (row.deliverables || [])[sel.index];
    return null;
  }

  function defaultLabelDy(obj, kind) {
    if (kind === 'milestone') return 0;
    if (kind === 'deliverable') return (obj.labelPos || 'below') === 'below' ? 16 : -12;
    if (kind === 'marker') return (obj.labelPos || 'above') === 'below' ? 16 : -12;
    return -12; /* bar */
  }

  function clientToSvgX(clientX) {
    var rect = svg.getBoundingClientRect();
    if (!rect.width) return 0;
    return (clientX - rect.left) * (api.totalWidth / rect.width);
  }

  function startDrag(meta, event) {
    var obj = targetOf(meta);
    if (!obj) return;
    var rect = svg.getBoundingClientRect();
    var unit = rect.width / api.totalWidth;
    var unitY = rect.height / api.totalHeight;

    drag = {
      meta: meta,
      unit: unit || 1,
      unitY: unitY || 1,
      clientX: event.clientX,
      clientY: event.clientY,
      part: meta.part,
      origT: api.timeAtX(clientToSvgX(event.clientX)),
      origStart: obj.start !== undefined ? api.scale.parse(obj.start) : null,
      origEnd: obj.end !== undefined ? api.scale.parse(obj.end) : null,
      origAt: obj.at !== undefined ? api.scale.parse(obj.at) : null,
      origCompareDy: obj.compareOffsetDy || 0,
      origLabelDy:
        meta.kind === 'milestone'
          ? obj.titleDy || 0
          : pickNum(obj.labelDy, defaultLabelDy(obj, meta.kind)),
      /* Ctrl(맥 ⌘)을 누른 채 시작하면 원본은 두고 복사본을 끌어 옮김 */
      copy: !!(event.ctrlKey || event.metaKey) && (meta.part === 'body' || meta.part === 'at'),
      /* 구간 몸통 · 점/산출물은 위아래로 끌면 다른 행·줄로 */
      canRelocate: ROW_ITEM_KEY[meta.kind] !== undefined && (meta.part === 'body' || meta.part === 'at'),
      moved: false
    };
    if (drag.copy) document.body.classList.add('drag-copy');

    document.addEventListener('mousemove', onDragMove);
    document.addEventListener('mouseup', onDragEnd);
  }

  var ROW_ITEM_KEY = { bar: 'bars', marker: 'markers', deliverable: 'deliverables' };

  function clientToSvgY(clientY) {
    var rect = svg.getBoundingClientRect();
    if (!rect.height) return 0;
    return (clientY - rect.top) * (api.totalHeight / rect.height);
  }

  /* 커서 아래의 행 · 줄 (표 밖이면 null) */
  function rowLaneAt(clientY) {
    var y = clientToSvgY(clientY);
    for (var i = 0; i < api.rowTops.length; i++) {
      var top = api.rowTops[i];
      if (y < top || y >= top + api.rowHeights[i]) continue;
      var lane = 0;
      (api.rowLaneBands && api.rowLaneBands[i] || []).forEach(function (b, k) {
        if (y >= b.top) lane = k;
      });
      return { row: i, lane: lane };
    }
    return null;
  }

  function newId(prefix) {
    return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  }

  /* 드래그 첫 움직임에서 복사본을 만들고, 이후엔 복사본을 끕니다 */
  function makeDragCopy(obj) {
    var cfg = ctx.getConfig();
    var m = drag.meta;
    var copy = JSON.parse(JSON.stringify(obj));
    if (m.kind === 'milestone') {
      copy.id = newId('ms-');
      cfg.milestones.push(copy);
      drag.meta = { kind: m.kind, row: null, index: cfg.milestones.length - 1, part: m.part };
    } else {
      var key = ROW_ITEM_KEY[m.kind];
      copy.id = newId(m.kind === 'bar' ? 'bar-' : m.kind === 'marker' ? 'mk-' : 'dv-');
      delete copy.compareHidden;
      if (m.kind === 'bar' && !copy.color) copy.color = autoColorOf(cfg.rows[m.row], m.index);
      var list = cfg.rows[m.row][key];
      list.push(copy);
      drag.meta = { kind: m.kind, row: m.row, index: list.length - 1, part: m.part };
    }
    selection = { kind: drag.meta.kind, row: drag.meta.row, index: drag.meta.index, part: m.part };
    return copy;
  }

  /* 자동 색 구간은 행을 옮기면 교대 순서가 바뀌므로 지금 보이는 색으로 고정 */
  function autoColorOf(row, index) {
    var bar = row.bars[index];
    if (!bar || bar.color) return bar ? bar.color : null;
    var cycle = ctx.getConfig().barColorCycle;
    if (!cycle || !cycle.length) cycle = ['sky', 'navy'];
    var n = 0;
    for (var j = 0; j < index; j++) if (!row.bars[j].color) n++;
    return cycle[n % cycle.length];
  }

  function freezeAutoColor(row, index) {
    var bar = row.bars[index];
    if (bar && !bar.color) bar.color = autoColorOf(row, index);
  }

  function relocateDragged(obj, target) {
    var cfg = ctx.getConfig();
    var m = drag.meta;
    var key = ROW_ITEM_KEY[m.kind];
    var from = cfg.rows[m.row];
    var dest = cfg.rows[target.row];
    if (!from || !dest) return obj;
    if (m.kind === 'bar') freezeAutoColor(from, m.index);
    from[key].splice(m.index, 1);
    dest[key] = dest[key] || [];
    setLane(obj, target.lane);
    delete obj.dy;
    dest[key].push(obj);
    drag.meta = { kind: m.kind, row: target.row, index: dest[key].length - 1, part: m.part };
    selection = { kind: m.kind, row: target.row, index: drag.meta.index, part: m.part };
    return obj;
  }

  function onDragMove(event) {
    if (!drag) return;
    var obj = targetOf(drag.meta);
    if (!obj) return;

    /* 세로 드래그: 비교 알약 / 문구 */
    if (drag.part === 'compare' || drag.part === 'label') {
      var deltaY = (event.clientY - drag.clientY) / drag.unitY;
      if (Math.abs(deltaY) < 1 && !drag.moved) return;
      if (!drag.moved) {
        ctx.pushHistory();
        drag.moved = true;
      }
      var stepped = Math.round(deltaY / 2) * 2; /* 2px 단위 */
      if (drag.part === 'compare') {
        obj.compareOffsetDy = drag.origCompareDy + stepped;
      } else if (drag.meta.kind === 'milestone') {
        var td = drag.origLabelDy + stepped;
        if (td) obj.titleDy = td;
        else delete obj.titleDy;
      } else {
        obj.labelDy = drag.origLabelDy + stepped;
      }
      apply(true);
      return;
    }

    var deltaPeriods = api.timeAtX(clientToSvgX(event.clientX)) - drag.origT;

    /* 세로로 조금 이상 움직였을 때만 행·줄 이동 (가로 드래그 중 흔들림 방지) */
    var target = null;
    if (drag.canRelocate && (drag.vertical || Math.abs(event.clientY - drag.clientY) / drag.unitY > 8)) {
      target = rowLaneAt(event.clientY);
      if (target && target.row === drag.meta.row && target.lane === laneOf(obj)) target = null;
    }

    if (Math.abs(deltaPeriods) < 0.001 && !target && !drag.moved) return;
    if (!drag.moved) {
      ctx.pushHistory();
      drag.moved = true;
      if (drag.copy) obj = makeDragCopy(obj);
    }
    if (target) {
      drag.vertical = true;
      obj = relocateDragged(obj, target);
    }

    var total = api.scale.total;

    if (drag.part === 'body' && drag.origStart !== null && drag.origEnd !== null) {
      var len = drag.origEnd - drag.origStart;
      var s = snap(drag.origStart + deltaPeriods);
      if (s < 0) s = 0;
      if (s + len > total) s = total - len;
      obj.start = fmt(s);
      obj.end = fmt(s + len);
    } else if (drag.part === 'start') {
      var ns = snap(drag.origStart + deltaPeriods);
      obj.start = fmt(Math.min(ns, drag.origEnd - 0.05));
    } else if (drag.part === 'end') {
      var ne = snap(drag.origEnd + deltaPeriods);
      obj.end = fmt(Math.max(ne, drag.origStart + 0.05));
    } else if (drag.part === 'at') {
      obj.at = fmt(snap(drag.origAt + deltaPeriods));
    } else {
      return;
    }
    apply(true);
  }

  function onDragEnd() {
    document.removeEventListener('mousemove', onDragMove);
    document.removeEventListener('mouseup', onDragEnd);
    document.body.classList.remove('drag-copy');
    var moved = drag && drag.moved;
    drag = null;
    if (moved) apply(false);
  }

  function metaFromNode(node) {
    return {
      kind: node.getAttribute('data-kind'),
      row: node.hasAttribute('data-row') ? +node.getAttribute('data-row') : null,
      index: node.hasAttribute('data-index') ? +node.getAttribute('data-index') : null,
      part: node.getAttribute('data-part'),
      lane: node.hasAttribute('data-lane') ? +node.getAttribute('data-lane') : null,
      compareType: node.getAttribute('data-compare-type')
    };
  }

  function laneOf(item) {
    var n = item ? Math.floor(+item.lane) : 0;
    return n > 0 ? n : 0;
  }

  function rowLaneCount(row) {
    if (!row) return 1;
    var n = Math.max(1, Math.floor(+row.lanes) || 1);
    ['bars', 'markers', 'deliverables'].forEach(function (key) {
      (row[key] || []).forEach(function (item) {
        n = Math.max(n, laneOf(item) + 1);
      });
    });
    return n;
  }

  function setLane(item, lane) {
    if (lane > 0) item.lane = lane;
    else delete item.lane;
  }

  /* 추가 버튼이 쓸 행·줄: 행을 눌렀으면 그 줄, 일정을 눌렀으면 그 일정의 줄 */
  function selectedRowLane() {
    if (!selection || selection.row === null || selection.row === undefined) return { row: 0, lane: 0 };
    if (selection.kind === 'row') return { row: selection.row, lane: selection.lane || 0 };
    return { row: selection.row, lane: laneOf(targetOf(selection)) };
  }

  /* 직접 넣은 dy(위아래 위치)가 서로 다르면 그 순서대로 줄을 나눕니다 */
  function dyGroups(row) {
    var values = [];
    ['bars', 'markers', 'deliverables'].forEach(function (key) {
      (row[key] || []).forEach(function (item) {
        var v = Math.round(+item.dy || 0);
        if (values.indexOf(v) < 0) values.push(v);
      });
    });
    return values.sort(function (a, b) { return a - b; });
  }

  function splitLanesByDy(row) {
    var values = dyGroups(row);
    if (values.length < 2) return;
    ctx.pushHistory();
    ['bars', 'markers', 'deliverables'].forEach(function (key) {
      (row[key] || []).forEach(function (item) {
        setLane(item, values.indexOf(Math.round(+item.dy || 0)));
        delete item.dy;
      });
    });
    row.lanes = values.length;
    delete row.height;
    apply(false);
  }

  function setRowLanes(row, n) {
    n = Math.max(1, Math.min(6, n));
    ctx.pushHistory();
    ['bars', 'markers', 'deliverables'].forEach(function (key) {
      (row[key] || []).forEach(function (item) {
        if (laneOf(item) > n - 1) setLane(item, n - 1);
      });
    });
    if (n > 1) row.lanes = n;
    else delete row.lanes;
    if (selection && selection.kind === 'row' && (selection.lane || 0) > n - 1) selection.lane = n - 1;
    apply(false);
  }

  function moveItemLane(item, rowIdx, lane) {
    var row = ctx.getConfig().rows[rowIdx];
    if (!row || lane < 0) return;
    ctx.pushHistory();
    setLane(item, lane);
    delete item.dy;
    if (lane + 1 > rowLaneCount(row)) row.lanes = lane + 1;
    apply(false);
  }

  function sameItem(a, b) {
    if (!a || !b || a.kind !== b.kind) return false;
    if (a.kind === 'milestone') return a.index === b.index;
    return a.row === b.row && a.index === b.index;
  }

  /* 겹친 시점·종점: 위에 그려진 이웃이 아니라 선택된 일정을 우선 */
  function pickHitNode(event) {
    var stack = document.elementsFromPoint
      ? document.elementsFromPoint(event.clientX, event.clientY)
      : [event.target];
    var list = [];
    var seen = {};
    var i;
    for (i = 0; i < stack.length; i++) {
      var el = stack[i];
      if (!el || !el.closest) continue;
      var node = el.closest('[data-kind]');
      if (!node) continue;
      if (svg && !svg.contains(node)) continue;
      var key =
        node.getAttribute('data-kind') +
        '|' +
        node.getAttribute('data-row') +
        '|' +
        node.getAttribute('data-index') +
        '|' +
        node.getAttribute('data-part');
      if (seen[key]) continue;
      seen[key] = true;
      list.push(node);
    }
    if (!list.length) return null;

    if (selection && selection.kind !== 'compareStyle' && selection.kind !== 'row' && selection.kind !== 'legend') {
      var endpoint = null;
      var other = null;
      for (i = 0; i < list.length; i++) {
        var m = metaFromNode(list[i]);
        if (!sameItem(m, selection)) continue;
        if (m.part === 'start' || m.part === 'end' || m.part === 'at') {
          if (!endpoint) endpoint = list[i];
        } else if (!other) {
          other = list[i];
        }
      }
      if (endpoint) return endpoint;
      if (other) return other;
    }
    return list[0];
  }

  function onMouseDown(event) {
    if (event.button !== 0) return;
    var node = pickHitNode(event);
    if (!node) {
      if (selection) {
        selection = null;
        apply(false);
      }
      return;
    }
    var meta = metaFromNode(node);

    if (meta.kind === 'compareStyle') {
      selection = { kind: 'compareStyle', part: meta.part, row: null, index: null };
      apply(false);
      event.preventDefault();
      return;
    }

    var changed =
      !selection ||
      selection.kind !== meta.kind ||
      selection.row !== meta.row ||
      selection.index !== meta.index ||
      selection.part !== meta.part;
    selection = {
      kind: meta.kind,
      row: meta.row,
      index: meta.index,
      part: meta.part,
      lane: meta.kind === 'row' ? meta.lane || 0 : null,
      compareType: meta.compareType || null
    };

    var dragParts = { start: 1, end: 1, body: 1, at: 1, compare: 1, label: 1 };
    if (meta.part && dragParts[meta.part]) startDrag(meta, event);
    apply(false);
    /* 더블클릭이 아닐 때 문구 칸으로 포커스 훔치지 않음 — 드래그 우선 */
    event.preventDefault();
  }

  function focusLabelInput() {
    var input = ctx.inspectorEl.querySelector('[data-focus="label"]');
    if (input) {
      input.focus();
      if (input.select) input.select();
    }
  }

  /* -------------------------------------------------------------- 추가 / 삭제 */

  function addBar(rowIdx, lane, startT) {
    var cfg = ctx.getConfig();
    var row = cfg.rows[rowIdx];
    if (!row) return;
    lane = lane || 0;
    ctx.pushHistory();
    row.bars = row.bars || [];
    var same = row.bars.filter(function (b) { return laneOf(b) === lane; });
    var last = same[same.length - 1];
    var s = typeof startT === 'number' ? startT : last ? api.scale.parse(last.end) : 0;
    var e = Math.min(api.scale.total, s + 2);
    if (e - s < 0.5) { s = Math.max(0, api.scale.total - 2); e = api.scale.total; }
    var bar = {
      id: 'bar-' + Date.now().toString(36),
      start: fmt(s), end: fmt(e), label: '새 구간',
      labelAt: 0.5, capStart: 'circle', capEnd: 'circle'
    };
    setLane(bar, lane);
    row.bars.push(bar);
    selection = { kind: 'bar', row: rowIdx, index: row.bars.length - 1 };
    apply(false);
  }

  function addMarker(rowIdx, kind, lane, atT) {
    var cfg = ctx.getConfig();
    var row = cfg.rows[rowIdx];
    if (!row) return;
    ctx.pushHistory();
    var mid = fmt(typeof atT === 'number' ? atT : api.scale.total / 2);
    var item;
    if (kind === 'deliverable') {
      row.deliverables = row.deliverables || [];
      item = { id: 'dv-' + Date.now().toString(36), at: mid, label: '산출물' };
      setLane(item, lane || 0);
      row.deliverables.push(item);
      selection = { kind: 'deliverable', row: rowIdx, index: row.deliverables.length - 1 };
    } else {
      row.markers = row.markers || [];
      item = {
        id: 'mk-' + Date.now().toString(36),
        at: mid, type: 'filled', color: 'navy', label: '이벤트', labelPos: 'above'
      };
      setLane(item, lane || 0);
      row.markers.push(item);
      selection = { kind: 'marker', row: rowIdx, index: row.markers.length - 1 };
    }
    apply(false);
  }

  function addMilestone(atT, rowIdx) {
    var cfg = ctx.getConfig();
    ctx.pushHistory();
    cfg.milestones = cfg.milestones || [];
    var endRow = typeof rowIdx === 'number' ? rowIdx : cfg.rows.length ? cfg.rows.length - 1 : null;
    var ms = {
      id: 'ms-' + Date.now().toString(36),
      at: fmt(typeof atT === 'number' ? atT : api.scale.total / 2),
      color: 'red',
      line: 'dashed',
      fromRow: endRow ? 0 : 'top',
      toRow: endRow,
      row: endRow,
      title: '새 마일스톤'
    };
    if (endRow === null) ms.fromRow = 'top';
    cfg.milestones.push(ms);
    selection = { kind: 'milestone', row: null, index: cfg.milestones.length - 1 };
    apply(false);
  }

  function addLegendItem() {
    var cfg = ctx.getConfig();
    ctx.pushHistory();
    cfg.legend = cfg.legend || { show: true, title: '범례', items: [] };
    cfg.legend.show = true;
    cfg.legend.items = cfg.legend.items || [];
    cfg.legend.items.push({ type: 'line', color: 'sky', label: '새 범례 항목' });
    selection = { kind: 'legendItem', row: null, index: cfg.legend.items.length - 1 };
    apply(false);
  }

  function moveLegendItem(dir) {
    var cfg = ctx.getConfig();
    if (!selection || selection.kind !== 'legendItem') return;
    var items = cfg.legend.items;
    var i = selection.index;
    var j = i + dir;
    if (j < 0 || j >= items.length) return;
    ctx.pushHistory();
    var tmp = items[i];
    items[i] = items[j];
    items[j] = tmp;
    selection = { kind: 'legendItem', row: null, index: j };
    apply(false);
  }

  function addRow() {
    var cfg = ctx.getConfig();
    ctx.pushHistory();
    cfg.rows.push({ label: '새 행', bars: [] });
    selection = { kind: 'row', row: cfg.rows.length - 1, index: null };
    apply(false);
  }

  function removeSelection() {
    var cfg = ctx.getConfig();
    if (!selection) return;
    ctx.pushHistory();
    if (selection.kind === 'row') {
      cfg.rows.splice(selection.row, 1);
      cfg.milestones.forEach(function (ms) {
        ['row', 'fromRow', 'toRow'].forEach(function (key) {
          if (typeof ms[key] !== 'number') return;
          if (ms[key] === selection.row) ms[key] = null;
          else if (ms[key] > selection.row) ms[key] -= 1;
        });
      });
    } else if (selection.kind === 'milestone') {
      cfg.milestones.splice(selection.index, 1);
    } else if (selection.kind === 'legendItem') {
      cfg.legend.items.splice(selection.index, 1);
    } else if (selection.kind === 'legend') {
      cfg.legend.show = false;
    } else {
      var row = cfg.rows[selection.row];
      if (!row) return;
      var key = selection.kind === 'bar' ? 'bars' : selection.kind === 'marker' ? 'markers' : 'deliverables';
      (row[key] || []).splice(selection.index, 1);
    }
    selection = null;
    apply(false);
  }

  function duplicateSelection() {
    var cfg = ctx.getConfig();
    if (!selection || selection.kind === 'row' || selection.kind === 'legend') return;
    ctx.pushHistory();
    if (selection.kind === 'milestone') {
      var copy = JSON.parse(JSON.stringify(cfg.milestones[selection.index]));
      cfg.milestones.splice(selection.index + 1, 0, copy);
      selection = { kind: 'milestone', row: null, index: selection.index + 1 };
    } else if (selection.kind === 'legendItem') {
      var lcopy = JSON.parse(JSON.stringify(cfg.legend.items[selection.index]));
      cfg.legend.items.splice(selection.index + 1, 0, lcopy);
      selection = { kind: 'legendItem', row: null, index: selection.index + 1 };
    } else {
      var row = cfg.rows[selection.row];
      var key = selection.kind === 'bar' ? 'bars' : selection.kind === 'marker' ? 'markers' : 'deliverables';
      var c = JSON.parse(JSON.stringify(row[key][selection.index]));
      row[key].splice(selection.index + 1, 0, c);
      selection = { kind: selection.kind, row: selection.row, index: selection.index + 1 };
    }
    apply(false);
  }

  function moveRow(dir) {
    var cfg = ctx.getConfig();
    if (!selection || selection.kind !== 'row') return;
    var i = selection.row;
    var j = i + dir;
    if (j < 0 || j >= cfg.rows.length) return;
    ctx.pushHistory();
    var tmp = cfg.rows[i];
    cfg.rows[i] = cfg.rows[j];
    cfg.rows[j] = tmp;
    cfg.milestones.forEach(function (ms) {
      ['row', 'fromRow', 'toRow'].forEach(function (key) {
        if (ms[key] === i) ms[key] = j;
        else if (ms[key] === j) ms[key] = i;
      });
    });
    selection = { kind: 'row', row: j, index: null };
    apply(false);
  }

  /* ------------------------------------------------------------- 인스펙터 UI */

  function buildInspector() {
    var host = ctx.inspectorEl;
    host.innerHTML = '';
    var cfg = ctx.getConfig();

    var headTitle = '요소 선택';
    if (selection) {
      if (selection.kind === 'compareStyle') {
        headTitle = '비교 표시 · ' + (COMPARE_KEYS[selection.part] || selection.part);
      } else {
        headTitle = (KIND_LABEL[selection.kind] || selection.kind) + ' 편집';
      }
    }
    host.appendChild(
      h('div', { class: 'ins-head' }, [
        h('strong', { text: headTitle }),
        h('span', { class: 'ins-sub', text: selection ? '' : '차트에서 클릭하세요' })
      ])
    );

    var addBox = h('div', { class: 'ins-add' }, [
      button('+ 행', addRow),
      button('+ 마일스톤', addMilestone),
      button('+ 범례', addLegendItem),
      button('+ 구간', function () { var t = selectedRowLane(); addBar(t.row, t.lane); }),
      button('+ 이벤트 점', function () { var t = selectedRowLane(); addMarker(t.row, 'marker', t.lane); }),
      button('+ 산출물', function () { var t = selectedRowLane(); addMarker(t.row, 'deliverable', t.lane); })
    ]);
    host.appendChild(addBox);

    var body = h('div', { class: 'ins-body' }, []);
    host.appendChild(body);

    if (!selection) {
      body.appendChild(buildOutline());
      return;
    }

    var obj = targetOf(selection);
    if (!obj) {
      selection = null;
      body.appendChild(buildOutline());
      return;
    }

    if (selection.kind === 'bar') buildBarFields(body, obj);
    else if (selection.kind === 'marker' || selection.kind === 'deliverable') buildMarkerFields(body, obj);
    else if (selection.kind === 'milestone') buildMilestoneFields(body, obj);
    else if (selection.kind === 'row') buildRowFields(body, obj, cfg);
    else if (selection.kind === 'legend') buildLegendFields(body, obj);
    else if (selection.kind === 'legendItem') buildLegendItemFields(body, obj);
    else if (selection.kind === 'compareStyle') buildCompareStyleFields(body, obj, selection.part);

    if (
      selection.kind !== 'row' &&
      selection.kind !== 'legend' &&
      selection.kind !== 'compareStyle'
    ) {
      body.appendChild(
        h('div', { class: 'ins-actions' }, [
          button('복제', duplicateSelection),
          button('삭제', removeSelection, 'danger')
        ])
      );
    }
  }

  function buildCompareStyleFields(body, styleObj, key) {
    body.appendChild(
      h('p', {
        class: 'ins-hint',
        text: '변경 후 차트에 표시되는 ' + (COMPARE_KEYS[key] || key) + ' 표시의 색·문구입니다. 알약을 클릭해 고를 수 있습니다.'
      })
    );

    var labelInput = textInput(styleObj.label || COMPARE_KEYS[key] || key, function (v) {
      styleObj.label = v;
      apply(true);
    });
    labelInput.setAttribute('data-focus', 'label');
    body.appendChild(field('표시 문구', labelInput));

    body.appendChild(field('색', colorPicker(styleObj.fill, function (name) {
      applyCompareFill(styleObj, name);
      apply(false);
    })));

    body.appendChild(
      h('div', { class: 'ins-actions' }, [
        button('기본값으로', function () {
          ctx.pushHistory();
          var def = GanttCompare.DEFAULT_STYLE[key] || {};
          styleObj.fill = def.fill;
          styleObj.label = def.label;
          apply(false);
        })
      ])
    );

    /* 다른 비교 표시로 바로 이동 */
    var jump = h('div', { class: 'ins-add sub' }, []);
    Object.keys(COMPARE_KEYS).forEach(function (k) {
      jump.appendChild(
        button(COMPARE_KEYS[k], function () {
          selection = { kind: 'compareStyle', part: k, row: null, index: null };
          apply(false);
        }, k === key ? 'tiny primary' : 'tiny')
      );
    });
    body.appendChild(field('다른 표시', jump));
  }

  /* 선택이 없을 때: 전체 구조를 목록으로 보여주고 여기서도 지울 수 있게 */
  function buildOutline() {
    var cfg = ctx.getConfig();
    var box = h('div', { class: 'outline' }, []);

    cfg.rows.forEach(function (row, i) {
      var head = h('div', { class: 'outline-row' }, [
        h('button', {
          class: 'outline-name',
          text: String(row.label || '(이름 없음)').replace(/\n/g, ' '),
          onclick: function () { selection = { kind: 'row', row: i, index: null }; apply(false); }
        })
      ]);
      box.appendChild(head);

      var list = h('div', { class: 'outline-list' }, []);
      (row.bars || []).forEach(function (bar, j) {
        list.appendChild(itemRow('구간', bar.label || '(문구 없음)', function () {
          selection = { kind: 'bar', row: i, index: j };
          apply(false);
        }, function () {
          ctx.pushHistory();
          row.bars.splice(j, 1);
          selection = null;
          apply(false);
        }));
      });
      (row.markers || []).forEach(function (mk, j) {
        list.appendChild(itemRow('점', mk.label || '(문구 없음)', function () {
          selection = { kind: 'marker', row: i, index: j };
          apply(false);
        }, function () {
          ctx.pushHistory();
          row.markers.splice(j, 1);
          selection = null;
          apply(false);
        }));
      });
      (row.deliverables || []).forEach(function (d, j) {
        list.appendChild(itemRow('산출물', d.label || '(문구 없음)', function () {
          selection = { kind: 'deliverable', row: i, index: j };
          apply(false);
        }, function () {
          ctx.pushHistory();
          row.deliverables.splice(j, 1);
          selection = null;
          apply(false);
        }));
      });
      if (!list.childNodes.length) list.appendChild(h('div', { class: 'outline-empty', text: '(라인 없음)' }));
      box.appendChild(list);
    });

    if (cfg.milestones.length) {
      box.appendChild(h('div', { class: 'outline-row' }, [h('span', { class: 'outline-name plain', text: '마일스톤' })]));
      var mlist = h('div', { class: 'outline-list' }, []);
      cfg.milestones.forEach(function (ms, i) {
        mlist.appendChild(itemRow(
          typeof ms.row === 'number' ? '행 안' : '표 아래',
          String(ms.title || '(문구 없음)').replace(/\n/g, ' '),
          function () { selection = { kind: 'milestone', row: null, index: i }; apply(false); },
          function () { ctx.pushHistory(); cfg.milestones.splice(i, 1); selection = null; apply(false); }
        ));
      });
      box.appendChild(mlist);
    }

    return box;
  }

  function itemRow(tag, label, onSelect, onDelete) {
    return h('div', { class: 'outline-item' }, [
      h('span', { class: 'tag', text: tag }),
      h('button', { class: 'outline-link', text: label, onclick: onSelect }),
      h('button', { class: 'outline-del', text: '×', title: '삭제', onclick: onDelete })
    ]);
  }

  /* --------------------------------------------------------------- 구간 필드 */

  function buildBarFields(body, bar) {
    var labelInput = areaInput(bar.label || '', function (v) {
      bar.label = v;
      apply(true);
    }, 2);
    labelInput.setAttribute('data-focus', 'label');
    body.appendChild(field('문구', labelInput, 'Enter 로 두 줄 입력'));

    body.appendChild(field('색', colorPicker(bar.color, function (name) {
      if (name === undefined) delete bar.color;
      else bar.color = name;
      apply(false);
    }, true)));

    body.appendChild(field('굵기', select([[2, '얇게'], [3, '기본'], [4.5, '굵게'], [6, '아주 굵게']], bar.width || 3, function (v) {
      ctx.pushHistory();
      bar.width = +v;
      apply(false);
    })));

    body.appendChild(field('시작', timeControl(bar.start, function (v) {
      bar.start = v;
      apply(false);
    })));
    body.appendChild(field('끝', timeControl(bar.end, function (v) {
      bar.end = v;
      apply(false);
    })));

    appendLaneField(body, bar);

    var barDy = bar.labelDy === undefined ? -12 : bar.labelDy;
    /* labelAt 미지정·구버전(0.4 등)은 중앙(0.5)으로 맞춤 */
    if (bar.labelAt === undefined || bar.labelAt === null) bar.labelAt = 0.5;
    else if (typeof Gantt.snapLabelAt === 'function') bar.labelAt = Gantt.snapLabelAt(bar.labelAt);
    body.appendChild(field('문구 위치', h('div', { class: 'row-inline' }, [
      select([[0.15, '왼쪽'], [0.5, '중앙'], [0.85, '오른쪽']], bar.labelAt, function (v) {
        ctx.pushHistory();
        bar.labelAt = +v;
        apply(false);
      }),
      button('▲', function () {
        ctx.pushHistory();
        bar.labelDy = (bar.labelDy === undefined ? -12 : bar.labelDy) - 4;
        apply(false);
      }, 'tiny'),
      h('span', { class: 'ins-val', text: barDy + 'px' }),
      button('▼', function () {
        ctx.pushHistory();
        bar.labelDy = (bar.labelDy === undefined ? -12 : bar.labelDy) + 4;
        apply(false);
      }, 'tiny')
    ]), '문구를 드래그·↑↓로 이동 · 멀면 점선 · 행 높이 자동'));

    body.appendChild(field('끝 모양', h('div', { class: 'row-inline' }, [
      select(CAP_OPTIONS, bar.capStart || 'circle', function (v) { ctx.pushHistory(); bar.capStart = v; apply(false); }),
      select(CAP_OPTIONS, bar.capEnd || 'circle', function (v) { ctx.pushHistory(); bar.capEnd = v; apply(false); })
    ]), '시작 / 끝'));

    appendCompareOffsetField(body, bar);
  }

  /* ------------------------------------------------------- 점 / 산출물 필드 */

  function buildMarkerFields(body, mk) {
    var isDeliv = selection.kind === 'deliverable';
    var labelInput = areaInput(mk.label || '', function (v) {
      mk.label = v;
      apply(true);
    }, 2);
    labelInput.setAttribute('data-focus', 'label');
    body.appendChild(field('문구', labelInput, 'Enter 로 두 줄 입력'));

    body.appendChild(field('모양', select(MARKER_OPTIONS, mk.type || (isDeliv ? 'diamond' : 'filled'), function (v) {
      ctx.pushHistory();
      mk.type = v;
      apply(false);
    })));

    body.appendChild(field('색', colorPicker(mk.color || (isDeliv ? 'green' : 'navy'), function (name) {
      mk.color = name;
      apply(false);
    })));

    body.appendChild(field('시점', timeControl(mk.at, function (v) {
      mk.at = v;
      apply(false);
    })));

    appendLaneField(body, mk);

    var mkBase = (mk.labelPos || (isDeliv ? 'below' : 'above')) === 'below' ? 16 : -12;
    var mkDy = pickNum(mk.labelDy, mkBase);
    body.appendChild(field('문구 위치', h('div', { class: 'row-inline' }, [
      select([['above', '위'], ['below', '아래']], mk.labelPos || (isDeliv ? 'below' : 'above'), function (v) {
        ctx.pushHistory();
        mk.labelPos = v;
        /* 기본 간격으로 되돌린 뒤 위/아래만 바꿉니다 (초기 위치와 동일) */
        if (v === 'below') mk.labelDy = 16;
        else delete mk.labelDy;
        apply(false);
      }),
      button('▲', function () {
        ctx.pushHistory();
        var base = mk.labelPos === 'below' ? 16 : -12;
        mk.labelDy = pickNum(mk.labelDy, base) - 4;
        apply(false);
      }, 'tiny'),
      h('span', { class: 'ins-val', text: mkDy + 'px' }),
      button('▼', function () {
        ctx.pushHistory();
        var base = mk.labelPos === 'below' ? 16 : -12;
        mk.labelDy = pickNum(mk.labelDy, base) + 4;
        apply(false);
      }, 'tiny')
    ]), '멀어지면 점선으로 연결 · 행 높이 자동'));

    body.appendChild(field('크기', select([[4, '작게'], [5.5, '기본'], [7, '크게']], mk.size || (isDeliv ? 4.6 : 5.5), function (v) {
      ctx.pushHistory();
      mk.size = +v;
      apply(false);
    })));

    appendCompareOffsetField(body, mk);
  }

  /* 한 행 안에서 몇 번째 줄에 둘지 (마지막 항목은 새 줄 만들기) */
  function appendLaneField(body, item) {
    var rowIdx = selection.row;
    var row = ctx.getConfig().rows[rowIdx];
    if (!row) return;
    var n = rowLaneCount(row);
    var cur = laneOf(item);
    var opts = [];
    for (var k = 0; k < n; k++) opts.push([k, (k + 1) + '줄']);
    opts.push([n, (n + 1) + '줄 (새 줄)']);
    body.appendChild(field('줄', h('div', { class: 'row-inline' }, [
      select(opts, cur, function (v) { moveItemLane(item, rowIdx, +v); }),
      button('▲', function () { if (cur > 0) moveItemLane(item, rowIdx, cur - 1); }, 'tiny'),
      button('▼', function () { moveItemLane(item, rowIdx, cur + 1); }, 'tiny')
    ]), n > 1 ? '한 행 안 ' + n + '줄 중 ' + (cur + 1) + '번째 · Alt+↑↓ 로도 이동' : '새 줄을 고르면 이 행이 두 줄이 됩니다'));
  }

  function appendCompareOffsetField(body, item) {
    var compareOn = ctx.isCompareMode && ctx.isCompareMode();
    var has = item.compareOffsetDy !== undefined && item.compareOffsetDy !== null;
    var hidden = !!item.compareHidden;
    if (!compareOn && !has && !hidden) return;

    body.appendChild(
      field(
        '비교 표시',
        h('div', { class: 'row-inline' }, [
          button(hidden ? '표시하기' : '숨기기', function () {
            ctx.pushHistory();
            if (item.compareHidden) delete item.compareHidden;
            else item.compareHidden = true;
            apply(false);
          }, hidden ? 'tiny primary' : 'tiny danger')
        ]),
        hidden
          ? '이 일정의 단축·지연·추가 마커가 숨겨져 있습니다'
          : '이 일정만 단축·지연·추가 마커를 숨깁니다'
      )
    );

    if (hidden) return;

    var v = item.compareOffsetDy || 0;
    body.appendChild(
      field(
        '비교 표시 높이',
        h('div', { class: 'row-inline' }, [
          button('▲ 가깝게', function () {
            ctx.pushHistory();
            item.compareOffsetDy = (item.compareOffsetDy || 0) - 6;
            apply(false);
          }, 'tiny'),
          h('span', { class: 'ins-val', text: v + 'px' }),
          button('▼ 멀리', function () {
            ctx.pushHistory();
            item.compareOffsetDy = (item.compareOffsetDy || 0) + 6;
            apply(false);
          }, 'tiny'),
          button('초기화', function () {
            ctx.pushHistory();
            delete item.compareOffsetDy;
            apply(false);
          }, 'tiny')
        ]),
        '알약을 위아래로 드래그하거나 ↑↓ 키로도 조절할 수 있습니다'
      )
    );

    if (selection && selection.part === 'compare' && selection.compareType) {
      var key = selection.compareType;
      var styleObj = targetOf({ kind: 'compareStyle', part: key });
      var typeName = COMPARE_KEYS[key] || key;
      body.appendChild(
        field(
          typeName + ' 색',
          colorPicker(styleObj.fill, function (name) {
            applyCompareFill(styleObj, name);
            apply(false);
          }),
          '같은 종류의 알약·화살표에 모두 적용됩니다'
        )
      );
    }
  }

  function applyCompareFill(styleObj, name) {
    var cfg = ctx.getConfig();
    var hex = name;
    if (cfg.palette) {
      cfg.palette.forEach(function (p) {
        if (p.name === name) hex = p.color;
      });
    }
    styleObj.fill = hex || name;
  }

  function pickNum(v, d) {
    return v === undefined || v === null ? d : v;
  }

  /* ---------------------------------------------------------- 마일스톤 필드 */

  function buildMilestoneFields(body, ms) {
    var cfg = ctx.getConfig();

    var titleArea = areaInput(ms.title || '', function (v) {
      ms.title = v;
      apply(true);
    }, 2);
    titleArea.setAttribute('data-focus', 'label');
    body.appendChild(field('문구', titleArea, '줄바꿈 = 그대로 두 줄'));

    body.appendChild(field('세부 목록', areaInput((ms.items || []).join('\n'), function (v) {
      var arr = v.split('\n').filter(function (s) { return s.trim() !== ''; });
      if (arr.length) ms.items = arr;
      else delete ms.items;
      apply(true);
    }, 3), '한 줄에 하나 (• 자동)'));

    var titleDy = ms.titleDy || 0;
    body.appendChild(field('문구 높이', h('div', { class: 'row-inline' }, [
      button('▲', function () {
        ctx.pushHistory();
        ms.titleDy = (ms.titleDy || 0) - 4;
        if (!ms.titleDy) delete ms.titleDy;
        apply(false);
      }, 'tiny'),
      h('span', { class: 'ins-val', text: titleDy + 'px' }),
      button('▼', function () {
        ctx.pushHistory();
        ms.titleDy = (ms.titleDy || 0) + 4;
        apply(false);
      }, 'tiny'),
      button('초기화', function () {
        ctx.pushHistory();
        delete ms.titleDy;
        apply(false);
      }, 'tiny')
    ]), '드래그·↑↓로 삼각형 위/아래로 · 멀면 점선 · 행 높이 자동'));

    body.appendChild(field('색', colorPicker(ms.color || 'red', function (name) {
      ms.color = name;
      apply(false);
    })));

    body.appendChild(field('시점', timeControl(ms.at, function (v) {
      ms.at = v;
      apply(false);
    })));

    /* 여러 줄 행이면 행 옆에 줄 고르기 (auto: 그 시점의 일정이 있는 줄) */
    function laneSelect(rowIdx, value, withAuto, onpick) {
      var row = typeof rowIdx === 'number' ? cfg.rows[rowIdx] : null;
      var n = rowLaneCount(row);
      if (!row || n < 2) return null;
      var opts = withAuto ? [['auto', '자동 줄']] : [];
      for (var k = 0; k < n; k++) opts.push([k, (k + 1) + '줄']);
      var cur = typeof value === 'number' ? Math.min(value, n - 1) : withAuto ? 'auto' : 0;
      return select(opts, cur, function (v) {
        ctx.pushHistory();
        onpick(v === 'auto' ? undefined : +v);
        apply(false);
      });
    }

    function setOrDelete(key, v) {
      if (v === undefined || (key === 'lane' && v === 0)) delete ms[key];
      else ms[key] = v;
    }

    var rowOptions = cfg.rows.map(function (r, i) {
      return [i, rowName(r, i) + ' 안'];
    });
    rowOptions.push(['null', '표 아래']);
    var rowSel = select(rowOptions, typeof ms.row === 'number' ? ms.row : 'null', function (v) {
      ctx.pushHistory();
      delete ms.lane;
      if (v === 'null') {
        ms.row = null;
      } else {
        ms.row = +v;
        /* 표시 위치를 바꾸면 점선 끝도 그 행에 맞춥니다 (직접 고친 적 없으면) */
        if (ms.toRow === undefined || typeof ms.toRow === 'number') {
          ms.toRow = ms.row;
          delete ms.toLane;
        }
      }
      apply(false);
    });
    var rowLaneSel = laneSelect(ms.row, ms.lane || 0, false, function (v) { setOrDelete('lane', v); });
    body.appendChild(field('표시 위치', h('div', { class: 'row-inline' }, [rowSel, rowLaneSel]),
      rowLaneSel ? '삼각형 · 문구가 놓이는 행과 줄' : '삼각형 · 문구가 놓이는 행'));

    var fromOptions = [['none', '없음 (점선 숨김)'], ['top', '표 맨 위']].concat(
      cfg.rows.map(function (r, i) {
        return [i, rowName(r, i) + ' 부터'];
      })
    );
    var fromValue = ms.fromRow === null || ms.fromRow === undefined ? 'none' : ms.fromRow;
    var fromSel = select(fromOptions, fromValue, function (v) {
      ctx.pushHistory();
      delete ms.fromLane;
      if (v === 'none') {
        ms.fromRow = null;
        ms.line = 'none';
      } else if (v === 'top') {
        ms.fromRow = 'top';
        if (ms.line === 'none') ms.line = 'dashed';
      } else {
        ms.fromRow = +v;
        if (ms.line === 'none') ms.line = 'dashed';
      }
      apply(false);
    });
    var fromLaneSel = laneSelect(ms.fromRow, ms.fromLane, true, function (v) { setOrDelete('fromLane', v); });
    body.appendChild(field('점선 시작', h('div', { class: 'row-inline' }, [fromSel, fromLaneSel]),
      fromLaneSel ? '여러 줄 행: 어느 줄에서 시작할지 · 자동 = 그 시점을 지나는 일정의 줄' : null));

    var toOptions = [['auto', '표시 위치(삼각형)까지']].concat(
      cfg.rows.map(function (r, i) {
        return [i, rowName(r, i) + ' 까지'];
      })
    );
    toOptions.push(['bottom', '표 아래까지']);
    var toValue = typeof ms.toRow === 'number' ? ms.toRow : ms.toRow === 'bottom' ? 'bottom' : 'auto';
    var toSel = select(toOptions, toValue, function (v) {
      ctx.pushHistory();
      delete ms.toLane;
      if (v === 'auto') delete ms.toRow;
      else if (v === 'bottom') ms.toRow = 'bottom';
      else {
        ms.toRow = +v;
        /* 끝 행을 지정하면 삼각형도 그 행 안에 두어 1행→2행 마일스톤이 자연스럽게 보이게 */
        if (typeof ms.row === 'number' || ms.row === null || ms.row === undefined) {
          ms.row = ms.toRow;
          delete ms.lane;
        }
      }
      apply(false);
    });
    /* 끝 행 = 삼각형 행이면 삼각형까지 가므로 줄은 「표시 위치」에서 고름 */
    var toLaneSel = typeof ms.toRow === 'number' && ms.toRow !== ms.row
      ? laneSelect(ms.toRow, ms.toLane, true, function (v) { setOrDelete('toLane', v); })
      : null;
    body.appendChild(field('점선 끝', h('div', { class: 'row-inline' }, [toSel, toLaneSel]),
      '예: 시작=비행시험, 끝=상황인지 → 1행에서 2행으로'));

    body.appendChild(field('점선 모양', select([['dashed', '점선'], ['solid', '실선'], ['none', '없음']], ms.line || 'dashed', function (v) {
      ctx.pushHistory();
      ms.line = v;
      if (v === 'none') ms.fromRow = null;
      else if (ms.fromRow === null || ms.fromRow === undefined) ms.fromRow = 0;
      apply(false);
    }), '계약·행정(하늘색)도 점선 가능'));

    body.appendChild(field('삼각형', select([['true', '표시'], ['false', '숨김']], String(ms.triangle !== false), function (v) {
      ctx.pushHistory();
      ms.triangle = v === 'true';
      apply(false);
    })));

    appendCompareOffsetField(body, ms);
  }

  function rowName(row, i) {
    return String(row.label || '행 ' + (i + 1)).replace(/\n/g, ' ');
  }

  /* -------------------------------------------------------------- 범례 필드 */

  function buildLegendFields(body, legend) {
    var titleInput = textInput(legend.title || '', function (v) {
      legend.title = v;
      apply(true);
    });
    titleInput.setAttribute('data-focus', 'label');
    body.appendChild(field('범례 제목', titleInput, '비우면 제목 없음'));

    body.appendChild(field('표시', select([['true', '표시'], ['false', '숨김']], String(legend.show !== false), function (v) {
      ctx.pushHistory();
      legend.show = v === 'true';
      apply(false);
    })));

    body.appendChild(h('div', { class: 'ins-add sub' }, [button('+ 범례 항목', addLegendItem)]));

    var list = h('div', { class: 'outline-list' }, []);
    (legend.items || []).forEach(function (item, i) {
      list.appendChild(itemRow('항목', item.label || '(문구 없음)', function () {
        selection = { kind: 'legendItem', row: null, index: i };
        apply(false);
      }, function () {
        ctx.pushHistory();
        legend.items.splice(i, 1);
        apply(false);
      }));
    });
    if (!list.childNodes.length) list.appendChild(h('div', { class: 'outline-empty', text: '(항목 없음)' }));
    body.appendChild(list);
  }

  function buildLegendItemFields(body, item) {
    var labelInput = textInput(item.label || '', function (v) {
      item.label = v;
      apply(true);
    });
    labelInput.setAttribute('data-focus', 'label');
    body.appendChild(field('문구', labelInput));

    body.appendChild(field('모양', select(LEGEND_TYPES, item.type || 'line', function (v) {
      ctx.pushHistory();
      item.type = v;
      if (v === 'lineAlt' && !item.colors) item.colors = ['sky', 'navy'];
      apply(false);
    })));

    if (item.type === 'marker') {
      body.appendChild(field('점 모양', select(MARKER_OPTIONS, item.marker || 'filled', function (v) {
        ctx.pushHistory();
        item.marker = v;
        apply(false);
      })));
    }

    if (item.type === 'lineAlt') {
      var pair = item.colors && item.colors.length ? item.colors : ['sky', 'navy'];
      body.appendChild(field('첫 번째 색', colorPicker(pair[0], function (name) {
        item.colors = [name, pair[1] || 'navy'];
        apply(false);
      })));
      body.appendChild(field('두 번째 색', colorPicker(pair[1] || 'navy', function (name) {
        item.colors = [pair[0], name];
        apply(false);
      })));
    } else {
      body.appendChild(field('색', colorPicker(item.color || 'sky', function (name) {
        item.color = name;
        apply(false);
      })));
    }

    body.appendChild(field('순서', h('div', { class: 'row-inline' }, [
      button('◀ 앞으로', function () { moveLegendItem(-1); }, 'tiny'),
      button('뒤로 ▶', function () { moveLegendItem(1); }, 'tiny')
    ])));
  }

  /* ---------------------------------------------------------------- 행 필드 */

  function buildRowFields(body, row, cfg) {
    var nameArea = areaInput(row.label || '', function (v) {
      row.label = v;
      apply(true);
    }, 2);
    nameArea.setAttribute('data-focus', 'label');
    body.appendChild(field('행 이름', nameArea, '줄바꿈 = 두 줄'));

    var currentH = api && api.rowHeights && api.rowHeights[selection.row] != null
      ? Math.round(api.rowHeights[selection.row])
      : '';
    var isAuto = row.height === undefined || row.height === null || row.height === '';

    function bumpHeight(delta) {
      ctx.pushHistory();
      var shown = currentH || 86;
      if (isAuto) {
        if (delta < 0) return;
        row.height = shown + delta;
      } else {
        row.height = Math.max(40, +row.height + delta);
      }
      apply(false);
    }

    body.appendChild(field('행 높이', h('div', { class: 'row-inline' }, [
      button('−', function () { bumpHeight(-8); }, 'tiny'),
      textInput(isAuto ? '' : row.height, function (v) {
        if (v === '') delete row.height;
        else row.height = Math.max(40, +v || 0);
        apply(true);
      }, { type: 'number', placeholder: '자동' + (currentH ? ' ' + currentH : '') }),
      button('+', function () { bumpHeight(8); }, 'tiny'),
      button('자동', function () {
        ctx.pushHistory();
        delete row.height;
        apply(false);
      }, isAuto ? 'tiny primary' : 'tiny')
    ]), isAuto
      ? '내용에 맞춰 위·아래 여백을 맞춥니다' + (currentH ? ' (지금 ' + currentH + 'px)' : '')
      : '수동 ' + row.height + 'px · 늘리면 내용이 가운데로 옵니다'));

    body.appendChild(field('막대 위치', h('div', { class: 'row-inline' }, [
      button('▲', function () {
        ctx.pushHistory();
        row.barDy = pickNum(row.barDy, 0) - 4;
        delete row.barOffset;
        delete row.barBaselineRatio;
        apply(false);
      }, 'tiny'),
      button('▼', function () {
        ctx.pushHistory();
        row.barDy = pickNum(row.barDy, 0) + 4;
        delete row.barOffset;
        delete row.barBaselineRatio;
        apply(false);
      }, 'tiny'),
      button('초기화', function () {
        ctx.pushHistory();
        delete row.barDy;
        delete row.barOffset;
        delete row.barBaselineRatio;
        apply(false);
      }, 'tiny')
    ]), '행을 늘리면 내용이 가운데로 옵니다'));

    var lanes = rowLaneCount(row);
    var curLane = Math.min(selection.lane || 0, lanes - 1);
    body.appendChild(field('줄 수', h('div', { class: 'row-inline' }, [
      button('−', function () { setRowLanes(row, lanes - 1); }, 'tiny'),
      h('span', { class: 'ins-val', text: lanes + '줄' }),
      button('+', function () { setRowLanes(row, lanes + 1); }, 'tiny')
    ]), lanes > 1
      ? '한 행에 구간을 ' + lanes + '줄로 쌓습니다 · 줄 간격은 내용에 맞춰 자동'
      : '+ 를 누르면 한 행에 구간을 두 줄 이상 넣을 수 있습니다'));

    if (lanes === 1 && dyGroups(row).length > 1) {
      body.appendChild(field('줄 정리', button('위아래 위치(dy)대로 줄 나누기', function () {
        splitLanesByDy(row);
      }, 'tiny'), '직접 dy 를 넣어 두 줄처럼 만든 행을 줄 ' + dyGroups(row).length + '개로 바꿉니다'));
    }

    var rowIdx = selection.row;
    for (var lk = 0; lk < lanes; lk++) {
      (function (lane) {
        var btns = [
          button('+ 구간', function () { addBar(rowIdx, lane); }),
          button('+ 이벤트 점', function () { addMarker(rowIdx, 'marker', lane); }),
          button('+ 산출물', function () { addMarker(rowIdx, 'deliverable', lane); })
        ];
        if (lanes > 1) {
          btns.unshift(h('button', {
            class: 'ins-btn tiny lane-tag' + (lane === curLane ? ' primary' : ''),
            text: (lane + 1) + '줄',
            title: '이 줄 선택',
            onclick: function () {
              selection = { kind: 'row', row: rowIdx, index: null, lane: lane };
              apply(false);
            }
          }));
        }
        body.appendChild(h('div', { class: 'ins-add sub' }, btns));
      })(lk);
    }

    function tagOf(kind, item) {
      return lanes > 1 ? kind + ' ' + (laneOf(item) + 1) + '줄' : kind;
    }

    var list = h('div', { class: 'outline-list' }, []);
    (row.bars || []).forEach(function (bar, j) {
      list.appendChild(itemRow(tagOf('구간', bar), bar.label || '(문구 없음)', function () {
        selection = { kind: 'bar', row: selection.row, index: j };
        apply(false);
      }, function () {
        ctx.pushHistory();
        row.bars.splice(j, 1);
        apply(false);
      }));
    });
    (row.markers || []).forEach(function (mk, j) {
      list.appendChild(itemRow(tagOf('점', mk), mk.label || '(문구 없음)', function () {
        selection = { kind: 'marker', row: selection.row, index: j };
        apply(false);
      }, function () {
        ctx.pushHistory();
        row.markers.splice(j, 1);
        apply(false);
      }));
    });
    (row.deliverables || []).forEach(function (d, j) {
      list.appendChild(itemRow(tagOf('산출물', d), d.label || '(문구 없음)', function () {
        selection = { kind: 'deliverable', row: selection.row, index: j };
        apply(false);
      }, function () {
        ctx.pushHistory();
        row.deliverables.splice(j, 1);
        apply(false);
      }));
    });
    if (!list.childNodes.length) list.appendChild(h('div', { class: 'outline-empty', text: '(라인 없음)' }));
    body.appendChild(list);

    body.appendChild(
      h('div', { class: 'ins-actions' }, [
        button('▲ 위로', function () { moveRow(-1); }),
        button('▼ 아래로', function () { moveRow(1); }),
        button('행 삭제', removeSelection, 'danger')
      ])
    );
  }

  /* ------------------------------------------------------ 복사 / 붙여넣기 */

  var CLIP_KEY = 'gantt-clipboard-v1';
  var CLIP_NAME = { bar: '구간', marker: '이벤트 점', deliverable: '산출물', milestone: '마일스톤', legendItem: '범례 항목', row: '행' };
  var toastEl = null;
  var toastTimer = null;

  function toast(text) {
    if (!toastEl) {
      toastEl = h('div', { class: 'editor-toast' });
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = text;
    toastEl.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('on'); }, 1600);
  }

  /* 다른 탭에서도 붙여넣을 수 있게 localStorage 에 둡니다 */
  function readClip() {
    try {
      return JSON.parse(localStorage.getItem(CLIP_KEY) || 'null');
    } catch (e) {
      return null;
    }
  }

  function writeClip(clip) {
    try {
      localStorage.setItem(CLIP_KEY, JSON.stringify(clip));
    } catch (e) { /* 저장 공간이 없으면 붙여넣기만 못 함 */ }
  }

  function clone(o) {
    return JSON.parse(JSON.stringify(o));
  }

  function stripIds(row) {
    delete row.id;
    ['bars', 'markers', 'deliverables'].forEach(function (key) {
      (row[key] || []).forEach(function (item) { delete item.id; });
    });
  }

  function copySelection(cut) {
    if (!selection) return false;
    var kind = selection.kind;
    if (!CLIP_NAME[kind]) return false;
    var obj = targetOf(selection);
    if (!obj) return false;
    var item = clone(obj);
    var cfg = ctx.getConfig();
    if (kind === 'bar' && !item.color) item.color = autoColorOf(cfg.rows[selection.row], selection.index);
    writeClip({ kind: kind, item: item, row: selection.row, lane: kind === 'row' ? 0 : laneOf(obj) });
    if (cut) {
      if (kind === 'row' && cfg.rows.length <= 1) {
        toast('마지막 행은 잘라낼 수 없습니다');
        return true;
      }
      removeSelection();
      toast(CLIP_NAME[kind] + '을(를) 잘라냈습니다 · Ctrl+V 로 붙여넣기');
    } else {
      toast(CLIP_NAME[kind] + '을(를) 복사했습니다 · Ctrl+V 로 붙여넣기');
    }
    return true;
  }

  /*
   * 키보드 붙여넣기 위치: 다른 행·줄이면 원본과 같은 시점, 같은 행·줄이면 원본 바로 뒤.
   * 같은 곳에 또 붙이면 직전 붙여넣기 바로 뒤로 이어집니다.
   */
  function nextPasteStart(clip, target, orig, len) {
    var step = len || ctx.getSnap() || 0.25;
    var last = clip.last;
    var s;
    if (last && last.row === target.row && last.lane === target.lane) s = last.s + step;
    else if (target.row === clip.row && target.lane === (clip.lane || 0)) s = orig + step;
    else s = orig;
    s = Math.max(0, Math.min(s, api.scale.total - len));
    clip.last = { row: target.row, lane: target.lane, s: s };
    writeClip(clip);
    return s;
  }

  /* where: { row, lane, t } — 우클릭 「여기에 붙여넣기」는 그 자리, 키보드는 선택한 행/줄 */
  function pasteClipboard(where) {
    var clip = readClip();
    if (!clip || !clip.item || !api) return false;
    var cfg = ctx.getConfig();
    var kind = clip.kind;
    var item = clone(clip.item);
    var hasT = where && typeof where.t === 'number';

    if (kind === 'row') {
      var at = selection && typeof selection.row === 'number' ? selection.row + 1 : cfg.rows.length;
      if (where && typeof where.row === 'number') at = where.row + 1;
      ctx.pushHistory();
      stripIds(item);
      cfg.rows.splice(at, 0, item);
      shiftMilestoneRows(at, 1);
      selection = { kind: 'row', row: at, index: null, lane: 0 };
      apply(false);
      toast('행을 붙여넣었습니다');
      return true;
    }

    if (kind === 'milestone') {
      ctx.pushHistory();
      item.id = newId('ms-');
      var a = hasT ? where.t : nextPasteStart(clip, { row: clip.row, lane: clip.lane || 0 }, api.scale.parse(item.at), 0);
      item.at = fmt(a);
      cfg.milestones.push(item);
      selection = { kind: 'milestone', row: null, index: cfg.milestones.length - 1 };
      apply(false);
      toast('마일스톤을 붙여넣었습니다');
      return true;
    }

    if (kind === 'legendItem') {
      ctx.pushHistory();
      cfg.legend = cfg.legend || { show: true, title: '범례', items: [] };
      cfg.legend.show = true;
      cfg.legend.items = cfg.legend.items || [];
      var li = selection && selection.kind === 'legendItem' ? selection.index + 1 : cfg.legend.items.length;
      cfg.legend.items.splice(li, 0, item);
      selection = { kind: 'legendItem', row: null, index: li };
      apply(false);
      toast('범례 항목을 붙여넣었습니다');
      return true;
    }

    var key = ROW_ITEM_KEY[kind];
    if (!key) return false;
    var target;
    if (where && typeof where.row === 'number') target = { row: where.row, lane: where.lane || 0 };
    else if (selection && typeof selection.row === 'number' && cfg.rows[selection.row]) target = selectedRowLane();
    else target = { row: cfg.rows[clip.row] ? clip.row : 0, lane: clip.lane || 0 };
    var row = cfg.rows[target.row];
    if (!row) return false;

    ctx.pushHistory();
    row[key] = row[key] || [];
    item.id = newId(kind === 'bar' ? 'bar-' : kind === 'marker' ? 'mk-' : 'dv-');
    delete item.compareHidden;
    if (target.row !== clip.row || target.lane !== (clip.lane || 0)) delete item.dy;
    setLane(item, target.lane);
    if (kind === 'bar') {
      var len = api.scale.parse(item.end) - api.scale.parse(item.start);
      var s = hasT ? where.t : nextPasteStart(clip, target, api.scale.parse(item.start), len);
      s = Math.max(0, Math.min(s, api.scale.total - len));
      item.start = fmt(s);
      item.end = fmt(s + len);
    } else {
      var t0 = hasT ? where.t : nextPasteStart(clip, target, api.scale.parse(item.at), 0);
      item.at = fmt(t0);
    }
    row[key].push(item);
    selection = { kind: kind, row: target.row, index: row[key].length - 1 };
    apply(false);
    toast(CLIP_NAME[kind] + '을(를) 붙여넣었습니다');
    return true;
  }

  function clipLabel() {
    var clip = readClip();
    return clip && CLIP_NAME[clip.kind] ? CLIP_NAME[clip.kind] : null;
  }

  /* -------------------------------------------------------------- 우클릭 메뉴 */

  var menuEl = null;
  var menuAt = null;   /* { x, y, t } — 모양 바꾸기 뒤 같은 자리에 다시 열 때 */

  function closeMenu() {
    if (menuEl && menuEl.parentNode) menuEl.parentNode.removeChild(menuEl);
    menuEl = null;
  }

  /* 구조를 바꾸는 동작: 메뉴를 닫고 실행 */
  function menuItem(label, fn, opts) {
    opts = opts || {};
    return h('button', {
      class: 'cm-item' + (opts.danger ? ' danger' : ''),
      disabled: opts.disabled ? 'disabled' : null,
      onclick: function () {
        closeMenu();
        fn();
      }
    }, [h('span', { text: label }), opts.key ? h('span', { class: 'cm-key', text: opts.key }) : null]);
  }

  /* 모양만 바꾸는 동작: 실행 후 같은 자리에 메뉴를 다시 그려 상태 표시 */
  function keepOpen(fn) {
    return function () {
      fn();
      if (menuAt) showMenu(menuAt.x, menuAt.y, menuAt.t);
    };
  }

  function menuSep() {
    return h('div', { class: 'cm-sep' });
  }

  function menuTitle(text) {
    return h('div', { class: 'cm-title', text: text });
  }

  function menuRow(label, control) {
    return h('div', { class: 'cm-row' }, [h('span', { class: 'cm-label', text: label }), control]);
  }

  function menuChips(options, current, onpick) {
    return h('div', { class: 'cm-chips' }, options.map(function (opt) {
      return h('button', {
        class: 'cm-chip' + (String(opt[0]) === String(current) ? ' on' : ''),
        text: opt[1],
        onclick: keepOpen(function () {
          ctx.pushHistory();
          onpick(opt[0]);
          apply(false);
        })
      });
    }));
  }

  function menuSwatches(current, allowAuto, onpick, useHex) {
    var cfg = ctx.getConfig();
    var palette = cfg.palette && cfg.palette.length ? cfg.palette : Gantt.DEFAULT_PALETTE;
    var list = [];
    if (allowAuto) {
      list.push(h('button', {
        class: 'cm-swatch auto' + (!current ? ' on' : ''),
        title: '자동 (교대 색)',
        text: '자동',
        onclick: keepOpen(function () { ctx.pushHistory(); onpick(undefined); apply(false); })
      }));
    }
    palette.forEach(function (p) {
      var value = useHex ? p.color : p.name;
      var on = useHex ? String(current || '').toLowerCase() === p.color.toLowerCase() : current === p.name;
      var b = h('button', {
        class: 'cm-swatch' + (on ? ' on' : ''),
        title: p.label,
        onclick: keepOpen(function () { ctx.pushHistory(); onpick(value); apply(false); })
      });
      b.style.background = p.color;
      list.push(b);
    });
    return h('div', { class: 'cm-swatches' }, list);
  }

  function clickTime(clientX) {
    if (!api) return null;
    var x = clientToSvgX(clientX);
    if (x < api.plotX || x > api.plotX + api.plotW) return null;
    var t = snap(api.timeAtX(x));
    return Math.max(0, Math.min(api.scale.total, t));
  }

  function toolbarClick(id) {
    var b = document.getElementById(id);
    if (b && !b.disabled) b.click();
  }

  function shiftMilestoneRows(fromIdx, delta) {
    (ctx.getConfig().milestones || []).forEach(function (ms) {
      ['row', 'fromRow', 'toRow'].forEach(function (key) {
        if (typeof ms[key] === 'number' && ms[key] >= fromIdx) ms[key] += delta;
      });
    });
  }

  function insertRow(at) {
    var cfg = ctx.getConfig();
    ctx.pushHistory();
    cfg.rows.splice(at, 0, { label: '새 행', bars: [] });
    shiftMilestoneRows(at, 1);
    selection = { kind: 'row', row: at, index: null, lane: 0 };
    apply(false);
  }

  function duplicateRow(i) {
    var cfg = ctx.getConfig();
    var src = cfg.rows[i];
    if (!src) return;
    ctx.pushHistory();
    var copy = JSON.parse(JSON.stringify(src));
    delete copy.id;
    ['bars', 'markers', 'deliverables'].forEach(function (key) {
      (copy[key] || []).forEach(function (item) { delete item.id; });
    });
    cfg.rows.splice(i + 1, 0, copy);
    shiftMilestoneRows(i + 1, 1);
    selection = { kind: 'row', row: i + 1, index: null, lane: 0 };
    apply(false);
  }

  function splitBar(rowIdx, index, t) {
    var row = ctx.getConfig().rows[rowIdx];
    var bar = row && row.bars[index];
    if (!bar) return;
    ctx.pushHistory();
    var copy = JSON.parse(JSON.stringify(bar));
    copy.id = 'bar-' + Date.now().toString(36);
    copy.label = '새 구간';
    copy.start = fmt(t);
    bar.end = fmt(t);
    row.bars.splice(index + 1, 0, copy);
    selection = { kind: 'bar', row: rowIdx, index: index + 1 };
    apply(false);
  }

  function appendBarAfter(rowIdx, index) {
    var bar = ctx.getConfig().rows[rowIdx].bars[index];
    addBar(rowIdx, laneOf(bar), api.scale.parse(bar.end));
  }

  function canSplit(bar, t) {
    if (typeof t !== 'number') return false;
    var s = api.scale.parse(bar.start);
    var e = api.scale.parse(bar.end);
    return t > Math.min(s, e) + 0.01 && t < Math.max(s, e) - 0.01;
  }

  function laneMenu(item, rowIdx) {
    var n = rowLaneCount(ctx.getConfig().rows[rowIdx]);
    var cur = laneOf(item);
    var out = [];
    if (cur > 0) out.push(menuItem('▲ 윗줄로 (' + cur + '줄)', function () { moveItemLane(item, rowIdx, cur - 1); }, { key: 'Alt+↑' }));
    out.push(menuItem(cur + 1 < n ? '▼ 아랫줄로 (' + (cur + 2) + '줄)' : '▼ 새 줄로 (' + (cur + 2) + '줄)', function () {
      moveItemLane(item, rowIdx, cur + 1);
    }, { key: 'Alt+↓' }));
    return out;
  }

  function compareToggleItem(item) {
    if (!(ctx.isCompareMode && ctx.isCompareMode())) return null;
    return menuItem(item.compareHidden ? '비교 표시 보이기' : '비교 표시 숨기기', function () {
      ctx.pushHistory();
      if (item.compareHidden) delete item.compareHidden;
      else item.compareHidden = true;
      apply(false);
    });
  }

  function clipMenu(sel, obj, t) {
    var out = [
      menuItem('복사', function () { copySelection(false); }, { key: 'Ctrl+C' }),
      menuItem('잘라내기', function () { copySelection(true); }, { key: 'Ctrl+X' })
    ];
    var name = clipLabel();
    if (name && name !== '행') {
      var where;
      if (ROW_ITEM_KEY[sel.kind]) where = { row: sel.row, lane: laneOf(obj), t: typeof t === 'number' ? t : undefined };
      else if (sel.kind === 'milestone' && typeof t === 'number') where = { t: t };
      out.push(menuItem(name + ' 붙여넣기', function () { pasteClipboard(where); }, { key: 'Ctrl+V' }));
    }
    return out;
  }

  function itemName(text, fallback) {
    var s = String(text || fallback).replace(/\n/g, ' ');
    return s.length > 18 ? s.slice(0, 17) + '…' : s;
  }

  function buildMenuItems(t) {
    var cfg = ctx.getConfig();
    var sel = selection;
    var obj = sel ? targetOf(sel) : null;
    var atLabel = typeof t === 'number' ? ' (' + fmt(t) + ')' : '';
    var items = [];

    if (!sel || !obj) {
      var undoBtn = document.getElementById('btnUndo');
      var compareBox = document.getElementById('compareMode');
      items.push(menuTitle('차트'));
      items.push(menuItem('+ 행 추가 (맨 아래)', addRow));
      items.push(menuItem('+ 마일스톤' + atLabel, function () { addMilestone(t); }));
      items.push(menuItem('+ 범례 항목', addLegendItem));
      var emptyClip = clipLabel();
      if (emptyClip) {
        items.push(menuItem(emptyClip + ' 붙여넣기', function () {
          pasteClipboard(typeof t === 'number' && emptyClip === '마일스톤' ? { t: t } : undefined);
        }, { key: 'Ctrl+V' }));
      }
      items.push(menuSep());
      items.push(menuItem('되돌리기', function () { toolbarClick('btnUndo'); }, { key: 'Ctrl+Z', disabled: !undoBtn || undoBtn.disabled }));
      if (compareBox) {
        items.push(menuItem(compareBox.checked ? '변경 비교 끄기' : '변경 비교 켜기', function () {
          compareBox.checked = !compareBox.checked;
          compareBox.dispatchEvent(new Event('change'));
        }));
      }
      items.push(menuSep());
      items.push(menuItem('PNG 저장', function () { toolbarClick('btnPng'); }));
      items.push(menuItem('SVG 저장', function () { toolbarClick('btnSvg'); }));
      items.push(menuItem('간트 내보내기 (JSON)', function () { toolbarClick('btnExportGantt'); }));
      return items;
    }

    if (sel.kind === 'row') {
      var r = sel.row;
      var lane = sel.lane || 0;
      var n = rowLaneCount(obj);
      items.push(menuTitle('행 · ' + itemName(obj.label, '행 ' + (r + 1)) + (n > 1 ? ' · ' + (lane + 1) + '줄' : '')));
      items.push(menuItem('+ 구간 여기에' + atLabel, function () { addBar(r, lane, t === null ? undefined : t); }));
      items.push(menuItem('+ 이벤트 점' + atLabel, function () { addMarker(r, 'marker', lane, t === null ? undefined : t); }));
      items.push(menuItem('+ 산출물' + atLabel, function () { addMarker(r, 'deliverable', lane, t === null ? undefined : t); }));
      items.push(menuItem('+ 마일스톤 이 행에' + atLabel, function () { addMilestone(t === null ? undefined : t, r); }));
      var rowClip = clipLabel();
      if (rowClip) {
        items.push(menuItem((rowClip === '행' ? '아래에 행 붙여넣기' : '여기에 ' + rowClip + ' 붙여넣기' + atLabel), function () {
          pasteClipboard({ row: r, lane: lane, t: t === null ? undefined : t });
        }, { key: 'Ctrl+V' }));
      }
      items.push(menuSep());
      items.push(menuItem('줄 추가 (' + (n + 1) + '줄로)', function () { setRowLanes(obj, n + 1); }, { disabled: n >= 6 }));
      if (n > 1) items.push(menuItem('줄 줄이기 (' + (n - 1) + '줄로)', function () { setRowLanes(obj, n - 1); }));
      items.push(menuSep());
      items.push(menuItem('위에 행 삽입', function () { insertRow(r); }));
      items.push(menuItem('아래에 행 삽입', function () { insertRow(r + 1); }));
      items.push(menuItem('행 복제', function () { duplicateRow(r); }));
      items.push(menuItem('행 복사', function () { copySelection(false); }, { key: 'Ctrl+C' }));
      items.push(menuItem('행 잘라내기', function () { copySelection(true); }, { key: 'Ctrl+X', disabled: cfg.rows.length <= 1 }));
      items.push(menuItem('▲ 위로', function () { moveRow(-1); }, { disabled: r === 0 }));
      items.push(menuItem('▼ 아래로', function () { moveRow(1); }, { disabled: r >= cfg.rows.length - 1 }));
      items.push(menuSep());
      items.push(menuItem('행 이름 고치기', focusLabelInput));
      items.push(menuItem('행 삭제', removeSelection, { danger: true, key: 'Del' }));
      return items;
    }

    if (sel.kind === 'bar') {
      var bar = obj;
      items.push(menuTitle('구간 · ' + itemName(bar.label, '(문구 없음)')));
      items.push(menuSwatches(bar.color, true, function (v) {
        if (v === undefined) delete bar.color;
        else bar.color = v;
      }));
      items.push(menuRow('굵기', menuChips([[2, '얇게'], [3, '기본'], [4.5, '굵게'], [6, '아주']], bar.width || 3, function (v) { bar.width = +v; })));
      items.push(menuRow('문구', menuChips([[0.15, '왼쪽'], [0.5, '중앙'], [0.85, '오른쪽']], bar.labelAt == null ? 0.5 : bar.labelAt, function (v) { bar.labelAt = +v; })));
      items.push(menuSep());
      if (canSplit(bar, t)) items.push(menuItem('여기서 나누기' + atLabel, function () { splitBar(sel.row, sel.index, t); }));
      items.push(menuItem('뒤에 이어서 구간 추가', function () { appendBarAfter(sel.row, sel.index); }));
      laneMenu(bar, sel.row).forEach(function (it) { items.push(it); });
      items.push(menuSep());
      items.push(menuItem('문구 고치기', focusLabelInput));
      var cmpBar = compareToggleItem(bar);
      if (cmpBar) items.push(cmpBar);
      clipMenu(sel, obj, t).forEach(function (it) { items.push(it); });
      items.push(menuItem('복제', duplicateSelection, { key: 'Ctrl+D' }));
      items.push(menuItem('삭제', removeSelection, { danger: true, key: 'Del' }));
      return items;
    }

    if (sel.kind === 'marker' || sel.kind === 'deliverable') {
      var mk = obj;
      var isDeliv = sel.kind === 'deliverable';
      items.push(menuTitle((isDeliv ? '산출물' : '이벤트 점') + ' · ' + itemName(mk.label, '(문구 없음)')));
      items.push(menuSwatches(mk.color || (isDeliv ? 'green' : 'navy'), false, function (v) { mk.color = v; }));
      items.push(menuRow('모양', menuChips(
        [['filled', '●'], ['circle', '○'], ['diamond', '◆'], ['triangle', '▼'], ['square', '■'], ['star', '★']],
        mk.type || (isDeliv ? 'diamond' : 'filled'),
        function (v) { mk.type = v; }
      )));
      items.push(menuRow('문구', menuChips([['above', '위'], ['below', '아래']], mk.labelPos || (isDeliv ? 'below' : 'above'), function (v) {
        mk.labelPos = v;
        if (v === 'below') mk.labelDy = 16;
        else delete mk.labelDy;
      })));
      items.push(menuSep());
      laneMenu(mk, sel.row).forEach(function (it) { items.push(it); });
      items.push(menuItem('문구 고치기', focusLabelInput));
      var cmpMk = compareToggleItem(mk);
      if (cmpMk) items.push(cmpMk);
      clipMenu(sel, obj, t).forEach(function (it) { items.push(it); });
      items.push(menuItem('복제', duplicateSelection, { key: 'Ctrl+D' }));
      items.push(menuItem('삭제', removeSelection, { danger: true, key: 'Del' }));
      return items;
    }

    if (sel.kind === 'milestone') {
      var ms = obj;
      items.push(menuTitle('마일스톤 · ' + itemName(ms.title, '(문구 없음)')));
      items.push(menuSwatches(ms.color || 'red', false, function (v) { ms.color = v; }));
      items.push(menuRow('점선', menuChips([['dashed', '점선'], ['solid', '실선'], ['none', '없음']], ms.line || 'dashed', function (v) {
        ms.line = v;
        if (v === 'none') ms.fromRow = null;
        else if (ms.fromRow === null || ms.fromRow === undefined) ms.fromRow = 0;
      })));
      items.push(menuRow('삼각형', menuChips([['true', '표시'], ['false', '숨김']], String(ms.triangle !== false), function (v) {
        ms.triangle = v === 'true';
      })));
      if (typeof ms.fromRow === 'number' && rowLaneCount(cfg.rows[ms.fromRow]) > 1) {
        var fromN = rowLaneCount(cfg.rows[ms.fromRow]);
        var fromOpts = [['auto', '자동']];
        for (var fk = 0; fk < fromN; fk++) fromOpts.push([fk, (fk + 1) + '줄']);
        items.push(menuRow('시작 줄', menuChips(fromOpts, typeof ms.fromLane === 'number' ? ms.fromLane : 'auto', function (v) {
          if (v === 'auto') delete ms.fromLane;
          else ms.fromLane = +v;
        })));
      }
      if (typeof ms.row === 'number' && rowLaneCount(cfg.rows[ms.row]) > 1) {
        var triN = rowLaneCount(cfg.rows[ms.row]);
        var triOpts = [];
        for (var tk = 0; tk < triN; tk++) triOpts.push([tk, (tk + 1) + '줄']);
        items.push(menuRow('삼각형 줄', menuChips(triOpts, ms.lane || 0, function (v) {
          if (+v) ms.lane = +v;
          else delete ms.lane;
        })));
      }
      items.push(menuSep());
      if (typeof t === 'number' && Math.abs(t - api.scale.parse(ms.at)) > 0.01) {
        items.push(menuItem('여기로 옮기기' + atLabel, function () {
          ctx.pushHistory();
          ms.at = fmt(t);
          apply(false);
        }));
      }
      items.push(menuItem('문구 고치기', focusLabelInput));
      var cmpMs = compareToggleItem(ms);
      if (cmpMs) items.push(cmpMs);
      clipMenu(sel, obj, t).forEach(function (it) { items.push(it); });
      items.push(menuItem('복제', duplicateSelection, { key: 'Ctrl+D' }));
      items.push(menuItem('삭제', removeSelection, { danger: true, key: 'Del' }));
      return items;
    }

    if (sel.kind === 'legendItem') {
      var li = obj;
      items.push(menuTitle('범례 항목 · ' + itemName(li.label, '(문구 없음)')));
      if (li.type !== 'lineAlt') items.push(menuSwatches(li.color || 'sky', false, function (v) { li.color = v; }));
      items.push(menuItem('◀ 앞으로', function () { moveLegendItem(-1); }, { disabled: sel.index === 0 }));
      items.push(menuItem('뒤로 ▶', function () { moveLegendItem(1); }, { disabled: sel.index >= (cfg.legend.items || []).length - 1 }));
      items.push(menuSep());
      items.push(menuItem('+ 범례 항목', addLegendItem));
      items.push(menuItem('문구 고치기', focusLabelInput));
      clipMenu(sel, obj, t).forEach(function (it) { items.push(it); });
      items.push(menuItem('복제', duplicateSelection, { key: 'Ctrl+D' }));
      items.push(menuItem('삭제', removeSelection, { danger: true, key: 'Del' }));
      return items;
    }

    if (sel.kind === 'legend') {
      items.push(menuTitle('범례'));
      items.push(menuItem('+ 범례 항목', addLegendItem));
      items.push(menuItem('범례 숨기기', removeSelection, { danger: true }));
      return items;
    }

    if (sel.kind === 'compareStyle') {
      var key = sel.part || 'add';
      items.push(menuTitle('비교 표시 · ' + (COMPARE_KEYS[key] || key)));
      items.push(menuSwatches(obj.fill, false, function (v) { obj.fill = v; }, true));
      items.push(menuItem('기본 색으로', function () {
        ctx.pushHistory();
        var def = (GanttCompare.DEFAULT_STYLE && GanttCompare.DEFAULT_STYLE[key]) || {};
        obj.fill = def.fill;
        obj.label = def.label;
        apply(false);
      }));
      return items;
    }

    return items;
  }

  function showMenu(x, y, t) {
    closeMenu();
    menuAt = { x: x, y: y, t: t };
    var items = buildMenuItems(t);
    if (!items.length) return;
    menuEl = h('div', { class: 'ctx-menu', role: 'menu' }, items);
    menuEl.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    document.body.appendChild(menuEl);
    var w = menuEl.offsetWidth;
    var hh = menuEl.offsetHeight;
    var left = Math.min(x, window.innerWidth - w - 6);
    var top = y + hh > window.innerHeight - 6 ? Math.max(6, window.innerHeight - hh - 6) : y;
    menuEl.style.left = Math.max(6, left) + 'px';
    menuEl.style.top = top + 'px';
  }

  function onContextMenu(event) {
    event.preventDefault();
    var t = clickTime(event.clientX);
    var node = pickHitNode(event);
    var meta = node ? metaFromNode(node) : null;
    if (!meta) {
      selection = null;
    } else if (meta.kind === 'compareStyle') {
      selection = { kind: 'compareStyle', part: meta.part, row: null, index: null };
    } else {
      selection = {
        kind: meta.kind,
        row: meta.row,
        index: meta.index,
        part: null,
        lane: meta.kind === 'row' ? meta.lane || 0 : null,
        compareType: meta.compareType || null
      };
    }
    apply(false);
    showMenu(event.clientX, event.clientY, t);
  }

  /* ------------------------------------------------------------------- 키보드 */

  function nudgeVertical(obj, kind, part, dir, coarse) {
    var delta = dir * (coarse ? 12 : 4);
    if (part === 'compare') {
      obj.compareOffsetDy = (obj.compareOffsetDy || 0) + delta;
      return;
    }
    if (kind === 'milestone') {
      var td = (obj.titleDy || 0) + delta;
      if (td) obj.titleDy = td;
      else delete obj.titleDy;
      return;
    }
    if (kind === 'bar' || kind === 'marker' || kind === 'deliverable') {
      obj.labelDy = pickNum(obj.labelDy, defaultLabelDy(obj, kind)) + delta;
    }
  }

  function onKeyDown(event) {
    var tag = (event.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

    if ((event.ctrlKey || event.metaKey) && !event.altKey) {
      var k = (event.key || '').toLowerCase();
      if (k === 'c' || k === 'x') {
        /* 페이지 글자를 드래그로 고른 상태면 브라우저 복사를 그대로 둠 */
        if (!selection && String(window.getSelection ? window.getSelection() : '')) return;
        if (copySelection(k === 'x')) event.preventDefault();
        return;
      }
      if (k === 'v') {
        if (pasteClipboard()) event.preventDefault();
        return;
      }
      if (k === 'd') {
        if (selection && selection.kind !== 'row' && selection.kind !== 'legend' && selection.kind !== 'compareStyle') {
          duplicateSelection();
          event.preventDefault();
        }
        return;
      }
    }

    if (!selection) return;

    if (event.key === 'Delete' || event.key === 'Backspace') {
      removeSelection();
      event.preventDefault();
    } else if (event.key === 'Escape') {
      selection = null;
      apply(false);
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      var objV = targetOf(selection);
      if (!objV) return;
      if (selection.kind === 'compareStyle' || selection.kind === 'row' || selection.kind === 'legend') return;
      if (event.altKey && (selection.kind === 'bar' || selection.kind === 'marker' || selection.kind === 'deliverable')) {
        var toLane = laneOf(objV) + (event.key === 'ArrowUp' ? -1 : 1);
        if (toLane >= 0) moveItemLane(objV, selection.row, toLane);
        event.preventDefault();
        return;
      }
      ctx.pushHistory();
      nudgeVertical(
        objV,
        selection.kind,
        selection.part,
        event.key === 'ArrowUp' ? -1 : 1,
        event.shiftKey
      );
      apply(false);
      event.preventDefault();
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      var obj = targetOf(selection);
      if (!obj) return;
      var step = (ctx.getSnap() || 0.05) * (event.key === 'ArrowLeft' ? -1 : 1);
      ctx.pushHistory();
      if (obj.at !== undefined) {
        obj.at = fmt(api.scale.parse(obj.at) + step);
      } else if (obj.start !== undefined && obj.end !== undefined) {
        obj.start = fmt(api.scale.parse(obj.start) + step);
        obj.end = fmt(api.scale.parse(obj.end) + step);
      }
      apply(false);
      event.preventDefault();
    }
  }

  /* ------------------------------------------------------------------ 공개 API */

  global.GanttEditor = {
    init: function (context) {
      ctx = context;
      document.addEventListener('keydown', function (event) {
        if (menuEl && event.key === 'Escape') {
          closeMenu();
          event.preventDefault();
          return;
        }
        onKeyDown(event);
      });
      document.addEventListener('mousedown', function (event) {
        if (menuEl && !menuEl.contains(event.target)) closeMenu();
      }, true);
      window.addEventListener('resize', closeMenu);
      window.addEventListener('blur', closeMenu);
      document.addEventListener('scroll', function (event) {
        if (menuEl && !menuEl.contains(event.target)) closeMenu();
      }, true);
      /* 그림 바깥 여백까지 포함한 차트 카드 전체에서 우클릭 메뉴 · 빈 곳 클릭 시 선택 해제 */
      function inChartCard(event) {
        if (!svg || !document.body.contains(svg) || !document.body.classList.contains('edit-on')) return false;
        var el = event.target;
        if (!el || !el.closest || !el.closest('#chart')) return false;
        return !el.closest('input, textarea, select, [contenteditable="true"]');
      }
      document.addEventListener('contextmenu', function (event) {
        if (inChartCard(event)) onContextMenu(event);
      });
      document.addEventListener('mousedown', function (event) {
        if (event.button !== 0 || !inChartCard(event) || svg.contains(event.target)) return;
        if (selection) {
          selection = null;
          apply(false);
        }
      });
      /* 차트 위에서 더블클릭하면 문구 입력칸으로 바로 이동 */
      document.addEventListener('dblclick', function (event) {
        if (!selection || !event.target.closest) return;
        if (!event.target.closest('svg')) return;
        focusLabelInput();
      });
    },
    bind: function (svgNode, opts) {
      svg = svgNode;
      api = svgNode.__gantt;
      svg.addEventListener('mousedown', onMouseDown);
      if (!opts || opts.keepInspector !== true) buildInspector();
    },
    getSelection: function () {
      return selection;
    },
    setSelection: function (sel) {
      selection = sel;
    },
    clearSelection: function () {
      selection = null;
    }
  };
})(window);
