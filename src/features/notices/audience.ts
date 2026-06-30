import type { SystemRole } from "@/lib/permissions";

export const POPUP_AUDIENCES = ["all", "staff", "teachers", "counselors", "accounting"] as const;
export type PopupAudience = (typeof POPUP_AUDIENCES)[number];

export const AUDIENCE_LABEL: Record<PopupAudience, string> = {
  all: "전체",
  staff: "전 직원",
  teachers: "강사",
  counselors: "상담사",
  accounting: "회계",
};

export const POPUP_POSITIONS = [
  "cascade",
  "center",
  "left-top",
  "right-top",
  "left-bottom",
  "right-bottom",
] as const;
export type PopupPosition = (typeof POPUP_POSITIONS)[number];

export const POSITION_LABEL: Record<PopupPosition, string> = {
  cascade: "자동 (중앙 그리드)",
  center: "중앙",
  "left-top": "좌상단",
  "right-top": "우상단",
  "left-bottom": "좌하단",
  "right-bottom": "우하단",
};

/**
 * 공지 청중(audience)이 이 역할에게 보여야 하는가. 순수 함수(서버·클라 공용).
 * 'staff'=학생 외 전 직원, 나머지는 해당 시스템 역할에 직접 매핑.
 */
export function audienceMatchesRole(audience: string, role: SystemRole): boolean {
  switch (audience) {
    case "all":
      return true;
    case "staff":
      return role !== "student";
    case "teachers":
      return role === "teacher";
    case "counselors":
      return role === "counselor";
    case "accounting":
      return role === "accountant";
    default:
      return true;
  }
}
