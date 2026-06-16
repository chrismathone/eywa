// Pure types + constants — safe to import from both server and client.

export type WithdrawalReason =
  | "graduated"
  | "relocation"
  | "competitor"
  | "financial"
  | "schedule"
  | "dissatisfaction"
  | "other";

export type WithdrawalConsultation = {
  adminCalledParent: boolean;
  teacherCalledParent: boolean;
  talkedWithStudent: boolean;
};

export type WithdrawalMetadata = {
  reason: WithdrawalReason;
  memo: string | null;
  consultation: WithdrawalConsultation;
};

export const REASON_LABEL: Record<WithdrawalReason, string> = {
  graduated: "졸업",
  relocation: "이사",
  competitor: "타 학원으로 이동",
  financial: "경제적 이유",
  schedule: "시간/일정 조정",
  dissatisfaction: "수업 불만족",
  other: "기타",
};

/**
 * 마이그레이션/외부 데이터의 사유 코드 표기 흔들림을 표준 enum으로 흡수.
 * (예: ijw 데이터는 "dissatisfied"를 쓰는데 우리 enum은 "dissatisfaction".)
 */
const REASON_ALIAS: Record<string, WithdrawalReason> = {
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

export const DEFAULT_WITHDRAWAL_METADATA: WithdrawalMetadata = {
  reason: "other",
  memo: null,
  consultation: {
    adminCalledParent: false,
    teacherCalledParent: false,
    talkedWithStudent: false,
  },
};
