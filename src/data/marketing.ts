/**
 * 랜딩 페이지 전용 정적 콘텐츠 — 시안 DATA.md 기반.
 * 운영 DB(Supabase)와 무관. 마케팅 카피·고객사·테스티모니얼은
 * 자주 바뀌므로 정적 모듈로 관리.
 */

export const ACADEMY_TILES: {
  name: string;
  loc: string;
  students: number;
  span: number;
  accent?: boolean;
}[] = [
  { name: "청솔학원", loc: "경기 분당", students: 312, span: 4, accent: true },
  { name: "MS어학원", loc: "경기 일산", students: 187, span: 3 },
  { name: "명문국어", loc: "서울 강남", students: 240, span: 5 },
  { name: "수림수학", loc: "서울 잠실", students: 198, span: 3 },
  { name: "하이클래스", loc: "서울 목동", students: 156, span: 4 },
  { name: "에듀온", loc: "부산 해운대", students: 421, span: 5, accent: true },
  { name: "베스트영어", loc: "대구 수성", students: 168, span: 3 },
  { name: "인재원", loc: "서울 강남", students: 248, span: 3 },
  { name: "드림에듀", loc: "대전 둔산", students: 134, span: 3 },
  { name: "큐브어학원", loc: "광주 상무", students: 92, span: 3 },
];

export const LIVE_COUNTERS = [
  { label: "오늘 출석 체크", value: "12,847", sub: "실시간 누적", color: "primary" as const },
  { label: "학부모 알림 발송", value: "8,326", sub: "카톡 + 푸시", color: "blue" as const },
  { label: "진행 중 상담", value: "142", sub: "17개 학원", color: "purple" as const },
  { label: "함께하는 학원", value: "47", sub: "전국", color: "gold" as const },
];

export const FLOW_OUTCOMES: { tag: string; body: string; color: "gold" | "primary" | "blue" | "purple" }[] = [
  { tag: "→ 학부모", body: "카카오톡으로 등원 알림이 즉시 전송됩니다.", color: "gold" },
  { tag: "→ 강사", body: "담당 강사의 출석부에 자동으로 체크됩니다.", color: "primary" },
  { tag: "→ 원장", body: "대시보드 출석률 KPI가 실시간으로 갱신됩니다.", color: "blue" },
  { tag: "→ 회계", body: "수업 잔여 차감과 수강료 처리가 자동으로 이루어집니다.", color: "purple" },
];

export const MANIFESTO_PROMISES: {
  no: string;
  title: string;
  body: string;
  color: "primary" | "gold" | "blue" | "purple" | "rose";
  span: number;
}[] = [
  {
    no: "01",
    title: "운영은 쉽게, 교육은 깊게.",
    body: "청구서 자동 생성, 미납 관리, 출결 체크, 상담 기록까지\n매일 반복되는 일은 EYWA가 합니다.",
    color: "primary",
    span: 3,
  },
  {
    no: "02",
    title: "더 많은 기능이 아닌, 더 깊은 이해.",
    body: "학부모와 진짜로 소통하고 강사와 매끄럽게 연결됩니다.\n학원 운영을 진심으로 이해하는 도구.",
    color: "gold",
    span: 3,
  },
  {
    no: "03",
    title: "원장님의 한마디가 로드맵.",
    body: "실제로 운영해본 원장님의 제안만이\n다음 버전의 EYWA를 만듭니다.",
    color: "blue",
    span: 2,
  },
  {
    no: "04",
    title: "처음부터 끝까지 함께.",
    body: "학생 한 명으로 시작할 때도, 분원을 늘릴 때도,\nEYWA는 같은 자리에서 같은 약속을 지킵니다.",
    color: "purple",
    span: 2,
  },
  {
    no: "05",
    title: "중요한 일에 집중할 수 있도록.",
    body: "수업, 상담, 마케팅. 학원을 키우는 일에 집중하세요.\n나머지는 EYWA에게 맡기세요.",
    color: "rose",
    span: 2,
  },
];

export const TESTIMONIAL_FEATURED = {
  quote:
    "EYWA를 도입한 이후 출결 관리가 완전히 달라졌습니다. 예전엔 수기로 체크하느라 시간도 많이 들고 누락도 잦았는데, 이제는 학생이 등원만 해도 자동으로 출결이 기록되고 학부모에게 알림이 바로 전송됩니다.",
  name: "김수진 원장",
  academy: "새봄가우스 수학학원",
  loc: "경기 남양주",
  metric: {
    label: "도입 효과",
    value: "28%",
    sub: "월 평균 행정시간 감소",
    note: "6개월 실측 평균",
    rows: [
      ["출결 누락", "0건"],
      ["학부모 항의", "-80%"],
      ["신규 등록 전환", "+17pt"],
    ] as [string, string][],
  },
};

export const TESTIMONIAL_OTHERS = [
  {
    quote:
      "자동청구서 기능 덕분에 매달 청구 업무가 간단해졌습니다. 수강료가 자동 계산되어 청구되니 실수가 줄고, 학부모도 청구 내역을 명확히 확인할 수 있습니다.",
    name: "박정호 원장",
    academy: "바른스터디",
    loc: "서울 강북구",
  },
  {
    quote:
      "출결앱과 학부모앱을 추가 비용 없이 사용할 수 있어 부담이 없었습니다. 학부모가 자녀의 출결과 알림을 직접 확인할 수 있어 신뢰가 높아졌습니다.",
    name: "이연우 원장",
    academy: "티클래스 호평",
    loc: "경기 남양주",
  },
  {
    quote:
      "상담 내용이 AI로 자동 정리되고, 필요한 안내는 바로 메시지로 전달할 수 있어 업무 효율이 매끄럽습니다. 학부모 응대가 훨씬 수월해졌습니다.",
    name: "정민호 원장",
    academy: "유클리드",
    loc: "경기 의정부",
  },
];

export const PRICING_PLANS: {
  name: string;
  sub: string;
  features: string[];
  highlight?: boolean;
}[] = [
  {
    name: "스타터",
    sub: "시작하는 학원에",
    features: ["재원생 50명까지", "12개 메뉴 전체", "학부모 카톡 알림"],
  },
  {
    name: "프로",
    sub: "대부분의 학원에 적합",
    features: ["재원생 무제한", "AI 상담분석 월 100회", "카카오 비즈톡", "전화 지원"],
    highlight: true,
  },
  {
    name: "엔터프라이즈",
    sub: "대형 · 분원 학원에",
    features: ["분원 통합 관리", "AI 분석 무제한", "전담 매니저", "SLA 99.9%"],
  },
];

export const NAV_LINKS = [
  { label: "기능 소개", href: "#flow" },
  { label: "요금 안내", href: "#pricing" },
  { label: "도입 사례", href: "#testimonials" },
  { label: "고객 지원", href: "#cta" },
  { label: "회사 소개", href: "#footer" },
];
