import type { PillColor } from "@/components/atoms/pill";
import type {
  FollowUpUrgency,
  StudentConsultationCategory,
} from "@/features/consultations/server/queries";

// 학생상담 표시 메타(목록·상세 공유). ⚠️ category/audience는 코드 고정 enum(운영 enum 아님 — schema 주석 참조).
export const CATEGORY_META: Record<StudentConsultationCategory, { label: string; color: PillColor }> = {
  general: { label: "일반", color: "neutral" },
  academic: { label: "학습", color: "primary" },
  emotional: { label: "정서", color: "rose" },
  career: { label: "진로", color: "blue" },
  social: { label: "교우", color: "gold" },
  other: { label: "기타", color: "neutral" },
};

export const URGENCY_META: Record<FollowUpUrgency, { label: string; color: PillColor } | null> = {
  done: { label: "완료", color: "primary" },
  overdue: { label: "지연", color: "danger" },
  today: { label: "오늘", color: "danger" },
  soon: { label: "3일 내", color: "amber" },
  later: { label: "예정", color: "blue" },
  none: null,
};

export const AUDIENCE_LABEL: Record<string, string> = {
  parent: "학부모",
  student: "학생",
  both: "학부모+학생",
};
