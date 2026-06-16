/**
 * 랜딩 페이지 카피 데크 — 「하루의 결 (The Grain of a Day)」.
 * 하루의 타임스탬프(09:14 → 22:10)를 척추로, 한 번의 등원이 0.4초에 네 곳으로 흐르는
 * 16:02 시그니처를 절정으로 삼는 올라이트 에디토리얼 내러티브.
 * 운영 DB와 무관한 정적 마케팅 콘텐츠. 숫자는 데모 페르소나(인재원 248명)와 정합.
 */
import type { EywaIconName } from "@/components/icons/eywa-icons";

export const NAV_LINKS = [
  { label: "흐름", href: "#signature" },
  { label: "효과", href: "#roi" },
  { label: "도입 사례", href: "#voice" },
  { label: "요금", href: "#pricing" },
];

/** 16:02 시그니처 — 한 번의 등원이 동시에 흐르는 네 곳 (도착 순서·의미색) */
export const FLOW_NODES: {
  actor: string;
  color: "rose" | "blue" | "primary" | "gold";
  arrive: string;
  title: string;
  detail: string;
}[] = [
  { actor: "학부모", color: "rose", arrive: "+0.1s", title: "어머니께 등원 알림", detail: "카카오톡 · 강OO 16:02 등원" },
  { actor: "강사", color: "blue", arrive: "+0.2s", title: "출석부 자동 체크", detail: "박OO 강사 · 중2 수학 A반" },
  { actor: "원장", color: "primary", arrive: "+0.3s", title: "대시보드 갱신", detail: "오늘 출석률 94.2%로 상승" },
  { actor: "회계", color: "gold", arrive: "+0.4s", title: "수강권 1회 차감", detail: "6월 12회차 · 잔여 8회" },
];

/** 데이터 스트립 — "채우지 않아도 숫자는 채워집니다" */
export const DAY_NUMBERS: {
  value: number;
  decimals?: number;
  suffix: string;
  label: string;
  accent?: boolean;
}[] = [
  { value: 94.2, decimals: 1, suffix: "%", label: "오늘 출석률" },
  { value: 87.1, decimals: 1, suffix: "%", label: "당월 수납률" },
  { value: 31, suffix: "건", label: "상담 완료" },
  { value: 0, suffix: "건", label: "출결 누락", accent: true },
];

/** ROI 사다리 — 아낀 시간을 끝까지 계산 (LEDGER 이식) */
export const ROI_STEPS: {
  step: string;
  equation: string;
  value: number;
  group?: boolean;
  unit: string;
  note?: string;
}[] = [
  { step: "01", equation: "하루 42분 × 주 5일", value: 14, unit: "시간 / 주", note: "옮겨적기·집계·문자에 쓰던 시간" },
  { step: "02", equation: "주 14시간 × 52주", value: 728, group: true, unit: "시간 / 년" },
  { step: "03", equation: "728시간 ÷ 하루 8시간", value: 91, unit: "일", note: "꼬박 91일의 근무일" },
];

export const ROI_PAYOFF = "연 91일 분의 업무 시간";
export const ROI_FOOTNOTE =
  "* 30인 학원 기준, 개인 일정·수업·상담을 제외한 순수 행정시간 추정입니다.";

/** 12개 메뉴 — 하루의 도구 (점선 목차 / MENU_ICON 매핑).
 *  ⚠️ menu-index가 i-1의 group과 비교해 그룹 헤더를 출력하므로 group별로 연속 정렬을 유지할 것. */
export const MENU_INDEX: {
  no: string;
  name: string;
  icon: EywaIconName;
  desc: string;
  time?: string;
  group: string;
  core?: boolean;
}[] = [
  { no: "01", name: "대시보드", icon: "tree", desc: "오늘의 학원을 한눈에", time: "08:30", group: "홈", core: true },
  { no: "02", name: "시간표", icon: "leaf", desc: "강사·교시·학생을 한 장에", time: "09:00", group: "수업" },
  { no: "03", name: "출석부", icon: "pulse", desc: "학생 × 한 달, 매트릭스로", time: "16:02", group: "수업", core: true },
  { no: "04", name: "수업목록", icon: "branch", desc: "반·과목·강사를 한 곳에", time: "10:00", group: "수업" },
  { no: "05", name: "학생목록", icon: "seed", desc: "재원생 전원을 검색·필터로", time: "11:00", group: "학생", core: true },
  { no: "06", name: "등록상담", icon: "sprout", desc: "상담에서 등록까지 칸반으로", time: "14:00", group: "학생" },
  { no: "07", name: "학생상담", icon: "wave", desc: "상담 기록과 후속 관리", time: "15:00", group: "학생" },
  { no: "08", name: "퇴원관리", icon: "falling", desc: "이탈 사유를 데이터로", time: "17:00", group: "학생" },
  { no: "09", name: "직원관리", icon: "roots", desc: "강사·급여·휴가 정산", time: "13:00", group: "운영" },
  { no: "10", name: "수납관리", icon: "pollen", desc: "청구·미납·할인을 한 번에", time: "18:00", group: "운영", core: true },
  { no: "11", name: "회의록", icon: "rings", desc: "녹음하면 AI가 요약", time: "19:40", group: "운영" },
  { no: "12", name: "도움말", icon: "spore", desc: "막힐 때, 바로 옆에서", group: "지원" },
];

/** 의도적으로 뺀 탭들 — "뺀 것도 자랑" (절제 = 속도) */
export const MENU_EXCLUDED = [
  "마케팅", "셔틀관리", "자료실", "역할관리", "매출분석",
  "지출관리", "시간표배포", "알림센터", "학부모포털", "외 31개",
];

/** 단일 인터뷰 — 한 명을 깊게 (가짜 신뢰신호 폐기) */
export const TESTIMONIAL = {
  headline: "이제 퇴근길에\n단톡방을 안 봅니다.",
  body:
    "놓칠까 봐 불안했던 게 사실 제일 큰 일이었어요. 그게 사라졌습니다. 수납 누락이 월 3건에서 0건이 됐고, 상담 예약은 38% 늘었어요. 무엇보다 밤 11시에 출석부를 다시 열지 않게 됐습니다.",
  name: "김수진 원장",
  academy: "인재원수학",
  loc: "서울 강남",
  students: 248,
  months: 8,
  chips: [
    { label: "수납 누락", before: "월 3건", after: "0건" },
    { label: "상담 예약", before: null, after: "+38%" },
    { label: "밤 11시 출석부", before: "매일", after: "0회" },
  ] as { label: string; before: string | null; after: string }[],
};

/** 요금 — 베타 무료 + ROI 칼럼(되찾는 연간 시간) */
export const PRICING_PLANS: {
  name: string;
  sub: string;
  features: string[];
  roi: string;
  highlight?: boolean;
}[] = [
  {
    name: "스타터",
    sub: "시작하는 학원에",
    features: ["재원생 50명까지", "12개 메뉴 전체", "학부모 카톡 알림"],
    roi: "연 360시간",
  },
  {
    name: "프로",
    sub: "대부분의 학원에 적합",
    features: ["재원생 무제한", "AI 상담분석 월 100회", "카카오 비즈톡", "전화 지원"],
    roi: "연 728시간",
    highlight: true,
  },
  {
    name: "엔터프라이즈",
    sub: "분원·대형 학원에",
    features: ["분원 통합 관리", "AI 분석 무제한", "전담 매니저", "SLA 99.9%"],
    roi: "연 2,000시간+",
  },
];
