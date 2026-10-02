/**
 * 숙제 영상 **올리기 사이트**(`/v`, 0330a) 순수 규칙 — 공개 화면(클라)·서버·테스트가 같이 쓴다(`server-only` 금지, [[#61]]).
 *
 * 원장 2026-10-02 *"'업로드 전용 사이트'를 만들어야겠어. 거기서 자신의 휴대폰 번호 뒷 4자리를 입력하고 반을 고르면 업로드할 수 있게
 * 링크와 같이."* — 주소 하나에서 뒷 4자리 → 내 이름·반 고르기 → 그 학생 × 반의 제출 링크가 만들어져 기존 제출 화면으로 넘어간다.
 *
 * 원장 2026-10-03: *"번호 입력하고 자신의 이름까지 입력하도록. 알파벳은 됐고 … 그래야 매칭 반 보여주는걸로"* ·
 * *"사전에 선생님이 숙제로 낸 리스트가 있어야 업로드 링크 보이도록 하고, 숙제 리스트에서 고르도록 해서 숙제 링크 배선까지"* —
 * 뒷 4자리 **+ 이름** → 선생님이 낸 **영상 숙제 목록**(아직 안 낸 것) → 고른 숙제의 제출 화면. 올린 영상은 그 숙제에 묶인다.
 * 영상 숙제가 없는 학생(고등부 등)은 "찾지 못했다"가 아니라 "지금 올릴 영상 숙제가 없다"고 듣는다(검색이 안 되는 것으로 오해하지 않게).
 *
 * 🔴 뒷 4자리는 약한 확인이다(1만 가지). 이 파일의 숫자(횟수 제한·링크 수명)가 그 약함을 받치는 값이다 — 늘릴 때는 그 뜻을 함께 볼 것.
 */
import { shareExpiryDate } from "@/features/onescreen/share-expiry";

/** 뒷 4자리 — 숫자 넷. 모양이 다르면 DB를 묻지도 않는다. */
export const LAST4_RE = /^\d{4}$/;
export const isLast4 = (value: unknown): value is string => typeof value === "string" && LAST4_RE.test(value);

/** 이름 칸에 넣을 수 있는 최대 글자 수(붙여 넣은 긴 글을 DB 조회 전에 거른다). */
export const SITE_NAME_MAX = 20;

/**
 * 이름 비교 열쇠 — 공백을 없애고, 한글 이름 뒤의 **동명이인 구분 글자**(알파벳 한 글자 · 숫자)를 뗀다(`김지유A` → `김지유`).
 * 학생은 그 글자를 모른다(학원이 붙인 표식) — 안 쳐도 맞고, 쳐도 맞는다. 로마자 이름(`Chris`)은 건드리지 않는다.
 */
export function siteNameKey(name: unknown): string {
  const flat = String(name ?? "").normalize("NFC").replace(/\s+/g, "");
  return flat.replace(/(?<=[가-힣])(?:[A-Za-z]|\d{1,2})$/, "").toLowerCase();
}
/** 이름 모양 — 두 글자 이상 · 너무 길지 않다. 모양이 다르면 DB를 묻지도 않는다. */
export const isSiteName = (value: unknown): value is string =>
  typeof value === "string" && value.length <= SITE_NAME_MAX * 2 && siteNameKey(value).length >= 2 && siteNameKey(value).length <= SITE_NAME_MAX;
/** 친 이름이 그 학생 이름과 같은가(구분 글자·공백 무시). */
export const siteNameMatches = (studentName: string | null | undefined, typed: string): boolean => {
  const key = siteNameKey(typed);
  return key.length >= 2 && siteNameKey(studentName) === key;
};

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
/** 한 번에 보여 주는 숙제 수 상한(그 학생의 반 × 아직 안 낸 영상 숙제). */
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

/**
 * 화면에 보이는 숙제 한 줄 — 학생 번호·반 번호·보고서 번호는 내려보내지 않는다(고른 값은 `id`로만 돌아온다).
 * `homeworkLabel` = 그 숙제가 나간 수업일("10/1 (목)"). 숙제 **내용**은 싣지 않는다(약한 확인으로 보고서 글을 보여 주지 않는다).
 */
export type SiteChoice = { id: string; studentLabel: string; className: string; homeworkLabel: string };

export type SiteLookupResult =
  | { ok: true; choices: SiteChoice[] }
  /** `no_homework` = 번호·이름은 맞지만 지금 올릴 영상 숙제가 없다(영상 숙제가 없는 반·이미 다 냄). */
  | { ok: false; code: "invalid" | "no_homework" | "limit" | "unavailable" | "error"; error: string };
export type SiteOpenResult =
  | { ok: true; url: string }
  | { ok: false; code: "invalid" | "limit" | "unavailable" | "error"; error: string };
