// Pure types + constants — safe to import from both server and client.

export type WithdrawalReason =
  | "graduated"
  | "relocation"
  | "illness"
  | "competitor"
  | "financial"
  | "schedule"
  | "dissatisfaction"
  | "grades"
  | "motivation"
  | "method"
  | "career"
  | "peers"
  | "advised"
  | "other";

export type WithdrawalConsultation = {
  adminCalledParent: boolean;
  teacherCalledParent: boolean;
  talkedWithStudent: boolean;
};

export type WithdrawalMetadata = {
  reason: WithdrawalReason;
  /** 세부 사유 키(2단계 — [`reason-detail.ts`](./reason-detail.ts)) · 고르지 않았거나 옛 퇴원이면 없음. */
  detail?: string | null;
  memo: string | null;
  consultation: WithdrawalConsultation;
};

/**
 * 사유 라벨(대분류) — 🔴 **고르는 목록의 단일 소스**(순서 = 화면 순서). 저장 액션의 허용 목록도 이 키에서 나온다(`WITHDRAWAL_REASONS`).
 * 질병·권고퇴원은 원장 2026-10-13 강사평가 퇴원율 결정(*"이사 질병 권고퇴원을 신규 퇴원항목으로 추가"*) — 강사 탓이 아닌 퇴원을 가른다.
 * 성적·학생 상태·공부 방법 변경·진로·진학·가족·친구는 원장 2026-10-15 사유 2단계 세분화(세부 = [`reason-detail.ts`](./reason-detail.ts)).
 * 🔴 새 키는 **영문 소문자만**(강사평가 '뺄 사유' 저장 검사 `^[a-z]{1,20}$`) · 퇴원보고서 DB 함수의 사유 목록도 함께 늘린다(0367a).
 * ⚠️ 옛 라벨(`수업 불만족`·`시간/일정 조정`)은 `LEGACY_REASON_LABELS`로 키를 찾는다 — 글로 저장된 옛 사유가 자유 글로 새지 않게.
 */
export const REASON_LABEL: Record<WithdrawalReason, string> = {
  dissatisfaction: "수업·강사",
  grades: "성적",
  motivation: "학생 상태",
  method: "공부 방법 변경",
  competitor: "타 학원으로 이동",
  schedule: "시간/일정",
  financial: "경제적 이유",
  career: "진로·진학",
  peers: "가족·친구",
  illness: "질병",
  advised: "권고퇴원",
  relocation: "이사",
  graduated: "졸업",
  other: "기타",
};
/** 바꾸기 전 라벨 → 키(2026-10-15 이름 정리). 글로 남은 옛 사유를 키로 읽는 데만 쓴다(고르는 목록엔 안 선다). */
export const LEGACY_REASON_LABELS: Readonly<Record<string, WithdrawalReason>> = {
  "수업 불만족": "dissatisfaction",
  "시간/일정 조정": "schedule",
};
/** 저장 액션이 받는 사유 코드 — 라벨 표의 키 그대로(목록을 따로 적지 않는다). */
export const WITHDRAWAL_REASONS = Object.keys(REASON_LABEL) as WithdrawalReason[];

/**
 * 같은 사유의 영어 라벨 — **강사뷰 영어 화면 전용**(원장 2026-09-03 "모든 곳을 en 전환").
 *
 * 🔴 한글 표 **바로 옆**에 둔다(출결 라벨과 같은 규약) — 파일을 나누면 사유가 하나 늘 때 한쪽만
 *    채워지고, 빠진 키는 raw enum(`dissatisfaction`)이 화면에 그대로 샌다.
 * ⚠️ 자유 텍스트 사유("반 이동")는 **번역하지 않는다** — 사람이 쓴 사실이라 옮기면 그 자리에서 뜻이 바뀐다.
 */
export const REASON_LABEL_EN: Record<WithdrawalReason, string> = {
  dissatisfaction: "Lessons / teacher",
  grades: "Grades",
  motivation: "Student condition",
  method: "Changed study method",
  competitor: "Moved to another academy",
  schedule: "Schedule",
  financial: "Financial reasons",
  career: "Career / next school",
  peers: "Family / friends",
  illness: "Illness",
  advised: "Advised to leave",
  relocation: "Moved away",
  graduated: "Graduated",
  other: "Other",
};

/**
 * 마이그레이션/외부 데이터의 사유 코드 표기 흔들림을 표준 enum으로 흡수.
 * (예: ijw 데이터는 "dissatisfied"를 쓰는데 우리 enum은 "dissatisfaction".)
 */
export const REASON_ALIAS: Readonly<Record<string, WithdrawalReason>> = {
  dissatisfied: "dissatisfaction",
  unsatisfied: "dissatisfaction",
  moved: "relocation",
  graduate: "graduated",
  cost: "financial",
  money: "financial",
};

/** 임의 문자열 → 표준 WithdrawalReason. 빈 값은 null, 미지의 비-빈 코드는 "other". */
export function normalizeReason(raw: string | null | undefined): WithdrawalReason | null {
  if (!raw) return null;
  if (raw in REASON_LABEL) return raw as WithdrawalReason;
  return REASON_ALIAS[raw] ?? "other";
}

/** 항상 비지 않은 한글 라벨을 보장 (undefined 키/빈 라벨 방지). */
export function reasonLabel(raw: string | null | undefined): string {
  const norm = normalizeReason(raw);
  return norm ? REASON_LABEL[norm] : "미기재";
}

/**
 * 표시용: 표준 사유 키(other/graduated…)만 한글 라벨로, 자유 텍스트(예 "반 이동")는 **그대로** 둔다.
 * ⚠️ `reasonLabel`은 normalizeReason이 미지 코드를 "other"로 뭉개 "반 이동" 같은 실사유를
 * "기타"로 덮으므로, 이미 사람이 읽을 수 있는 사유를 보존해야 하는 표시엔 이걸 쓴다. 빈 값=null.
 */
export function reasonDisplay(raw: string | null | undefined, lang: "ko" | "en" = "ko"): string | null {
  if (!raw) return null;
  // 🔴 영어 표가 그 키를 모르면 한글로 떨어진다(사전 폴백 규약) — 빈 값·raw enum보다 낫다.
  const table = lang === "en" ? REASON_LABEL_EN : REASON_LABEL;
  const known = (table as Record<string, string>)[raw] ?? (REASON_LABEL as Record<string, string>)[raw];
  if (known) return known;
  // ⚠️ 임포트 표기 흔들림(dissatisfied·moved…)도 한글로 — 표준 키가 아니라는 이유로 **영문 raw 코드를
  // 화면에 흘리면 안 된다**(실측 injaewon: dissatisfied 5건이 그대로 노출되고 있었다).
  const alias = REASON_ALIAS[raw];
  if (alias) return table[alias] ?? REASON_LABEL[alias];
  return raw; // 자유 텍스트("반 이동")는 보존 — 여기가 reasonLabel('기타'로 뭉갬)과 갈리는 지점.
}

export const DEFAULT_WITHDRAWAL_METADATA: WithdrawalMetadata = {
  reason: "other",
  memo: null,
  consultation: {
    adminCalledParent: false,
    teacherCalledParent: false,
    talkedWithStudent: false,
  },
};
