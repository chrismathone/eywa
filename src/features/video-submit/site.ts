/**
 * 숙제 영상 **올리기 사이트**(`/v`, 0330a) 순수 규칙 — 공개 화면(클라)·서버·테스트가 같이 쓴다(`server-only` 금지, [[#61]]).
 *
 * 원장 2026-10-02 *"'업로드 전용 사이트'를 만들어야겠어. 거기서 자신의 휴대폰 번호 뒷 4자리를 입력하고 반을 고르면 업로드할 수 있게
 * 링크와 같이."* — 주소 하나에서 뒷 4자리 → 내 이름·반 고르기 → 그 학생 × 반의 제출 링크가 만들어져 기존 제출 화면으로 넘어간다.
 *
 * 🔴 뒷 4자리는 약한 확인이다(1만 가지). 이 파일의 숫자(횟수 제한·링크 수명)가 그 약함을 받치는 값이다 — 늘릴 때는 그 뜻을 함께 볼 것.
 */
import { shareExpiryDate } from "@/features/onescreen/share-expiry";

/** 뒷 4자리 — 숫자 넷. 모양이 다르면 DB를 묻지도 않는다. */
export const LAST4_RE = /^\d{4}$/;
export const isLast4 = (value: unknown): value is string => typeof value === "string" && LAST4_RE.test(value);

/** 전화번호가 그 4자리로 끝나나 — 숫자만 남겨 본다(하이픈·공백·괄호 무시). 번호가 4자리보다 짧으면 아니다. */
export function phoneEndsWith(phone: string | null | undefined, last4: string): boolean {
  const digits = String(phone ?? "").replace(/\D/g, "");
  return digits.length >= 8 && digits.endsWith(last4);
}

/**
 * 한 IP의 시간당 조회 횟수 — 학원 와이파이처럼 **한 IP를 한 반이 같이 쓰는** 경우를 받아야 한다(15명이 몇 번씩 다시 눌러도 넉넉하게).
 * 1만 가지를 훑기엔 여전히 턱없이 적다(한 IP로 250시간). 한도를 넘은 시도는 세지 않는다(server/site.ts `admit`).
 */
export const SITE_LOOKUPS_PER_HOUR = 40;
/** 한 IP의 시간당 링크 열기 횟수(위와 같은 이유로 한 반 인원을 받는다). */
export const SITE_OPENS_PER_HOUR = 30;
/** 한 뒷 4자리에 걸리는 학생 수 상한 — 실측 최대 3명(형제). 이보다 많으면 자리 채움 번호(0000 등)로 보고 사이트에서 안내하지 않는다. */
export const SITE_MAX_STUDENTS_PER_LAST4 = 4;
/** 지점 전체의 시간당 조회 상한 — 여러 IP로 나눠 훑는 것을 막는 바닥(학생 수백 명이 한 시간에 몰려도 닿지 않는다). */
export const SITE_LOOKUPS_PER_HOUR_TENANT = 600;
/** 한 학생 × 반이 하루에 사이트로 만들 수 있는 링크 수 — 링크마다 업로드 횟수 제한이 따로 있어, 링크를 계속 새로 만들어 우회하지 못하게. */
export const SITE_LINKS_PER_PAIR_PER_DAY = 6;
/** 한 번에 보여 주는 후보 수 상한(같은 뒷 4자리 학생 × 반). */
export const SITE_MAX_CHOICES = 12;

/**
 * 사이트가 만든 링크가 끝나는 순간 — **만든 날과 다음 날**까지(KST). 보고서 글의 링크(7일)보다 짧다:
 * 사이트는 언제든 다시 들어와 새로 만들 수 있고, 약한 확인으로 만든 링크를 오래 살려 둘 이유가 없다.
 */
export function siteLinkExpiresAt(todayKst: string): string {
  return `${shareExpiryDate(todayKst, 2)}T00:00:00+09:00`;
}

/** 사이트가 만든 링크를 마지막으로 쓸 수 있는 날(KST, 기록·표기용) — 만든 다음 날. */
export const siteLinkLastDay = (todayKst: string): string => shareExpiryDate(todayKst, 1);

/** 화면에 보이는 후보 한 줄 — 학생 번호·반 번호는 내려보내지 않는다(고른 값은 `id`로만 돌아온다). */
export type SiteChoice = { id: string; studentLabel: string; className: string };

export type SiteLookupResult =
  | { ok: true; choices: SiteChoice[] }
  | { ok: false; code: "invalid" | "limit" | "unavailable" | "error"; error: string };
export type SiteOpenResult =
  | { ok: true; url: string }
  | { ok: false; code: "invalid" | "limit" | "unavailable" | "error"; error: string };
