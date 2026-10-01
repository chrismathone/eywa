import { REPORT_SHARE_LINK_DAYS } from "@/features/onescreen/share-expiry";

/**
 * 공용 '링크 만료' 페이지(`/expired`)의 종류·문구 — 순수 모듈(Vitest).
 *
 * 원장 2026-10-01 *"보고서 등의 링크 만료시에 따로 연결될 수 있는 '링크 만료' 페이지도 만들고 배선해놓을것"*.
 * 기간이 지나 닫힌 공개 링크는 그 자리에서 안내를 그리지 않고 **이 페이지로 보낸다**(서버 307).
 *
 * 🔴 **주소엔 종류(`kind`)만 싣는다 — 토큰·학생·학원 id는 절대 싣지 말 것.** 만료 페이지는 로그인 없이 열리고
 *    학부모가 그 주소를 그대로 공유할 수 있다. 그래서 이 페이지는 "어느 학원의 무슨 링크였나"를 모른다 —
 *    🔴 그래서 **학원 이름을 적지 않는다**(회사 브랜드를 적으면 대표 지점 이름이 다른 지점 학부모에게 선다 —
 *    `app/(share)/expired/page.tsx` 주석 참조).
 * 🔴 **시간이 지나 닫힌 링크만** 보낸다. 강사가 열람을 막은 보고서(취소)·학원이 끈 QR(비활성)·없는 토큰·일시 오류는
 *    뜻이 달라 그 자리 화면 그대로다 — 취소된 사흘 전 보고서에 "90일 동안 열 수 있습니다"를 보이면 거짓이고,
 *    일시 오류를 이리 보내면 주소에서 토큰이 사라져 학부모가 새로고침으로 다시 열 수 없다.
 * 🔴 기간 숫자는 문구에 적지 말고 상수에서 읽는다 — 판정과 안내가 한 값을 본다(보고서 = `REPORT_SHARE_LINK_DAYS`).
 */

/** 만료 페이지 주소(공개 — `lib/supabase/proxy.ts`·`lib/nav/not-found-target.ts`가 같은 값을 연다). */
export const LINK_EXPIRED_PATH = "/expired";

/**
 * 영상 제출 링크(`/v/[token]`)가 쓰이는 기간(일) — 원장 2026-10-01 결정 **7일**.
 * ⚠️ `/v` 판정(브랜치 `feat/video-submit-link`)이 이 상수를 읽어야 안내 문구와 판정이 같은 값을 본다.
 */
export const VIDEO_SUBMIT_LINK_DAYS = 7;

/** 만료 안내를 따로 갖는 링크 종류. 여기 없는 값(빈 값·오타·옛 링크)은 일반 문구로 떨어진다. */
export type ExpiredLinkKind = "report" | "video" | "intake" | "staff";

const KIND_DETAIL: Record<ExpiredLinkKind, string> = {
  report: `수업보고서 링크는 보고서일로부터 ${REPORT_SHARE_LINK_DAYS}일 동안 열 수 있습니다. 담당 선생님께 다시 요청해 주세요.`,
  video: `영상 제출 링크는 ${VIDEO_SUBMIT_LINK_DAYS}일 동안 쓸 수 있습니다. 다음 수업보고서의 새 링크를 이용해 주세요.`,
  // 접수 QR·직원 등록 QR은 학원이 링크마다 마감일을 정한다 — 숫자를 적지 않는다(링크마다 다르다).
  // '새 링크 요청'이 아니라 '문의' — 학원은 같은 QR의 마감을 늘려 되살릴 수 있다(벽에 붙은 포스터가 그대로 산다).
  intake: "입학 상담 신청 링크의 접수 기간이 끝났습니다. 학원에 문의해 주세요.",
  staff: "직원 등록 링크의 사용 기간이 끝났습니다. 학원에 문의해 주세요.",
};

const GENERAL_DETAIL = "이 링크는 사용 기간이 지나 더 이상 열 수 없습니다. 링크를 보내 준 곳에 문의해 주세요.";

export const LINK_EXPIRED_TITLE = "링크가 만료되었습니다";

/**
 * 쿼리 `kind` → 아는 종류 또는 null. 배열(`?kind=a&kind=b`)은 첫 값만 본다.
 * 🔴 `in`·인덱싱 대신 `Object.hasOwn` — `?kind=constructor`·`__proto__`가 프로토타입 값을 꺼내 오지 않게.
 */
export function parseExpiredLinkKind(raw: string | string[] | null | undefined): ExpiredLinkKind | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (typeof v !== "string") return null;
  const key = v.trim().toLowerCase();
  return Object.hasOwn(KIND_DETAIL, key) ? (key as ExpiredLinkKind) : null;
}

/**
 * 화면 문구 — 제목은 하나, 종류별 한 줄. 모르는 종류는 일반 문구.
 * ⚠️ 보고서 문구의 "다시 요청"은 링크 재발급으로는 못 지킨다(재발급은 토큰만 바꾸고 만료는 보고서일에서 파생 —
 *    새 링크도 바로 만료). 선생님이 보고서 내용을 다른 길로 전해 주는 것을 뜻한다(문구는 2026-10-01 지시 원문).
 */
export function expiredLinkCopy(raw: string | string[] | null | undefined): { title: string; detail: string } {
  const kind = parseExpiredLinkKind(raw);
  return { title: LINK_EXPIRED_TITLE, detail: kind ? KIND_DETAIL[kind] : GENERAL_DETAIL };
}

/** 만료된 링크가 보낼 주소 — 종류만 싣는다(토큰 금지). */
export function expiredLinkHref(kind: ExpiredLinkKind): string {
  return `${LINK_EXPIRED_PATH}?kind=${kind}`;
}
