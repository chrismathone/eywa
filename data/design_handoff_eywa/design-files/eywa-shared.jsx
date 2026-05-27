// eywa-shared.jsx — palettes, menus, icons, moodboard atom
// Three palettes share the same semantic slot names so each variant
// references them identically.

// ────────────────────────────────────────────────────────────────
// PALETTES
// ────────────────────────────────────────────────────────────────
// Palette keys preserved (bio/net/canopy) so dashboards keep working — but
// values rebuilt for a more grounded, professional SaaS feel. No more glow,
// no more Fraunces italic display. Natural greens are kept but as muted
// sage/forest tones, not bioluminescent neon.
const EYWA_PALETTES = {
  // A · Forest Console — Linear-style dark with sage green accent
  bio: {
    bg: '#0a0e0c',
    bgSoft: '#0f1411',
    surface: '#151b17',
    surfaceHi: '#1c2420',
    line: 'rgba(255, 255, 255, 0.06)',
    lineStrong: 'rgba(255, 255, 255, 0.12)',
    text: '#e6ebe7',
    textDim: '#98a39d',
    textFaint: '#5f6a64',
    glow: '#86c79a',                      // sage green (was neon cyan)
    glowSoft: 'rgba(134, 199, 154, 0.14)',
    emerald: '#5fa37d',
    magenta: '#d68a8a',                   // muted rose (was pandoran pink)
    magentaSoft: 'rgba(214, 138, 138, 0.14)',
    amber: '#d9a566',
    danger: '#e08070',
    font: '"Pretendard Variable", Pretendard, sans-serif',
    fontDisplay: '"Pretendard Variable", Pretendard, sans-serif',
    fontMono: '"JetBrains Mono", ui-monospace, monospace',
  },
  // B · Daylight — Toss-style light, friendly, Korean SaaS
  net: {
    bg: '#f7f8f9',                        // crisp light (was warm parchment)
    bgSoft: '#eef0f2',
    surface: '#ffffff',
    surfaceHi: '#fafbfc',
    line: 'rgba(17, 24, 28, 0.08)',
    lineStrong: 'rgba(17, 24, 28, 0.14)',
    text: '#0f1419',
    textDim: '#4e5862',
    textFaint: '#8b939c',
    glow: '#1f7a4d',                      // forest green, professional (was teal)
    glowSoft: 'rgba(31, 122, 77, 0.08)',
    emerald: '#2d9461',
    magenta: '#c44d6d',                   // wine, used very sparingly
    magentaSoft: 'rgba(196, 77, 109, 0.08)',
    amber: '#d68f1a',
    danger: '#d04848',
    font: '"Pretendard Variable", Pretendard, sans-serif',
    fontDisplay: '"Pretendard Variable", Pretendard, sans-serif',
    fontMono: '"JetBrains Mono", ui-monospace, monospace',
  },
  // C · Canopy — Stripe-style dark editorial with muted gold accent
  canopy: {
    bg: '#0c0e12',                        // charcoal blue (was mist morning)
    bgSoft: '#13161c',
    surface: '#171b22',
    surfaceHi: '#1d222a',
    line: 'rgba(255, 255, 255, 0.06)',
    lineStrong: 'rgba(255, 255, 255, 0.12)',
    text: '#e6e9ef',
    textDim: '#90969f',
    textFaint: '#5b6068',
    glow: '#c8a26c',                      // muted gold (was sage)
    glowSoft: 'rgba(200, 162, 108, 0.14)',
    emerald: '#6ba589',                   // soft forest
    magenta: '#c47d8c',                   // muted rose
    magentaSoft: 'rgba(196, 125, 140, 0.14)',
    amber: '#c8a26c',
    danger: '#d97a6a',
    font: '"Pretendard Variable", Pretendard, sans-serif',
    fontDisplay: '"Pretendard Variable", Pretendard, sans-serif',
    fontMono: '"JetBrains Mono", ui-monospace, monospace',
  },
};

// ────────────────────────────────────────────────────────────────
// MENUS — the 12 menu set from eywa repo
// ────────────────────────────────────────────────────────────────
const EYWA_MENUS = [
  { id: 'dashboard', label: '대시보드', group: 'home', icon: 'tree' },
  { id: 'timetable', label: '시간표', group: 'class', icon: 'leaf' },
  { id: 'attendance', label: '출석부', group: 'class', icon: 'pulse' },
  { id: 'classes', label: '수업목록', group: 'class', icon: 'branch' },
  { id: 'students', label: '학생목록', group: 'student', icon: 'seed' },
  { id: 'enrollment', label: '등록상담', group: 'student', icon: 'sprout' },
  { id: 'consultation', label: '학생상담', group: 'student', icon: 'wave' },
  { id: 'withdrawal', label: '퇴원관리', group: 'student', icon: 'falling' },
  { id: 'staff', label: '직원관리', group: 'ops', icon: 'roots' },
  { id: 'billing', label: '수납관리', group: 'ops', icon: 'pollen' },
  { id: 'meetings', label: '회의록', group: 'ops', icon: 'rings' },
  { id: 'help', label: '도움말', group: 'help', icon: 'spore' },
];

const EYWA_GROUPS = {
  home: '홈',
  class: '수업',
  student: '학생',
  ops: '운영',
  help: '지원',
};

// ────────────────────────────────────────────────────────────────
// ICONS — botanical/organic stroke set
// All icons are 1.6 stroke, currentColor, sized via `size` prop.
// ────────────────────────────────────────────────────────────────
function EyIcon({ name, size = 18, color = 'currentColor', strokeWidth = 1.6, style }) {
  const props = {
    width: size, height: size, viewBox: '0 0 24 24',
    fill: 'none', stroke: color, strokeWidth, strokeLinecap: 'round', strokeLinejoin: 'round',
    style,
  };
  switch (name) {
    case 'tree':
      return (<svg {...props}>
        <path d="M12 22V11" /><path d="M12 11c0-3 -2-4 -4-5 -3 -1.5 -3 -5 0-6 3-1 4 1 4 3" />
        <path d="M12 11c0-3 2-4 4-5 3-1.5 3-5 0-6 -3-1 -4 1 -4 3" />
        <path d="M9 22h6" />
      </svg>);
    case 'leaf':
      return (<svg {...props}>
        <path d="M4 20c0-8 6-14 16-16-1 11-7 16-15 16" /><path d="M4 20l8-8" />
      </svg>);
    case 'pulse':
      return (<svg {...props}>
        <path d="M3 12h4l2-6 4 12 2-6h6" />
      </svg>);
    case 'branch':
      return (<svg {...props}>
        <path d="M4 22V4" /><path d="M4 10c4 0 6-2 6-6" /><path d="M4 16c5 0 8-3 8-8" />
        <circle cx="10" cy="4" r="1.4" /><circle cx="12" cy="8" r="1.4" />
      </svg>);
    case 'seed':
      return (<svg {...props}>
        <ellipse cx="12" cy="13" rx="6" ry="8" /><path d="M12 5v16" />
      </svg>);
    case 'sprout':
      return (<svg {...props}>
        <path d="M12 22V12" /><path d="M12 12c0-4-4-6-8-6 0 6 4 9 8 9" />
        <path d="M12 14c0-3 3-5 7-5 0 5-3 8-7 8" />
      </svg>);
    case 'wave':
      return (<svg {...props}>
        <path d="M3 10c3-3 5-3 8 0s5 3 8 0" /><path d="M3 16c3-3 5-3 8 0s5 3 8 0" />
      </svg>);
    case 'falling':
      return (<svg {...props}>
        <path d="M12 3v14" /><path d="M7 12l5 5 5-5" /><path d="M5 21h14" />
      </svg>);
    case 'roots':
      return (<svg {...props}>
        <path d="M12 3v8" /><path d="M12 11c-3 0-5 2-5 5v5" /><path d="M12 11c3 0 5 2 5 5v5" />
        <path d="M12 11v10" /><path d="M3 21h18" />
      </svg>);
    case 'pollen':
      return (<svg {...props}>
        <circle cx="12" cy="12" r="3" /><path d="M12 4v2" /><path d="M12 18v2" /><path d="M4 12h2" /><path d="M18 12h2" />
        <path d="M6 6l1.5 1.5" /><path d="M16.5 16.5L18 18" /><path d="M6 18l1.5-1.5" /><path d="M16.5 7.5L18 6" />
      </svg>);
    case 'rings':
      return (<svg {...props}>
        <circle cx="12" cy="12" r="3" /><circle cx="12" cy="12" r="6.5" /><circle cx="12" cy="12" r="10" />
      </svg>);
    case 'spore':
      return (<svg {...props}>
        <circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="0.5" fill="currentColor" />
        <path d="M12 8.5v0.5" /><path d="M12 15v0.5" /><path d="M8.5 12h-0.5" /><path d="M15.5 12h0.5" />
      </svg>);
    case 'search':
      return (<svg {...props}>
        <circle cx="11" cy="11" r="7" /><path d="M21 21l-4.5-4.5" />
      </svg>);
    case 'bell':
      return (<svg {...props}>
        <path d="M6 9a6 6 0 0112 0v4l2 3H4l2-3V9z" /><path d="M10 19a2 2 0 004 0" />
      </svg>);
    case 'arrowUp':
      return (<svg {...props}><path d="M7 11l5-5 5 5" /><path d="M12 6v14" /></svg>);
    case 'arrowDown':
      return (<svg {...props}><path d="M7 13l5 5 5-5" /><path d="M12 18V4" /></svg>);
    case 'arrowRight':
      return (<svg {...props}><path d="M5 12h14" /><path d="M13 6l6 6-6 6" /></svg>);
    case 'play':
      return (<svg {...props}><path d="M6 4l14 8-14 8V4z" /></svg>);
    case 'check':
      return (<svg {...props}><path d="M4 12l5 5L20 6" /></svg>);
    case 'plus':
      return (<svg {...props}><path d="M12 5v14M5 12h14" /></svg>);
    case 'dot':
      return (<svg {...props}><circle cx="12" cy="12" r="3" fill="currentColor" stroke="none" /></svg>);
    case 'sparkle':
      return (<svg {...props}><path d="M12 3l1.8 5.6L19 10l-5.2 1.4L12 17l-1.8-5.6L5 10l5.2-1.4L12 3z" /></svg>);
    default:
      return (<svg {...props}><circle cx="12" cy="12" r="9" /></svg>);
  }
}

// ────────────────────────────────────────────────────────────────
// Demo data — shared across dashboards
// ────────────────────────────────────────────────────────────────
const EYWA_DATA = {
  kpis: [
    { id: 'students', label: '재원생', value: 248, unit: '명', delta: '+12', up: true, helper: '신규 14 · 퇴원 2',
      spark: [232, 234, 235, 238, 240, 244, 246, 248] },
    { id: 'attend', label: '오늘 출석률', value: '94.2', unit: '%', delta: '+1.8pt', up: true, helper: '234/248 · 결석 9 · 지각 5',
      spark: [88, 91, 89, 92, 93, 94, 92, 94] },
    { id: 'pay', label: '이번달 수납률', value: '87.1', unit: '%', delta: '-2.4pt', up: false, helper: '216/248건 · 미수 32',
      spark: [82, 84, 86, 88, 91, 90, 88, 87] },
    { id: 'consult', label: '진행중 상담', value: 11, unit: '건', delta: '+3', up: true, helper: '신규 7 · AI 분석 대기 4',
      spark: [5, 6, 7, 8, 8, 10, 10, 11] },
  ],
  events: [
    { id: 'e1', time: '13:00', end: '14:30', type: 'class',    title: '중2 수학 심화 A반', ctx: '강민서 외 11명 · 박지훈 강사', room: '301호', status: 'done',     mins: 90 },
    { id: 'e2', time: '14:40', end: '15:40', type: 'consult',  title: '윤소율 학부모 등록상담', ctx: '예비 중1 · AI 분석 완료 · 김상담', status: 'done',     mins: 60 },
    { id: 'e3', time: '16:00', end: '17:30', type: 'class',    title: '고1 영어 정규 B반', ctx: '정수아 외 9명 · 이연우 강사', room: '205호', status: 'ongoing',  mins: 90 },
    { id: 'e4', time: '17:40', end: '18:40', type: 'consult',  title: '이도현 학생 진로상담', ctx: '고2 · 담임 박지훈', status: 'upcoming', mins: 60 },
    { id: 'e5', time: '19:00', end: '20:30', type: 'class',    title: '중3 수학 심화 C반', ctx: '한지우 외 13명 · 박지훈 강사', room: '301호', status: 'upcoming', mins: 90 },
    { id: 'e6', time: '20:30', end: '21:00', type: 'meeting',  title: '주간 강사 회의', ctx: '전 강사 · 회의실', status: 'upcoming', mins: 30 },
  ],
  announcements: [
    { id: 'a1', tag: '공지', title: '7월 시험 일정 확정', when: '2시간 전', author: '김수진 원장' },
    { id: 'a2', tag: '시스템', title: 'EYWA 시스템 점검 — 일 02:00~03:00', when: '어제', author: '운영팀' },
    { id: 'a3', tag: '인사', title: '신규 강사 박지원 7/15 출근', when: '3일 전', author: '인사' },
  ],
  trend: {
    label: '이번 분기 재원생 추이',
    points: [180, 195, 201, 210, 218, 225, 232, 240, 244, 246, 247, 248],
    months: ['1월', '', '2월', '', '3월', '', '4월', '', '5월', '', '6월', '7월'],
  },
};

// ────────────────────────────────────────────────────────────────
// Moodboard artboard (intro)
// ────────────────────────────────────────────────────────────────
function Moodboard() {
  const directions = [
    {
      key: 'A',
      name: 'Forest Console',
      ko: '다크 + 세이지 그린',
      palette: EYWA_PALETTES.bio,
      sample: ['#86c79a', '#5fa37d', '#d9a566', '#0a0e0c'],
      mood: 'Linear · Vercel · 모던 다크',
      use: '테크 친화적 원장 / B2B',
    },
    {
      key: 'B',
      name: 'Daylight',
      ko: '밝고 친근한 한국 SaaS',
      palette: EYWA_PALETTES.net,
      sample: ['#1f7a4d', '#d68f1a', '#0f1419', '#f7f8f9'],
      mood: '토스 · 채널톡 · 친근하고 명확',
      use: '일반 학원장 / 가격민감',
    },
    {
      key: 'C',
      name: 'Canopy',
      ko: '프리미엄 다크 + 골드',
      palette: EYWA_PALETTES.canopy,
      sample: ['#c8a26c', '#6ba589', '#c47d8c', '#0c0e12'],
      mood: 'Stripe · Arc · 차분한 프리미엄',
      use: '대형 학원 / 결정자',
    },
  ];
  return (
    <div style={{ height: '100%', display: 'flex', background: '#0a0d0c', fontFamily: EYWA_PALETTES.bio.font }}>
      {directions.map((d) => (
        <div key={d.key} style={{
          flex: 1, padding: 28, display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
          background: d.palette.bg, color: d.palette.text, position: 'relative', overflow: 'hidden',
        }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
            <span style={{ fontSize: 48, fontWeight: 700, opacity: 0.18, lineHeight: 1, letterSpacing: -2 }}>{d.key}</span>
            <div>
              <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: -0.5 }}>{d.name}</div>
              <div style={{ fontSize: 13, color: d.palette.textDim, marginTop: 4 }}>{d.ko}</div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            {d.sample.map((c, i) => (
              <div key={i} style={{
                flex: i === 0 ? 2 : 1, height: 56, background: c, borderRadius: 4,
              }} />
            ))}
          </div>
          <div>
            <div style={{ fontSize: 13, lineHeight: 1.6, color: d.palette.textDim, marginBottom: 8 }}>{d.mood}</div>
            <div style={{ fontSize: 11, color: d.palette.textFaint, fontFamily: EYWA_PALETTES.bio.fontMono, letterSpacing: 1, textTransform: 'uppercase' }}>{d.use}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

Object.assign(window, { EYWA_PALETTES, EYWA_MENUS, EYWA_GROUPS, EYWA_DATA, EyIcon, Moodboard });
