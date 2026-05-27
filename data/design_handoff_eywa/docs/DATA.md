# 시드 데이터

> 구현 시 그대로 사용 가능한 데모/시드 데이터.
> 정확한 정의는 `design-files/eywa-shared.jsx`의 `EYWA_DATA` 객체 참조.

---

## 1. 회사 / 학원

```ts
const ACADEMY = {
  name: '인재원',
  branch: '강남',
  director: '김수진',
  experience: '28년차',
  totalStudents: 248,
  totalTeachers: 8,
};
```

---

## 2. KPI (대시보드)

```ts
const KPIS = [
  { id: 'students', label: '재원생',       value: 248,   unit: '명',  delta: '+12',     up: true,  helper: '신규 14 · 퇴원 2',
    spark: [232, 234, 235, 238, 240, 244, 246, 248] },
  { id: 'attend',   label: '오늘 출석률',   value: '94.2', unit: '%',  delta: '+1.8pt',  up: true,  helper: '234/248 · 결석 9 · 지각 5',
    spark: [88, 91, 89, 92, 93, 94, 92, 94] },
  { id: 'pay',      label: '이번달 수납률', value: '87.1', unit: '%',  delta: '-2.4pt',  up: false, helper: '216/248건 · 미수 32',
    spark: [82, 84, 86, 88, 91, 90, 88, 87] },
  { id: 'consult',  label: '진행중 상담',   value: 11,    unit: '건',  delta: '+3',     up: true,  helper: '신규 7 · AI 분석 대기 4',
    spark: [5, 6, 7, 8, 8, 10, 10, 11] },
];
```

---

## 3. 오늘의 일정 (6건)

```ts
const EVENTS = [
  { id: 'e1', time: '13:00', end: '14:30', type: 'class',    title: '중2 수학 심화 A반',  ctx: '강민서 외 11명 · 박지훈 강사', room: '301호', status: 'done',     mins: 90 },
  { id: 'e2', time: '14:40', end: '15:40', type: 'consult',  title: '윤소율 학부모 등록상담', ctx: '예비 중1 · AI 분석 완료 · 김상담',  status: 'done',     mins: 60 },
  { id: 'e3', time: '16:00', end: '17:30', type: 'class',    title: '고1 영어 정규 B반',  ctx: '정수아 외 9명 · 이연우 강사',   room: '205호', status: 'ongoing',  mins: 90 },
  { id: 'e4', time: '17:40', end: '18:40', type: 'consult',  title: '이도현 학생 진로상담', ctx: '고2 · 담임 박지훈',              status: 'upcoming', mins: 60 },
  { id: 'e5', time: '19:00', end: '20:30', type: 'class',    title: '중3 수학 심화 C반',  ctx: '한지우 외 13명 · 박지훈 강사', room: '301호', status: 'upcoming', mins: 90 },
  { id: 'e6', time: '20:30', end: '21:00', type: 'meeting',  title: '주간 강사 회의',     ctx: '전 강사 · 회의실',                status: 'upcoming', mins: 30 },
];

// status: 'done' | 'ongoing' | 'upcoming'
// type:   'class' | 'consult' | 'meeting'
```

---

## 4. 공지 (3건)

```ts
const ANNOUNCEMENTS = [
  { id: 'a1', tag: '공지',   title: '7월 시험 일정 확정',                  when: '2시간 전',  author: '김수진 원장' },
  { id: 'a2', tag: '시스템', title: 'EYWA 시스템 점검 — 일 02:00~03:00',  when: '어제',     author: '운영팀' },
  { id: 'a3', tag: '인사',   title: '신규 강사 박지원 7/15 출근',          when: '3일 전',    author: '인사' },
];
```

---

## 5. 학생 (시드 10명 — 출석부/학생목록 공통)

```ts
const STUDENTS = [
  { name: '강민서', grade: '중2',     cls: '수학 심화 A',   joined: '2024.03', parent: '강아빠 · 010-2345-1234', ai: '활발' },
  { name: '윤소율', grade: '중2',     cls: '수학 심화 A',   joined: '2024.09', parent: '윤엄마 · 010-3456-2345', ai: '집중' },
  { name: '이도현', grade: '고2',     cls: '국어 정규',     joined: '2023.01', parent: '이아빠 · 010-4567-3456', ai: '주의' },
  { name: '정수아', grade: '고1',     cls: '영어 정규 B',   joined: '2024.06', parent: '정엄마 · 010-5678-4567', ai: '활발' },
  { name: '한지우', grade: '중3',     cls: '수학 심화 C',   joined: '2023.09', parent: '한엄마 · 010-6789-5678', ai: '안정' },
  { name: '박서진', grade: '중2',     cls: '수학 심화 A',   joined: '2024.03', parent: '박아빠 · 010-7890-6789', ai: '안정' },
  { name: '최예준', grade: '고1',     cls: '영어 정규 B',   joined: '2024.06', parent: '최엄마 · 010-8901-7890', ai: '활발' },
  { name: '신아린', grade: '예비중1', cls: '예비 중1 수학', joined: '2026.05', parent: '신엄마 · 010-9012-8901', ai: '신규' },
  { name: '김도윤', grade: '중2',     cls: '수학 심화 A',   joined: '2024.03', parent: '김엄마',                ai: '안정' },
  { name: '장유나', grade: '중2',     cls: '수학 심화 A',   joined: '2024.03', parent: '장아빠',                ai: '주의' },
];
```

### 출석 마크 (5/25 — 5/30)

```
강민서  O O O O O -    100%
윤소율  O L O O O -     93%
이도현  O O O X O -     86%
한지우  O O O O O -    100%
정수아  L O O O L -     86%
김도윤  O O X O O -     86%
박서진  O O O O O -    100%
최예준  O L O O O -     93%
신아린  O O O O O -    100%
장유나  X X O O O -     60%

O = 출석 (primarySoft + primary)
X = 결석 (dangerSoft + danger)
L = 지각 (amberSoft + amber)
- = 휴일/N/A (textFaint)
```

---

## 6. 반 (시드 6개)

```ts
const CLASSES = [
  { name: '중2 수학 심화 A',  grade: '중2',      subject: '수학', teacher: '박지훈', students: 12, cap: 14, days: '월수금', time: '14:00 – 15:30', room: '301호', color: 'primary', status: '진행중' },
  { name: '중3 수학 심화 C',  grade: '중3',      subject: '수학', teacher: '박지훈', students: 14, cap: 14, days: '화수목', time: '19:00 – 20:30', room: '301호', color: 'primary', status: '진행중' },
  { name: '고1 영어 정규 B',  grade: '고1',      subject: '영어', teacher: '이연우', students: 10, cap: 12, days: '월수금', time: '16:00 – 17:30', room: '205호', color: 'blue',    status: '진행중' },
  { name: '고2 국어 정규',     grade: '고2',      subject: '국어', teacher: '최보라', students: 8,  cap: 12, days: '화목',    time: '18:00 – 19:30', room: '404호', color: 'purple',  status: '진행중' },
  { name: '주말 보강반',      grade: '전체',     subject: '특강', teacher: '박지훈', students: 24, cap: 30, days: '토',      time: '10:00 – 13:00', room: '301호', color: 'gold',    status: '진행중' },
  { name: '예비 중1 수학',    grade: '예비중1',  subject: '수학', teacher: '박지원', students: 6,  cap: 14, days: '월화수', time: '17:00 – 18:00', room: '202호', color: 'primary', status: '모집중' },
];
```

---

## 7. 등록상담 세션 (시드 4건)

```ts
const ENROLLMENT_SESSIONS = [
  { name: '윤소율 학부모', grade: '예비 중1', date: '5/27 14:40', dur: '12:36', status: 'ai-done',    counselor: '김상담', recommend: '수학 심화 A + 영어 정규 C' },
  { name: '오현우 학부모', grade: '중2',     date: '5/27 16:00', dur: '08:14', status: 'ai-pending', counselor: '박지훈', recommend: 'AI 분석 대기 (큐 3/5)' },
  { name: '강민지 학부모', grade: '고1',     date: '5/26 11:00', dur: '15:42', status: 'ai-done',    counselor: '이연우', recommend: '영어 정규 B + 국어 정규' },
  { name: '서지호 학부모', grade: '예비 중1', date: '5/26 09:30', dur: '11:20', status: 'enrolled',  counselor: '김상담', recommend: '등록 완료 · 6/3 첫 수업' },
];

// status: 'ai-done' | 'ai-pending' | 'enrolled'
```

### AI 분석 결과 (윤소율 학부모)

```ts
const FEATURED_AI = {
  meta: { engine: 'Claude', confidence: 0.92, timestamp: '2026.05.27 14:55' },
  학습스타일: '시각적 학습 선호. 반복보다 이해 중심. 또래와의 협력 학습 효과적.',
  관심사: '수학 약함 · 영어 강함 · 책 읽기 좋아함',
  우려사항: '새 환경 적응에 2-3주 필요. 강사와 친밀감 형성이 중요.',
  AI제안: '수학 심화 A반 + 영어 정규 C반',
};
```

---

## 8. 학생상담 칸반 (시드)

```ts
const CONSULTATION_KANBAN = {
  pending: [    // gold · 4건
    { name: '윤소율', issue: '학습 태도 점검',      when: '오늘 17:40' },
    { name: '한지우', issue: '학부모 요청 면담',    when: '내일 14:00' },
    { name: '신아린', issue: '신규생 적응',         when: '5/30' },
  ],
  active: [    // primary · 5건
    { name: '이도현', issue: '진로 고민 · 의대 vs 공대', when: 'AI 분석 완료', flag: 'hot' },
    { name: '정수아', issue: '성적 하락 · 영어 -8점',     when: '면담 필요',     flag: 'urgent' },
    { name: '강민서', issue: '집중도 저하 관찰',           when: '4일째' },
  ],
  done: [    // textDim · 6건 (이번 주)
    { name: '박서진', issue: '교우 관계', when: '5/26 완료' },
    { name: '최예준', issue: '학습 동기', when: '5/25 완료' },
    { name: '김도윤', issue: '시간 관리', when: '5/24 완료' },
  ],
};
```

---

## 9. 퇴원 (시드 4건)

```ts
const WITHDRAWALS = [
  { name: '최서윤', grade: '고2', reason: '입시학원 이전',                date: '2026.05.20', duration: '14개월', recoverable: false },
  { name: '박지원', grade: '중3', reason: '성적 정체 · 만족도 하락',       date: '2026.05.15', duration: '8개월',  recoverable: true  },
  { name: '윤민호', grade: '고1', reason: '경제 사정',                    date: '2026.05.08', duration: '22개월', recoverable: true  },
  { name: '이지안', grade: '중2', reason: '이사',                         date: '2026.04.30', duration: '6개월',  recoverable: false },
];

// 사유 분포 (올해 누적 24건)
const WITHDRAWAL_REASONS = [
  { label: '입시학원 이전', count: 8, pct: 33, color: 'primary' },
  { label: '경제 사정',     count: 5, pct: 21, color: 'gold' },
  { label: '이사',           count: 4, pct: 17, color: 'blue' },
  { label: '성적 정체',     count: 4, pct: 17, color: 'amber' },
  { label: '기타',           count: 3, pct: 12, color: 'textDim' },
];

// AI 인사이트
const WITHDRAWAL_AI = '"성적 정체" 사유 4건은 모두 도입 12개월 차에 발생. 1년차 학습 만족도 점검 추천.';
```

---

## 10. 직원 (시드 6명)

```ts
const STAFF = [
  { name: '박지훈', role: '수학 강사 · 부원장',   tenure: '7년차',  classes: 8, students: 84, pay: '320만', status: 'on',  color: 'primary' },
  { name: '이연우', role: '영어 강사',             tenure: '4년차',  classes: 6, students: 62, pay: '280만', status: 'on',  color: 'blue' },
  { name: '최보라', role: '국어 강사',             tenure: '3년차',  classes: 4, students: 38, pay: '250만', status: 'on',  color: 'purple' },
  { name: '김상담', role: '상담실장',               tenure: '5년차',  classes: 0, students: 0,  pay: '260만', status: 'on',  color: 'gold' },
  { name: '박지원', role: '수학 강사 · 신입',       tenure: '1개월',  classes: 2, students: 14, pay: '180만', status: 'on',  color: 'primary' },
  { name: '정유진', role: '행정',                   tenure: '2년차',  classes: 0, students: 0,  pay: '220만', status: 'off', color: 'textDim' },
];

// 합계
const STAFF_TOTAL = {
  total: 8, working: 7, off: 1,
  totalPay: '2,140만',
  avgTenure: '3.2년',
};
```

---

## 11. 수납 (시드 8건)

```ts
const BILLING = [
  { name: '강민서', cls: '수학 심화 A',   period: '2026.06', amount: 352000, due: '2026.06.05', status: 'paid',     paidAt: '2026.05.30' },
  { name: '윤소율', cls: '수학 심화 A',   period: '2026.06', amount: 288000, due: '2026.06.05', status: 'paid',     paidAt: '2026.05.31' },
  { name: '이도현', cls: '국어 정규',     period: '2026.06', amount: 352000, due: '2026.06.05', status: 'due',      paidAt: null },
  { name: '정수아', cls: '영어 정규 B',   period: '2026.06', amount: 420000, due: '2026.05.20', status: 'overdue',  paidAt: null, overdueDays: 7 },
  { name: '한지우', cls: '수학 심화 C',   period: '2026.06', amount: 352000, due: '2026.06.05', status: 'paid',     paidAt: '2026.06.01' },
  { name: '박서진', cls: '수학 심화 A',   period: '2026.06', amount: 352000, due: '2026.06.05', status: 'due',      paidAt: null },
  { name: '최예준', cls: '영어 정규 B',   period: '2026.06', amount: 420000, due: '2026.05.25', status: 'overdue',  paidAt: null, overdueDays: 2 },
  { name: '신아린', cls: '예비 중1 수학', period: '2026.06', amount: 240000, due: '2026.06.10', status: 'paid',     paidAt: '2026.06.02' },
];

const BILLING_SUMMARY = {
  totalRequested: 87540000,  // 8,754만
  totalPaid:      76120000,  // 7,612만 (87.1%)
  totalPending:    8800000,  // 880만 (23건)
  totalOverdue:    2620000,  // 262만 (9건 · 평균 4일)
};
```

---

## 12. 회의록 (시드 4건)

```ts
const MEETINGS = [
  { title: '주간 강사 회의',       date: '2026.05.27 20:30', dur: '32:14', attendees: ['박지훈','이연우','최보라','김상담','박지원'], status: 'ai-done',   actions: 4 },
  { title: '신입생 적응 점검',     date: '2026.05.26 11:00', dur: '18:42', attendees: ['김상담','박지훈'],                              status: 'ai-done',   actions: 2 },
  { title: '6월 시험 일정 조율',   date: '2026.05.24 16:30', dur: '24:08', attendees: ['박지훈','이연우','최보라'],                     status: 'recording', actions: 0 },
  { title: '5월 마감 회의',         date: '2026.05.20 19:00', dur: '45:36', attendees: ['전체'],                                          status: 'ai-done',   actions: 7 },
];

// status: 'ai-done' | 'recording' | 'ai-pending'
```

### 주간 강사 회의 AI 요약 (시드)

```ts
const MEETING_AI_SUMMARY = {
  meta: { confidence: 0.94, speakers: 5, duration: '32m 14s' },
  decisions: [
    '6월 시험 일정 6/14 토 확정',
    '고1 영어 정규 B반 → C반 분반 검토',
    '신입 강사 박지원 → 중1 수학 보조 배정',
  ],
  actions: [
    { who: '박지훈', what: '6/14 시험 출제 일정 공유',        due: '5/30', done: true  },
    { who: '이연우', what: 'B반 분반 시뮬레이션 검토',         due: '6/3',  done: false },
    { who: '김상담', what: '학부모 시험 안내 카톡 작성',       due: '6/1',  done: false },
    { who: '박지원', what: '중1 수학 교재 검토 보고',           due: '6/5',  done: false },
  ],
};
```

---

## 13. 도움말

### 가이드 카테고리 (6개)
```ts
const HELP_GUIDES = [
  { title: '시작하기',       items: 8,  icon: 'sprout',  color: 'primary', desc: '5분 안에 EYWA를 설정하는 법' },
  { title: '학생 등록',       items: 12, icon: 'seed',    color: 'blue',    desc: '신규/예비 학생 추가, 일괄 가져오기' },
  { title: '시간표 짜기',     items: 6,  icon: 'leaf',    color: 'purple',  desc: '드래그로 반 이동, 충돌 자동 감지' },
  { title: '출결과 알림',     items: 9,  icon: 'pulse',   color: 'amber',   desc: '카톡 알림 설정, 일괄 체크' },
  { title: '수납 관리',       items: 14, icon: 'pollen',  color: 'gold',    desc: '청구서 발행, 미납 독촉, 영수증' },
  { title: 'AI 분석 활용',   items: 7,  icon: 'sparkle', color: 'primary', desc: '등록상담 · 케어 · 회의록 요약' },
];
```

### 단축키
```ts
const SHORTCUTS = [
  ['⌘ K',  '전역 검색'],
  ['⌘ N',  '새 학생 추가'],
  ['⌘ /',  '단축키 도움말'],
  ['G + D', '대시보드로'],
  ['G + S', '학생목록으로'],
  ['G + B', '수납관리로'],
];
```

### FAQ
```ts
const FAQS = [
  { q: 'AI 상담분석은 어떻게 작동하나요?',
    a: 'Anthropic Claude API로 녹음·메모를 분석해 학습 스타일·관심사·우려를 요약합니다. 한 번 생성된 분석은 동결되어 모델이 바뀌어도 인쇄물이 변하지 않습니다.' },
  { q: '데이터는 안전한가요?',
    a: 'Supabase Postgres + RLS로 운영합니다. 모든 테이블에 tenant_id가 있어 학원간 데이터 노출이 원천 차단됩니다.' },
  { q: '기존 ijw-calander 데이터를 옮길 수 있나요?',
    a: '네, 무료 마이그레이션을 제공합니다. Firestore에서 학생·반·결제·출석 데이터를 Supabase로 옮기는 데 평균 3일 소요됩니다.' },
];
```

---

## 14. 랜딩 페이지 — 학원 목록 (LogoWall · 시드 10개)

```ts
const LOGO_WALL_TILES = [
  { name: '청솔학원',  loc: '경기 분당',    students: 312, span: 4, accent: true },
  { name: 'MS어학원',  loc: '경기 일산',    students: 187, span: 3 },
  { name: '명문국어',  loc: '서울 강남',    students: 240, span: 5 },
  { name: '수림수학',  loc: '서울 잠실',    students: 198, span: 3 },
  { name: '하이클래스', loc: '서울 목동',    students: 156, span: 4 },
  { name: '에듀온',    loc: '부산 해운대',  students: 421, span: 5, accent: true },
  { name: '베스트영어', loc: '대구 수성',    students: 168, span: 3 },
  { name: '인재원',    loc: '서울 강남',    students: 248, span: 3 },
  { name: '드림에듀',  loc: '대전 둔산',    students: 134, span: 3 },
  { name: '큐브어학원', loc: '광주 상무',    students: 92,  span: 3 },
];

// 라이브 카운터
const LIVE_COUNTERS = [
  { label: '오늘 출석 체크',    value: '12,847', sub: '실시간 누적',  color: 'primary' },
  { label: '학부모 알림 발송',  value: '8,326',  sub: '카톡 + 푸시',  color: 'blue'    },
  { label: '진행 중 상담',      value: '142',    sub: '17개 학원',    color: 'purple'  },
  { label: '함께하는 학원',     value: '47',     sub: '전국',          color: 'gold'    },
];
```

---

## 15. 분기 추이 (트렌드)

```ts
const QUARTERLY_TREND = {
  label: '이번 분기 재원생 추이',
  points: [180, 195, 201, 210, 218, 225, 232, 240, 244, 246, 247, 248],
  months: ['1월','','2월','','3월','','4월','','5월','','6월','7월'],
};
```
