import type { SystemRole } from "@/lib/permissions";

/** 팝업 공지와 오늘 화면 공지가 함께 쓰는 대상 단일 소스. */
export const NOTICE_AUDIENCES = ["all", "staff", "office", "teachers", "counselors", "accounting"] as const;
export type NoticeAudience = (typeof NOTICE_AUDIENCES)[number];

/** @deprecated 새 코드에서는 NOTICE_AUDIENCES/NoticeAudience를 사용한다. */
export const POPUP_AUDIENCES = NOTICE_AUDIENCES;
/** @deprecated 새 코드에서는 NoticeAudience를 사용한다. */
export type PopupAudience = NoticeAudience;

export const AUDIENCE_LABEL: Record<NoticeAudience, string> = {
  all: "전체",
  staff: "전 직원",
  office: "운영진 (강사 제외)",
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
 * 'staff'=학생 외 전 직원, 'office'=강사·학생·아르바이트 제외 운영진(풀셸 사용자 — 강사 미니셸 무관 공지용),
 * 나머지는 해당 시스템 역할에 직접 매핑.
 */
export function audienceMatchesRole(audience: string, role: SystemRole): boolean {
  switch (audience) {
    case "all":
      return true;
    case "staff":
      return role !== "student";
    case "office":
      // 아르바이트(2026-11-05)는 운영진 공지 대상이 아니다 — 열람보다 낮은 등급.
      return role !== "student" && role !== "teacher" && role !== "parttime";
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

/** 폼/DB 경계에서 알 수 없는 값을 전체 공지로 정규화한다. office도 손실 없이 보존한다. */
export function normalizeNoticeAudience(value: unknown): NoticeAudience {
  const candidate = String(value ?? "").trim() || "all";
  return (NOTICE_AUDIENCES as readonly string[]).includes(candidate)
    ? (candidate as NoticeAudience)
    : "all";
}

/** 현재 역할이 받을 수 있는 audience 목록. DB 쿼리의 `.in()`에도 그대로 사용한다. */
export function audiencesForRole(role: SystemRole): NoticeAudience[] {
  return NOTICE_AUDIENCES.filter((audience) => audienceMatchesRole(audience, role));
}

/** 관리 목록(전체)에서 실제 카드에 노출할 공지만 역할에 맞게 파생한다. */
export function noticesForRole<T extends { audience: string }>(
  items: readonly T[],
  role: SystemRole,
  limit = items.length,
): T[] {
  if (limit <= 0) return [];
  const visible: T[] = [];
  for (const item of items) {
    if (!audienceMatchesRole(item.audience, role)) continue;
    visible.push(item);
    if (visible.length >= limit) break;
  }
  return visible;
}

/**
 * 팝업 노출 기간 안인가(시작·종료 둘 다 포함, 빈 값 = 그쪽 제한 없음). 요청 시각으로 판정한다 — 캐시 안에서 거르면
 * 시작 시각이 지나도 캐시 수명 동안 빠진다(server/queries.ts). 해석 못 하는 값은 제한이 없는 것으로 보지 않고 안 띄운다.
 */
export function isWithinWindow(startsAt: string | null, endsAt: string | null, now: number): boolean {
  const starts = startsAt ? new Date(startsAt).getTime() : null;
  const ends = endsAt ? new Date(endsAt).getTime() : null;
  if (Number.isNaN(starts) || Number.isNaN(ends)) return false;
  return (starts === null || starts <= now) && (ends === null || ends >= now);
}
