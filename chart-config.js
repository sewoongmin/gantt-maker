/* ============================================================================
 *  간트차트 설정 파일  ―  이 파일만 고치면 차트가 바뀝니다.
 *  (화면에서 직접 끌어서 고친 뒤 "chart-config.js 저장" 을 눌러도 됩니다)
 * ============================================================================
 *
 *  [기간]  연도의 1Q~4Q 로 딱 맞출 필요가 없습니다.
 *    range: { start: '2026-Q2', end: '2029-Q2' }   ← 시작·끝 분기를 자유롭게
 *
 *  [시점(時點) 쓰는 방법]  start / end / at 값
 *    "2026-Q3"     → 2026년 3분기가 시작되는 지점
 *    "2026-Q3.5"   → 2026년 3분기의 중간 (소수 = 분기 내 비율)
 *    "2026-Q3.25"  → 2026년 3분기의 ¼ 지점 (이동 단위 ¼분기와 맞춤)
 *    "2026-08"     → 2026년 8월 1일
 *    "2026-08-15"  → 2026년 8월 15일
 *
 *  ※ 이동 단위가 ¼분기일 때 시점의 소수는 0 / 0.25 / 0.5 / 0.75 를 쓰면
 *     처음부터 칸에 딱 맞게 표시됩니다.
 *
 *  [막대(bars)]
 *    start, end   : 시작 / 끝 시점
 *    color        : 생략하면 barColorCycle 순서(하늘색 → 남색 → …)로 자동 지정
 *    width, dy, capStart/capEnd, label, labelAt, labelDx, labelDy
 *    compareOffsetDy : 변경 비교 시 단축·지연·추가 알약 세로 오프셋(px)
 *    compareHidden   : true 이면 이 일정의 비교 마커 숨김
 *
 *  [이벤트 점(markers) / 산출물(deliverables)]
 *    at, type, color, size, label, labelPos('above'|'below'), labelDy
 *    compareOffsetDy : 변경 비교 알약 세로 오프셋
 *
 *  [마일스톤(milestones)]
 *    row / fromRow / toRow / line / title / items / titleDy
 *    titleDy : 0=삼각형 아래(기본), 음수=위로 이동
 *    compareOffsetDy : 변경 비교 알약 세로 오프셋
 * ========================================================================== */

window.GANTT_CONFIG = {
  "title": "",
  "subtitle": "",
  "range": {
    "start": "2026-Q2",
    "end": "2029-Q1"
  },
  "periodLabels": [
    "1Q",
    "2Q",
    "3Q",
    "4Q"
  ],
  "cornerLabel": "일자",
  "palette": [
    {
      "name": "sky",
      "label": "하늘색",
      "color": "#9DC3E6"
    },
    {
      "name": "navy",
      "label": "남색",
      "color": "#1F3864"
    },
    {
      "name": "blue",
      "label": "파랑",
      "color": "#2E75B6"
    },
    {
      "name": "steel",
      "label": "연한 남색",
      "color": "#8FAADC"
    },
    {
      "name": "teal",
      "label": "청록",
      "color": "#2A9D8F"
    },
    {
      "name": "green",
      "label": "초록",
      "color": "#548235"
    },
    {
      "name": "gold",
      "label": "금색",
      "color": "#BF9000"
    },
    {
      "name": "orange",
      "label": "주황",
      "color": "#E36C0A"
    },
    {
      "name": "red",
      "label": "빨강",
      "color": "#FF0000"
    },
    {
      "name": "crimson",
      "label": "진한 빨강",
      "color": "#C00000"
    },
    {
      "name": "purple",
      "label": "보라",
      "color": "#7030A0"
    },
    {
      "name": "gray",
      "label": "회색",
      "color": "#808080"
    }
  ],
  "barColorCycle": [
    "sky",
    "navy"
  ],
  "colors": {
    "header": "#404040",
    "subHeader": "#F2F2F2",
    "grid": "#D0D4DB",
    "gridYear": "#A8ADB6",
    "gridPeriod": "#D4D8DF",
    "rowAlt": "#F5F7FB",
    "text": "#000000"
  },
  "layout": {
    "padding": 24,
    "labelColWidth": 152,
    "periodWidth": 74,
    "yearHeaderHeight": 34,
    "periodHeaderHeight": 30,
    "rowHeight": 86,
    "rowPadding": 9,
    "rowMilestoneOffset": 24,
    "showPeriodGrid": true,
    "periodGridStyle": "solid",
    "showYearGrid": true,
    "zebra": true,
    "zebraStart": 1
  },
  "rows": [
    {
      "label": "비행시험",
      "bars": [
        {
          "id": "b-flight-1",
          "start": "2026-Q3",
          "end": "2026-Q4",
          "capStart": "circle",
          "capEnd": "circle",
          "label": "비행 계획 \n수립",
          "labelAt": 0.5
        },
        {
          "id": "b-flight-2",
          "start": "2026-Q4",
          "end": "2027-Q1",
          "capStart": "circle",
          "capEnd": "circle",
          "label": "초도 비행\n(수동 조종)",
          "labelAt": 0.5,
          "compareHidden": true,
          "labelDy": -12
        },
        {
          "id": "b-flight-3",
          "start": "2027-Q4",
          "end": "2029-Q1",
          "color": "gold",
          "capStart": "circle",
          "capEnd": "circle",
          "label": "임무 비행 (Phase-II, 체계 통합)",
          "labelAt": 0.5,
          "labelDy": -12
        },
        {
          "id": "bar-msppr444",
          "start": "2027-Q1",
          "end": "2027-Q2",
          "label": "기본비행\n(GCS 기반)",
          "capStart": "circle",
          "capEnd": "circle",
          "labelAt": 0.5,
          "compareHidden": true
        },
        {
          "id": "bar-mspprnjb",
          "start": "2027-Q2",
          "end": "2027-Q4",
          "label": "임무비행 (Phase-I)",
          "capStart": "circle",
          "capEnd": "circle",
          "labelAt": 0.5,
          "compareHidden": true
        }
      ],
      "markers": [],
      "height": 41
    },
    {
      "label": "상황인지 /\n동적의사결정",
      "bars": [
        {
          "id": "b-sa-1",
          "start": "2026-Q3",
          "end": "2026-Q4",
          "capStart": "circle",
          "capEnd": "circle",
          "label": "시뮬레이션\n환경 구축",
          "labelAt": 0.5,
          "labelDy": -14
        },
        {
          "id": "b-sa-2",
          "start": "2026-Q4",
          "end": "2027-Q2",
          "capStart": "circle",
          "capEnd": "circle",
          "label": "계층적 RL 모델 학습\n및 고도화",
          "labelAt": 0.5,
          "compareOffsetDy": 0,
          "compareHidden": true
        },
        {
          "id": "b-sa-3",
          "start": "2027-Q2",
          "end": "2027-Q4",
          "capStart": "circle",
          "capEnd": "circle",
          "label": "SILS 환경설계\n및 학습",
          "labelAt": 0.5,
          "labelDy": -16
        },
        {
          "id": "b-sa-4",
          "start": "2028-Q1",
          "end": "2029-Q1",
          "color": "gold",
          "capStart": "circle",
          "capEnd": "circle",
          "label": "실 환경 성능 검증 / \n기술 고도화",
          "labelAt": 0.5,
          "compareOffsetDy": -18
        },
        {
          "id": "bar-mspq2xx0",
          "start": "2027-Q4",
          "end": "2028-Q1",
          "label": "HILS 환경설계\n및 고도화",
          "labelAt": 0.5,
          "capStart": "circle",
          "capEnd": "circle",
          "compareOffsetDy": 8,
          "labelDy": -12,
          "compareHidden": true
        }
      ],
      "markers": [],
      "deliverables": [],
      "height": 69
    },
    {
      "label": "검증",
      "bars": [],
      "markers": [],
      "deliverables": [],
      "height": 72
    }
  ],
  "milestones": [
    {
      "id": "ms-contract",
      "at": "2027-Q2",
      "row": 2,
      "color": "steel",
      "line": "dashed",
      "fromRow": 0,
      "toRow": 2,
      "title": "디지털 트윈 환경 통합",
      "titleDy": 10
    },
    {
      "id": "ms-flight",
      "at": "2028-Q3",
      "row": 2,
      "color": "red",
      "line": "dashed",
      "fromRow": 0,
      "toRow": 2,
      "title": "실 환경\n기술 데모",
      "compareOffsetDy": 58,
      "titleDy": 10
    },
    {
      "id": "ms-mspq5ijh",
      "at": "2027-Q4",
      "color": "steel",
      "line": "dashed",
      "fromRow": 0,
      "toRow": 2,
      "row": 2,
      "title": "SILS 환경\n성능 검증",
      "titleDy": 10
    },
    {
      "id": "ms-mspq620k",
      "at": "2028-Q1",
      "color": "red",
      "line": "dashed",
      "fromRow": 0,
      "toRow": 2,
      "row": 2,
      "title": "시뮬레이션\n기반 기술 데모",
      "compareOffsetDy": 56,
      "titleDy": 10
    }
  ],
  "compareStyle": {
    "add": {
      "fill": "#E11D48",
      "label": "추가"
    },
    "shorten": {
      "fill": "#EF4444",
      "label": "단축"
    },
    "delay": {
      "fill": "#EA580C",
      "label": "지연"
    },
    "ghost": {
      "fill": "#FB7185",
      "label": "기존 일정"
    }
  },
  "legend": {
    "show": true,
    "title": "범례",
    "items": [
      {
        "type": "lineAlt",
        "colors": [
          "sky",
          "navy"
        ],
        "label": "알고리즘 개발"
      },
      {
        "type": "line",
        "color": "gold",
        "label": "체계 통합 · 고도화"
      },
      {
        "type": "milestone",
        "color": "red",
        "label": "핵심 마일스톤 (데모)"
      },
      {
        "type": "triangle",
        "color": "steel",
        "label": "개발 마일스톤"
      }
    ]
  }
};
