// 학생 상태 한글 라벨(순수, 서버/클라 공용) — UI에 raw enum(withdrawn 등) 노출 금지(사용자 반복 지적).
// 새 표시 코드는 이 모듈을 쓸 것: 미지의 코드도 최소한 그대로 노출하지 말고 라벨 폴백을 거친다.
import type { PillColor } from "@/components/atoms/pill";

export const STUDENT_STATUS_LABEL: Record<string, string> = {
  prospect: "예비",
  consulted: "상담완료",
  enrolled: "재원",
  on_hold: "휴원",
  withdrawn: "퇴원",
};

export const STUDENT_STATUS_COLOR: Record<string, PillColor> = {
  prospect: "amber",
  consulted: "blue",
  enrolled: "primary",
  on_hold: "amber",
  withdrawn: "neutral",
};

/** 상태 코드 → 한글 라벨. 미지의 코드는 raw 반환(디버그 가시성) — 표시 전 매핑 추가가 정석. */
export function studentStatusLabel(status: string | null | undefined): string | null {
  if (!status) return null;
  return STUDENT_STATUS_LABEL[status] ?? status;
}
