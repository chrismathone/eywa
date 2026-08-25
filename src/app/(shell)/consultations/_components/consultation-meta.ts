import type { PillColor } from "@/components/atoms/pill";
import type {
  FollowUpUrgency,
  StudentConsultationCategory,
} from "@/features/consultations/server/queries";
import {
  CONSULTATION_AUDIENCE_LABEL,
  CONSULTATION_CATEGORY_LABEL,
} from "@/features/consultations/labels";

// 학생상담 표시 메타(목록·상세 공유). ⚠️ category/audience는 코드 고정 enum(운영 enum 아님 — schema 주석 참조).
// 🔴 **라벨(말)은 여기서 정하지 않는다** — 감사로그 상세도 같은 어휘를 써야 해서 단일 소스는
//    [labels.ts](src/features/consultations/labels.ts)다. 여기는 그 라벨에 **색만** 붙인다.
export const CATEGORY_META: Record<StudentConsultationCategory, { label: string; color: PillColor }> = {
  general: { label: CONSULTATION_CATEGORY_LABEL.general, color: "neutral" },
  academic: { label: CONSULTATION_CATEGORY_LABEL.academic, color: "primary" },
  emotional: { label: CONSULTATION_CATEGORY_LABEL.emotional, color: "rose" },
  career: { label: CONSULTATION_CATEGORY_LABEL.career, color: "purple" },
  social: { label: CONSULTATION_CATEGORY_LABEL.social, color: "gold" },
  other: { label: CONSULTATION_CATEGORY_LABEL.other, color: "neutral" },
};

export const URGENCY_META: Record<FollowUpUrgency, { label: string; color: PillColor } | null> = {
  done: { label: "완료", color: "green" },
  overdue: { label: "지연", color: "danger" },
  today: { label: "오늘", color: "danger" },
  soon: { label: "3일 내", color: "amber" },
  later: { label: "예정", color: "blue" },
  none: null,
};

export const AUDIENCE_LABEL = CONSULTATION_AUDIENCE_LABEL;
