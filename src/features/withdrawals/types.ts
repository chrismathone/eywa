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

export const DEFAULT_WITHDRAWAL_METADATA: WithdrawalMetadata = {
  reason: "other",
  memo: null,
  consultation: {
    adminCalledParent: false,
    teacherCalledParent: false,
    talkedWithStudent: false,
  },
};
