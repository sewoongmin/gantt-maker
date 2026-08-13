/* ============================================================================
 *  app.js  ―  툴바 / 기간 설정 / 되돌리기 / 내보내기 / 설정(JSON) 편집
 * ========================================================================== */
(function () {
  'use strict';

  var STORAGE_KEY = 'gantt-config-v6';
  var BASELINE_KEY = 'gantt-baseline-v6';
  var VERSIONS_KEY = 'gantt-versions-v6';
  var MAX_VERSIONS = 20;

  var chartEl = document.getElementById('chart');
  var inspectorEl = document.getElementById('inspector');
  var jsonPanel = document.getElementById('jsonPanel');
  var configText = document.getElementById('configText');
  var msgEl = document.getElementById('editorMsg');
  var saveStateEl = document.getElementById('saveState');
  var compareSummaryEl = document.getElementById('compareSummary');

  var baseConfig = JSON.parse(JSON.stringify(window.GANTT_CONFIG || {}));
  if (window.GanttCompare) GanttCompare.ensureIds(baseConfig);
  var config = loadConfig();
  if (window.GanttCompare) GanttCompare.ensureIds(config);
  var baseline = loadBaseline();
  var versions = loadVersions();
  var svg = null;          /* 편집 대상(단일 모드 또는 변경 후 차트) */
  var svgBefore = null;
  var svgAfter = null;
  var history = [];
  var saveTimer = null;

  if (!config.compareStyle) {
    config.compareStyle = JSON.parse(JSON.stringify(GanttCompare.DEFAULT_STYLE));
  } else if (config.compareStyle.extend && !config.compareStyle.delay) {
    /* 예전 '연장' 키 → '지연' 으로 이전 */
    config.compareStyle.delay = config.compareStyle.extend;
    delete config.compareStyle.extend;
  }

  function loadConfig() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* 저장본이 깨졌으면 무시 */ }
    return JSON.parse(JSON.stringify(baseConfig));
  }

  function loadBaseline() {
    try {
      var raw = localStorage.getItem(BASELINE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* ignore */ }
    var snap = JSON.parse(JSON.stringify(baseConfig));
    if (window.GanttCompare) GanttCompare.ensureIds(snap);
    return snap;
  }

  function saveBaseline(src) {
    baseline = JSON.parse(JSON.stringify(src || config));
    if (window.GanttCompare) GanttCompare.ensureIds(baseline);
    try {
      localStorage.setItem(BASELINE_KEY, JSON.stringify(baseline));
    } catch (e) { /* ignore */ }
    refreshVersionSelect();
  }

  function loadVersions() {
    try {
      var raw = localStorage.getItem(VERSIONS_KEY);
      if (!raw) return [];
      var parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
      if (parsed && Array.isArray(parsed.items)) return parsed.items;
    } catch (e) { /* ignore */ }
    return [];
  }

  function persistVersions() {
    try {
      localStorage.setItem(VERSIONS_KEY, JSON.stringify(versions));
    } catch (e) {
      message('버전 목록 저장에 실패했습니다. 브라우저 저장 공간이 부족할 수 있습니다.', 'error');
    }
  }

  function versionStamp() {
    var d = new Date();
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
      ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function defaultVersionName() {
    var names = versions.map(function (v) { return v.name; });
    if (names.indexOf('최종안') < 0) return '최종안';
    var n = 2;
    while (names.indexOf('최종안 ' + n) >= 0) n++;
    return '최종안 ' + n;
  }

  function selectedVersionId() {
    var sel = document.getElementById('versionSelect');
    return sel ? sel.value : '';
  }

  function findVersion(id) {
    var found = null;
    versions.forEach(function (v) {
      if (v.id === id) found = v;
    });
    return found;
  }

  function refreshVersionSelect() {
    var sel = document.getElementById('versionSelect');
    if (!sel) return;
    var keep = sel.value;
    sel.innerHTML = '';
    var blank = document.createElement('option');
    blank.value = '';
    blank.textContent = versions.length ? '선택…' : '저장된 버전 없음';
    sel.appendChild(blank);
    versions.forEach(function (v) {
      var opt = document.createElement('option');
      opt.value = v.id;
      var mark = configsLookSame(v.data, baseline) ? ' · 비교 기준' : '';
      opt.textContent = v.name + ' · ' + (v.savedAt || '') + mark;
      sel.appendChild(opt);
    });
    if (keep && findVersion(keep)) sel.value = keep;
    var has = !!sel.value;
    var loadBtn = document.getElementById('btnLoadVersion');
    var asBaseBtn = document.getElementById('btnVersionAsBaseline');
    var delBtn = document.getElementById('btnDeleteVersion');
    if (loadBtn) loadBtn.disabled = !has;
    if (asBaseBtn) asBaseBtn.disabled = !has;
    if (delBtn) delBtn.disabled = !has;
  }

  function configsLookSame(a, b) {
    try {
      return JSON.stringify(a) === JSON.stringify(b);
    } catch (e) {
      return false;
    }
  }

  function cloneChart(src) {
    var copy = JSON.parse(JSON.stringify(src));
    if (window.GanttCompare) GanttCompare.ensureIds(copy);
    return copy;
  }

  function restoreChart(src, note) {
    pushHistory();
    config = cloneChart(src);
    if (!config.compareStyle) {
      config.compareStyle = JSON.parse(JSON.stringify(GanttCompare.DEFAULT_STYLE));
    }
    document.getElementById('compareMode').checked = false;
    GanttEditor.clearSelection();
    draw();
    autoSave();
    if (note) message(note, 'ok');
  }

  function compareOn() {
    return document.getElementById('compareMode').checked;
  }

  function updateCompareSummary(summary) {
    if (!compareSummaryEl) return;
    if (!compareOn()) {
      compareSummaryEl.hidden = true;
      return;
    }
    compareSummaryEl.hidden = false;
    if (!summary || (!summary.add && !summary.shorten && !summary.delay && !summary.hidden)) {
      compareSummaryEl.innerHTML = '<span class="chip muted">변경 없음</span>';
      return;
    }
    var style = GanttCompare.resolveStyle(config.compareStyle);
    var html = '';
    if (summary.add) {
      html +=
        '<span class="chip add" style="background:' +
        style.add.fill +
        '">' +
        style.add.label +
        ' ' +
        summary.add +
        '</span>';
    }
    if (summary.shorten) {
      html +=
        '<span class="chip shorten" style="background:' +
        style.shorten.fill +
        '">' +
        style.shorten.label +
        ' ' +
        summary.shorten +
        '</span>';
    }
    if (summary.delay) {
      html +=
        '<span class="chip delay" style="background:' +
        style.delay.fill +
        '">' +
        style.delay.label +
        ' ' +
        summary.delay +
        '</span>';
    }
    if (summary.hidden) {
      html += '<span class="chip muted">숨김 ' + summary.hidden + '</span>';
    }
    compareSummaryEl.innerHTML = html;
  }

  function message(str, kind) {
    if (!msgEl) return;
    msgEl.textContent = str || '';
    msgEl.className = 'msg' + (kind ? ' ' + kind : '');
  }

  function saveState(str) {
    if (saveStateEl) saveStateEl.textContent = str || '';
  }

  function autoSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
        saveState('브라우저에 임시 저장됨');
      } catch (e) {
        saveState('임시 저장 실패');
      }
    }, 250);
  }

  function pushHistory() {
    var snapshot = JSON.stringify(config);
    if (history.length && history[history.length - 1] === snapshot) return;
    history.push(snapshot);
    if (history.length > 80) history.shift();
    updateUndo();
  }

  function updateUndo() {
    document.getElementById('btnUndo').disabled = history.length === 0;
  }

  function undo() {
    if (!history.length) return;
    config = JSON.parse(history.pop());
    GanttEditor.clearSelection();
    updateUndo();
    draw();
    autoSave();
  }

  /* ------------------------------------------------------------------ 렌더링 */

  /* 비교의 '변경 전'은 일정(날짜)만 기준본을 쓰고, 문구 간격·위치 등 모양은 현재 차트를 따릅니다. */
  var MS_PRESENTATION = ['titleDy', 'dy', 'dx', 'titleSize', 'titleColor', 'triangle', 'itemsDx', 'itemSize'];
  var POINT_PRESENTATION = ['dy', 'dx', 'labelDy', 'labelPos', 'labelSize', 'size'];
  var BAR_PRESENTATION = ['dy', 'dx', 'labelDy', 'labelAt', 'labelSize', 'width', 'capSize'];

  function copyProps(dst, src, keys) {
    if (!src) return;
    keys.forEach(function (k) {
      if (src[k] !== undefined && src[k] !== null) dst[k] = src[k];
      else delete dst[k];
    });
  }

  function indexById(list, prefix, map) {
    (list || []).forEach(function (item) {
      if (item && item.id) map[prefix + item.id] = item;
    });
  }

  function applyCurrentPresentation(beforeCfg, current) {
    if (!beforeCfg || !current) return beforeCfg;
    beforeCfg.layout = JSON.parse(JSON.stringify(current.layout || {}));
    if (current.colors) beforeCfg.colors = JSON.parse(JSON.stringify(current.colors));
    if (current.palette) beforeCfg.palette = JSON.parse(JSON.stringify(current.palette));

    var cur = {};
    indexById(current.milestones, 'ms:', cur);
    (current.rows || []).forEach(function (row, ri) {
      cur['row#' + ri] = row;
      indexById(row.bars, 'bar:', cur);
      indexById(row.markers, 'mk:', cur);
      indexById(row.deliverables, 'dv:', cur);
    });

    (beforeCfg.milestones || []).forEach(function (ms) {
      copyProps(ms, ms.id && cur['ms:' + ms.id], MS_PRESENTATION);
    });
    (beforeCfg.rows || []).forEach(function (row, ri) {
      var srcRow = cur['row#' + ri];
      if (srcRow) {
        copyProps(row, srcRow, ['height', 'barDy']);
      }
      (row.bars || []).forEach(function (b) {
        copyProps(b, b.id && cur['bar:' + b.id], BAR_PRESENTATION);
      });
      (row.markers || []).forEach(function (m) {
        copyProps(m, m.id && cur['mk:' + m.id], POINT_PRESENTATION);
      });
      (row.deliverables || []).forEach(function (d) {
        copyProps(d, d.id && cur['dv:' + d.id], POINT_PRESENTATION);
      });
    });
    return beforeCfg;
  }

  function buildCompareHosts() {
    chartEl.innerHTML = '';
    var stack = document.createElement('div');
    stack.className = 'compare-stack';

    var paneBefore = document.createElement('section');
    paneBefore.className = 'compare-pane';
    var bannerBefore = document.createElement('div');
    bannerBefore.className = 'compare-banner before';
    bannerBefore.textContent = '변경 전';
    var hostBefore = document.createElement('div');
    hostBefore.className = 'compare-host';
    paneBefore.appendChild(bannerBefore);
    paneBefore.appendChild(hostBefore);

    var paneAfter = document.createElement('section');
    paneAfter.className = 'compare-pane';
    var bannerAfter = document.createElement('div');
    bannerAfter.className = 'compare-banner after';
    bannerAfter.textContent = '변경 후';
    var hostAfter = document.createElement('div');
    hostAfter.className = 'compare-host';
    paneAfter.appendChild(bannerAfter);
    paneAfter.appendChild(hostAfter);

    stack.appendChild(paneBefore);
    stack.appendChild(paneAfter);
    chartEl.appendChild(stack);
    return { before: hostBefore, after: hostAfter };
  }

  function draw(opts) {
    opts = opts || {};
    var editMode = document.getElementById('editMode').checked;
    svgBefore = null;
    svgAfter = null;

    try {
      if (compareOn()) {
        var hosts = buildCompareHosts();
        /* 위·아래 차트의 기간축을 같게 맞춥니다 */
        var beforeCfg = JSON.parse(JSON.stringify(baseline));
        beforeCfg.range = JSON.parse(JSON.stringify(config.range));
        beforeCfg.periodLabels = (config.periodLabels || []).slice();
        applyCurrentPresentation(beforeCfg, config);

        var afterCfg = Gantt.normalize(config);
        var scale = Gantt.makeScale(afterCfg);
        var changes = GanttCompare.diff(beforeCfg, config, scale);
        var padRows = GanttCompare.comparePadMap
          ? GanttCompare.comparePadMap(changes, afterCfg.layout)
          : GanttCompare.affectedRows(changes);

        svgBefore = Gantt.render(beforeCfg, hosts.before, { interactive: false });
        svgAfter = Gantt.render(config, hosts.after, {
          interactive: editMode,
          selection: editMode ? GanttEditor.getSelection() : null,
          compareChanges: changes,
          compareStyle: config.compareStyle,
          comparePadRows: padRows
        });
        svg = svgAfter;
      } else {
        svg = Gantt.render(config, chartEl, {
          interactive: editMode,
          selection: editMode ? GanttEditor.getSelection() : null
        });
      }
    } catch (err) {
      chartEl.innerHTML = '<p class="render-error">렌더링 오류: ' + err.message + '</p>';
      console.error(err);
      return;
    }

    if (editMode && svg) GanttEditor.bind(svg, opts);
    inspectorEl.hidden = !editMode;
    document.body.classList.toggle('edit-on', editMode);
    document.body.classList.toggle('compare-on', compareOn());
    updateCompareSummary(svg && svg.__gantt ? svg.__gantt.compareSummary : null);
    syncRangeControls();
    if (!jsonPanel.hidden && !opts.keepJson) configText.value = JSON.stringify(config, null, 2);
  }

  /* ------------------------------------------------------------- 기간 드롭다운 */

  var rangeIds = ['rangeStartYear', 'rangeStartPeriod', 'rangeEndYear', 'rangeEndPeriod'];

  function syncRangeControls() {
    if (!svg || !svg.__gantt) return;
    var scale = svg.__gantt.scale;
    var labels = svg.__gantt.config.periodLabels;
    var startParts = scale.split(0);
    var endParts = scale.split(scale.total - 1);

    var y0 = Math.min(startParts.year, endParts.year) - 4;
    var y1 = Math.max(startParts.year, endParts.year) + 6;

    fillYears('rangeStartYear', y0, y1, startParts.year);
    fillYears('rangeEndYear', y0, y1, endParts.year);
    fillPeriods('rangeStartPeriod', labels, startParts.period);
    fillPeriods('rangeEndPeriod', labels, endParts.period);
  }

  function fillYears(id, from, to, value) {
    var sel = document.getElementById(id);
    var wanted = [];
    for (var y = from; y <= to; y++) wanted.push(y);
    if (sel.dataset.range !== from + '-' + to) {
      sel.innerHTML = '';
      wanted.forEach(function (y) {
        var o = document.createElement('option');
        o.value = y;
        o.textContent = y;
        sel.appendChild(o);
      });
      sel.dataset.range = from + '-' + to;
    }
    sel.value = String(value);
  }

  function fillPeriods(id, labels, value) {
    var sel = document.getElementById(id);
    if (sel.dataset.count !== String(labels.length)) {
      sel.innerHTML = '';
      labels.forEach(function (label, i) {
        var o = document.createElement('option');
        o.value = i + 1;
        o.textContent = label;
        sel.appendChild(o);
      });
      sel.dataset.count = String(labels.length);
    }
    sel.value = String(value);
  }

  function applyRange() {
    pushHistory();
    config.range = {
      start: document.getElementById('rangeStartYear').value + '-Q' + document.getElementById('rangeStartPeriod').value,
      end: document.getElementById('rangeEndYear').value + '-Q' + document.getElementById('rangeEndPeriod').value
    };
    delete config.years;
    delete config.startYear;
    draw();
    autoSave();
  }

  rangeIds.forEach(function (id) {
    document.getElementById(id).addEventListener('change', applyRange);
  });

  /* --------------------------------------------------------------- 편집기 연결 */

  GanttEditor.init({
    inspectorEl: inspectorEl,
    getConfig: function () {
      return config;
    },
    isCompareMode: function () {
      return compareOn();
    },
    pushHistory: pushHistory,
    getSnap: function () {
      return parseFloat(document.getElementById('snap').value);
    },
    onChange: function (opts) {
      draw(opts);
      autoSave();
    }
  });

  document.getElementById('editMode').addEventListener('change', function () {
    GanttEditor.clearSelection();
    draw();
  });

  document.getElementById('compareMode').addEventListener('change', function () {
    draw();
  });

  document.getElementById('btnSaveBaseline').addEventListener('click', function () {
    saveBaseline(config);
    draw();
    message('현재 일정을 비교 기준으로 저장했습니다. 이후 변경분이 표시됩니다.', 'ok');
  });

  document.getElementById('btnRestoreBaseline').addEventListener('click', function () {
    if (!confirm('비교 기준(변경 전) 일정으로 되돌립니다.\n지금 작업은 「되돌리기」로 취소할 수 있습니다.')) return;
    restoreChart(baseline, '변경 전 일정을 작업 화면으로 불러왔습니다. 변경 비교는 꺼 두었습니다.');
    saveState('변경 전 일정 표시 중');
  });

  document.getElementById('versionSelect').addEventListener('change', refreshVersionSelect);

  document.getElementById('btnSaveVersion').addEventListener('click', function () {
    var name = window.prompt('이 일정을 어떤 이름으로 저장할까요?', defaultVersionName());
    if (name == null) return;
    name = String(name).trim();
    if (!name) {
      message('버전 이름을 입력해 주세요.', 'error');
      return;
    }
    var existing = null;
    versions.forEach(function (v) {
      if (v.name === name) existing = v;
    });
    if (existing && !confirm('같은 이름 「' + name + '」이 있습니다. 덮어쓸까요?')) return;
    if (existing) {
      existing.data = cloneChart(config);
      existing.savedAt = versionStamp();
    } else {
      if (versions.length >= MAX_VERSIONS) {
        message('버전은 최대 ' + MAX_VERSIONS + '개까지 저장할 수 있습니다. 하나를 지운 뒤 다시 저장해 주세요.', 'error');
        return;
      }
      versions.unshift({
        id: 'v-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        name: name,
        savedAt: versionStamp(),
        data: cloneChart(config)
      });
    }
    persistVersions();
    refreshVersionSelect();
    var just = existing ? existing.id : versions[0].id;
    document.getElementById('versionSelect').value = just;
    refreshVersionSelect();
    message('「' + name + '」버전을 저장했습니다.', 'ok');
    saveState('버전 「' + name + '」저장됨');
  });

  document.getElementById('btnLoadVersion').addEventListener('click', function () {
    var v = findVersion(selectedVersionId());
    if (!v) return;
    if (!confirm('「' + v.name + '」버전으로 되돌립니다.\n지금 작업은 「되돌리기」로 취소할 수 있습니다.')) return;
    restoreChart(v.data, '「' + v.name + '」버전을 작업 화면으로 불러왔습니다.');
  });

  document.getElementById('btnVersionAsBaseline').addEventListener('click', function () {
    var v = findVersion(selectedVersionId());
    if (!v) return;
    saveBaseline(v.data);
    draw();
    message('「' + v.name + '」을 변경 비교의 기준으로 썼습니다. 변경 비교를 켜면 지금 일정과 대조됩니다.', 'ok');
  });

  document.getElementById('btnDeleteVersion').addEventListener('click', function () {
    var id = selectedVersionId();
    var v = findVersion(id);
    if (!v) return;
    if (!confirm('「' + v.name + '」버전을 목록에서 지울까요? 작업 중인 일정은 그대로입니다.')) return;
    versions = versions.filter(function (item) { return item.id !== id; });
    persistVersions();
    refreshVersionSelect();
    message('「' + v.name + '」버전을 지웠습니다.', 'ok');
  });

  document.getElementById('btnUndo').addEventListener('click', undo);

  document.addEventListener('keydown', function (ev) {
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'z') {
      var tag = (ev.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;
      undo();
      ev.preventDefault();
    }
  });

  /* ------------------------------------------------------------------ 내보내기 */

  function fileStamp() {
    var d = new Date();
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes());
  }

  function downloadBlob(blob, filename) {
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

  document.getElementById('btnPng').addEventListener('click', function () {
    var scale = +document.getElementById('pngScale').value || 2;
    var name = 'gantt-' + fileStamp() + '.png';
    var job =
      compareOn() && svgBefore && svgAfter
        ? GanttCompare.exportDualPNG(svgBefore, svgAfter, scale, name, {
            before: '변경 전',
            after: '변경 후'
          })
        : Gantt.exportPNG(svg, scale, name);
    job.catch(function (e) {
      message('PNG 저장 실패: ' + e.message, 'error');
    });
  });

  document.getElementById('btnSvg').addEventListener('click', function () {
    if (compareOn() && svgBefore && svgAfter) {
      var dual = GanttCompare.composeDual(svgBefore, svgAfter, { before: '변경 전', after: '변경 후' });
      downloadBlob(new Blob([dual.xml], { type: 'image/svg+xml;charset=utf-8' }), 'gantt-' + fileStamp() + '.svg');
    } else {
      Gantt.exportSVG(svg, 'gantt-' + fileStamp() + '.svg');
    }
  });

  document.getElementById('btnPrint').addEventListener('click', function () {
    window.print();
  });

  /* --------------------------------------------------------- 설정(JSON) 편집 */

  document.getElementById('btnJson').addEventListener('click', function () {
    jsonPanel.hidden = !jsonPanel.hidden;
    if (!jsonPanel.hidden) {
      configText.value = JSON.stringify(config, null, 2);
      configText.focus();
    }
  });

  function parseConfigSource(src) {
    var body = String(src).trim();
    /* 간트 내보내기 패키지: { version, config, baseline? } */
    try {
      var packed = JSON.parse(body);
      if (packed && packed.config && (packed.version || packed.baseline !== undefined || packed.versions)) {
        return {
          config: packed.config,
          baseline: packed.baseline || null,
          versions: packed.versions || null,
          packed: true
        };
      }
      if (packed && packed.rows) {
        return { config: packed, baseline: null, packed: false };
      }
    } catch (e1) { /* 아래 형식 시도 */ }

    body = body.replace(/^[\s\S]*?GANTT_CONFIG\s*=/, '').replace(/;\s*$/, '').trim();
    try {
      return { config: JSON.parse(body), baseline: null, packed: false };
    } catch (e) {
      /* eslint-disable no-new-func */
      return { config: new Function('return (' + body + ');')(), baseline: null, packed: false };
    }
  }

  function applyLoadedConfig(parsed, fileName) {
    pushHistory();
    config = parsed.config;
    if (window.GanttCompare) GanttCompare.ensureIds(config);
    if (!config.compareStyle) {
      config.compareStyle = JSON.parse(JSON.stringify(GanttCompare.DEFAULT_STYLE));
    }
    if (parsed.baseline) {
      saveBaseline(parsed.baseline);
    }
    if (parsed.versions && parsed.versions.length) {
      versions = parsed.versions;
      persistVersions();
    }
    GanttEditor.clearSelection();
    draw({ keepJson: true });
    autoSave();
    message(
      (fileName || '간트') + ' 을 불러왔습니다.' +
        (parsed.baseline ? ' (비교 기준 포함)' : '') +
        (parsed.versions && parsed.versions.length ? ' (버전 ' + parsed.versions.length + '개)' : ''),
      'ok'
    );
  }

  document.getElementById('btnApplyJson').addEventListener('click', function () {
    var parsed;
    try {
      parsed = parseConfigSource(configText.value);
    } catch (err) {
      message('설정을 해석할 수 없습니다: ' + err.message, 'error');
      return;
    }
    applyLoadedConfig(parsed, 'JSON');
  });

  document.getElementById('btnExportGantt').addEventListener('click', function () {
    var payload = {
      version: 2,
      type: 'gantt-chart',
      savedAt: new Date().toISOString(),
      config: config,
      baseline: baseline,
      versions: versions
    };
    downloadBlob(
      new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' }),
      'gantt-' + fileStamp() + '.json'
    );
    message('간트를 내보냈습니다. 「간트 불러오기」로 다시 열어 수정할 수 있습니다.', 'ok');
  });

  document.getElementById('btnSaveConfig').addEventListener('click', function () {
    var src =
      '/* 간트차트 설정 — 화면에서 편집한 결과 (' + new Date().toLocaleString('ko-KR') + ') */\n' +
      'window.GANTT_CONFIG = ' + JSON.stringify(config, null, 2) + ';\n';
    downloadBlob(new Blob([src], { type: 'text/javascript;charset=utf-8' }), 'chart-config.js');
    message('내려받은 파일로 프로젝트의 chart-config.js 를 교체하면 됩니다.', 'ok');
  });

  document.getElementById('fileConfig').addEventListener('change', function (ev) {
    var file = ev.target.files && ev.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        applyLoadedConfig(parseConfigSource(reader.result), file.name);
      } catch (err) {
        message('파일을 해석할 수 없습니다: ' + err.message, 'error');
      }
    };
    reader.readAsText(file, 'utf-8');
    ev.target.value = '';
  });

  document.getElementById('btnReset').addEventListener('click', function () {
    if (!confirm('화면에서 편집한 내용을 버리고 chart-config.js 내용으로 되돌립니다.')) return;
    pushHistory();
    localStorage.removeItem(STORAGE_KEY);
    config = JSON.parse(JSON.stringify(baseConfig));
    if (window.GanttCompare) GanttCompare.ensureIds(config);
    GanttEditor.clearSelection();
    draw();
    saveState('파일 기준');
    message('chart-config.js 기준으로 되돌렸습니다.', 'ok');
  });

  /* ------------------------------------------------------------------ 시작 */

  if (!localStorage.getItem(BASELINE_KEY)) saveBaseline(baseConfig);
  refreshVersionSelect();
  updateUndo();
  draw();
  saveState(localStorage.getItem(STORAGE_KEY) ? '브라우저 임시 저장본 사용 중' : '파일 기준');
})();
