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
import { formatShortKoreanDate, kstDateOf } from "@/lib/date-kst";

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
/** 한 번에 보여 주는 숙제 수 상한(그 학생의 반 × 아직 올릴 수 있는 영상 숙제 — 안 낸 숙제가 먼저). */
export const SITE_MAX_CHOICES = 12;

/**
 * **숙제 없이 올리기**(원장 2026-10-13 *"기존 숙제가 있으면 숙제를 누르고 영상을 올리고, 숙제가 없어도 업로드 할 수 있게"* ·
 * *"반 정도 고르고 해당 반에 영상 업로드하고, 학생이 무슨 영상인지 대략적으로 남겨놓는거지 메모로"* · *"하루 5회 한도"*).
 *  · 숙제 목록 아래에 학생 × 반마다 한 줄 — 고르면 그 반의 담임 폴더로 올라가고, 메모가 영상과 함께 남는다(선생님이 보고 숙제에 연결한다).
 *  · 한 학생이 하루(KST)에 시작할 수 있는 숙제 없는 업로드 수 = `SITE_FREE_UPLOADS_PER_DAY`(반 합산 · 횟수 제한·실패로 거절된 것은 안 센다).
 *  · 메모는 필수 — 선생님이 무엇의 영상인지 알 수 있어야 한다. 학생이 쓴 글이라 화면에는 글자로만 보여 준다.
 */
export const SITE_FREE_UPLOADS_PER_DAY = 5;
/**
 * 한 숙제에 사이트로 낼 수 있는 영상 수(원장 2026-10-21 *"한번에 여러 단원의 영상을 업로드해야할 수도"*) — 장부 칸에 보이는 영상 수(같은 파일 사본은
 * 한 번)가 이만큼이면 그 숙제는 목록에서 빠지고 업로드 시작이 거절한다(더 올릴 영상은 숙제 없이 올리기). 올리기를 끝낸 영상으로 센다 —
 * 동시에 여러 개를 시작하면 조금 넘을 수 있다(시간·하루 업로드 상한이 따로 막는다).
 */
export const SITE_MAX_VIDEOS_PER_HOMEWORK = 5;
export const SITE_NOTE_MIN = 2;
export const SITE_NOTE_MAX = 100;
/** 메모 다듬기 — 줄바꿈·연속 공백을 한 칸으로, 앞뒤 공백을 뗀다. 모양이 틀리면(짧음·김·글자 아님) null. */
export function siteNote(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.normalize("NFC").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return text.length >= SITE_NOTE_MIN && text.length <= SITE_NOTE_MAX ? text : null;
}

/**
 * 사이트로 숙제를 올릴 수 있는 **기본** 기간 — 숙제가 나간 수업일부터 이 날수가 지난 날까지(KST, 그날 포함). 원장 2026-10-03
 * *"링크가 숙제날짜 기준 7일로 하면 좋겠네"* — 10/1 숙제면 10/8까지. 선생님이 '다음 수업'을 고른 숙제는 그 수업일까지다(원장 2026-10-15) —
 * 숙제마다의 마감은 video-homework/due.ts `homeworkDue`로만 읽는다(숙제 목록·제출 화면·업로드 시작·미수행 판정이 같은 값을 본다).
 */
export const SITE_HOMEWORK_DAYS = 7;

/** 마감을 고르지 않은 숙제의 마지막 날(KST) — 숙제일 + `SITE_HOMEWORK_DAYS`. 숙제마다의 마감은 due.ts `homeworkDue`. */
export const siteHomeworkLastDay = (homeworkDate: string): string => shareExpiryDate(homeworkDate, SITE_HOMEWORK_DAYS);

/**
 * 사이트가 만든 링크가 끝나는 순간 — 마지막으로 쓸 수 있는 날(`lastDay`)의 다음 날 0시(KST).
 * `lastDay` = 그 학생 × 반의 **안 낸 숙제 중 가장 늦게 끝나는 것**의 마지막 날 — 링크 하나로 같은 반의 다른 숙제도 올리므로(제출 화면의
 * '이 반의 다른 영상 숙제') 링크는 가장 늦은 숙제까지 살고, 숙제마다의 기한은 업로드 시작·제출 화면이 숙제일로 따로 막는다.
 * 만든 날에서 길어야 마감의 최대 거리(due.ts `VIDEO_HOMEWORK_MAX_DUE_DAYS`, 14일) + 1일 — 링크 수를 세는 곳은 이 기간을 덮어야 한다(`SITE_LINK_LOOKBACK_DAYS`).
 */
export function siteLinkExpiresAt(lastDay: string): string {
  return `${shareExpiryDate(lastDay, 1)}T00:00:00+09:00`;
}

/**
 * 제출 화면의 "언제까지" — 링크가 끝나는 날(끝나는 순간 1ms 전의 KST 날짜). 고른 숙제가 있으면 그 숙제의 마감(`due` — 서버가 읽은 값,
 * 없으면 숙제일 + 7일)과 중 이른 날. 링크는 같은 반의 가장 늦은 숙제까지 살지만, 학생에게는 "지금 고른 숙제를 언제까지 올리나"가 중요하다.
 */
export function uploadLastDay(expiresAtIso: string, homeworkDate: string | null, due?: string | null): string {
  const linkLast = kstDateOf(new Date(Date.parse(expiresAtIso) - 1)) ?? "";
  if (!homeworkDate) return linkLast;
  const homeworkLast = due ?? siteHomeworkLastDay(homeworkDate);
  return linkLast && linkLast < homeworkLast ? linkLast : homeworkLast;
}

/**
 * 링크로 못 올릴 때 갈 길 — 학생마다 링크를 새로 만들지 않으므로(원장 2026-10-03 *"이제는 클래스노트 업로드 혹은 /v 링크로만 업로드"*)
 * "선생님께 새 링크를 받으라"고 하지 않는다(받을 길이 없는 막다른 안내).
 */
export const VIDEO_UPLOAD_OTHER_WAYS = "숙제 영상은 ClassNote 알림장에 올리거나, 숙제 영상 올리기 사이트에서 휴대폰 번호 뒷 4자리와 이름을 넣고 올려 주세요.";

/**
 * 번호·이름은 맞는데 고를 줄이 없는 까닭(원장 2026-11-04 *"메시지가 오해를 불러일으킬 수 있을거같은데"*).
 * 실제로 있었던 일: 지금 다니는 반이 학원 설정('영상 제출 검사')에서 꺼져 있었고 다른 반은 아직 시작 전이었다.
 * 그런데 학생은 "올릴 수 있는 반이 없습니다"를 보고 "반 배정이 안 됐다"로 읽었다.
 *  · `excludedNow` = 지금 다니는 반 가운데 영상 숙제 대상이 아닌 반이 있다(반은 있다 — '반이 없다'고 말하지 않는다).
 *  · `nextStart` = 아직 시작 전인 영상 숙제 대상 반 가운데 가장 이른 시작일.
 * 반 이름·선생님은 싣지 않는다. 공개 화면이라, 고를 줄이 없을 때 반 정보를 새로 내보내지 않는다.
 */
export type SiteNoChoiceWhy = { excludedNow: boolean; nextStart: string | null };
/** 정말로 올릴 반이 없다(수강이 끝났거나 · 휴원 · 숙제가 남지 않은 지난 반뿐). */
export const SITE_NO_CLASS = "지금 여기서 영상을 올릴 수 있는 반이 없습니다. 숙제 영상은 ClassNote 알림장에 올려 주세요.";
export function siteNoChoiceMessage(why: SiteNoChoiceWhy | null | undefined): string {
  const start = why?.nextStart ? formatShortKoreanDate(why.nextStart) : null;
  if (why?.excludedNow && start) {
    return `지금 다니는 반은 여기서 영상 숙제를 받지 않습니다. ${start}에 시작하는 반은 그날부터 여기서 올릴 수 있습니다. 그 전에는 숙제 영상을 ClassNote 알림장에 올려 주세요.`;
  }
  if (why?.excludedNow) return "지금 다니는 반은 여기서 영상 숙제를 받지 않습니다. 숙제 영상은 ClassNote 알림장에 올려 주세요.";
  if (start) return `다니는 반 수업이 ${start}에 시작합니다. 그날부터 여기서 올릴 수 있습니다. 그 전에는 숙제 영상을 ClassNote 알림장에 올려 주세요.`;
  return SITE_NO_CLASS;
}

/**
 * 살아 있을 수 있는 사이트 링크를 찾을 때 거슬러 볼 날수(만든 날 기준) — 링크 수명의 최댓값(마감의 최대 거리 14일 + 1일) + 하루 여유.
 * 14 = video-homework/due.ts `VIDEO_HOMEWORK_MAX_DUE_DAYS`(그 모듈이 이 파일을 읽어 여기서는 숫자로 적는다 — site.test.ts가 같은 값인지 잠근다).
 */
export const SITE_LINK_LOOKBACK_DAYS = 14 + 2;

/**
 * 화면에 보이는 숙제 한 줄 — 학생 번호·반 번호·보고서 번호는 내려보내지 않는다(고른 값은 `id`로만 돌아온다).
 * `homeworkLabel` = 그 숙제가 나간 수업일("10/1 (목)"). 숙제 **내용**은 싣지 않는다(약한 확인으로 보고서 글을 보여 주지 않는다).
 */
export type SiteChoice = { id: string; studentLabel: string; className: string; homeworkLabel: string;
  /** 언제까지 내나 — "10/22 (목)까지" · "다음 수업 10/15 (목)까지"(due.ts `homeworkDueText`). 숙제 줄에만. */
  dueLabel?: string;
  /** 숙제 없이 그 반에 올리기(메모 필수) — `homeworkLabel`은 빈 글자다. */
  free?: true;
  /** 수강이 끝난 반(반을 옮기기 전 반 등)에서 받은 숙제 — 화면이 '지난 반'으로 적는다. 숙제 줄에만(숙제 없이 올리기는 지금 반만). */
  pastClass?: true;
  /** 그 숙제에 이미 낸 영상 수(1 이상일 때만) — 마감까지 더 낼 수 있다(여러 단원, 원장 2026-10-21). 화면이 "영상 N개 냄"으로 적는다. */
  sent?: number;
  /**
   * 선생님 묶음(원장 2026-10-22 — 화면은 **선생님 → 반 → 숙제** 순서). 열쇠는 이 응답 안에서만 쓰는 묶음 번호("t1")이고 사람 번호가 아니다.
   * 이름 = 담임의 수업보고서 발송 이름 + (과목) — "허주연 (수학)". 없는 응답(옛 서버)은 한 묶음으로 본다.
   */
  teacherKey?: string; teacherLabel?: string;
  /** 반 묶음(학생 × 반 — "c1"). 같은 반의 숙제 줄과 '숙제 없이 올리기' 줄이 같은 열쇠다. */
  classKey?: string;
  /** 이 숙제에 이미 낸 영상 — "10/22 (수) 09:19" · 학생이 적은 메모(원장 2026-10-22). 파일·주소는 없다. */
  sentVideos?: { label: string; note?: string }[] };

/**
 * 올리기 사이트를 쓰는 지점 한 곳(화면의 지점 선택지) — 번호와 이름만. 주소에는 지점을 넣지 않는다(멀티테넌트 C안):
 * 쓰는 지점이 하나면 고르지 않고, 여럿이면 화면에서 고른다(자리 PIN과 같은 방식, 원장 2026-10-04).
 */
export type SiteBranch = { id: string; name: string };
/**
 * 지점을 골라야 한다 — 쓰는 지점이 여럿인데 고르지 않았거나, 고른 지점이 목록에 없다(그사이 꺼졌다 · 지어낸 값).
 * 🔴 서버는 고르지 않은 요청을 어느 한 지점으로 떨어뜨리지 않는다(다른 지점의 같은 이름·같은 뒷자리 학생에게 올리게 된다).
 * `branches` = 지금 고를 수 있는 지점(화면이 그 자리에서 선택지를 다시 세운다).
 */
export type SiteBranchNeeded = { ok: false; code: "branch"; error: string; branches: SiteBranch[] };
export const SITE_BRANCH_NEEDED = "지점을 골라 주세요.";
/** 이 기기에서 마지막으로 고른 지점(번호만) — 다음에 열 때 미리 골라 둔다. 계정이 없는 공개 화면이라 브라우저에만 둔다. */
export const SITE_BRANCH_STORAGE_KEY = "eywa-video-site-branch";

export type SiteLookupResult =
  | { ok: true; choices: SiteChoice[] }
  /** `no_homework` = 번호·이름은 맞지만 고를 줄이 없다 — 문구가 까닭을 가린다(`siteNoChoiceMessage`: 대상 밖 반 · 시작 전 · 반 없음). */
  | { ok: false; code: "invalid" | "no_homework" | "limit" | "unavailable" | "error"; error: string }
  | SiteBranchNeeded;
export type SiteOpenResult =
  | { ok: true; url: string }
  | { ok: false; code: "invalid" | "limit" | "unavailable" | "error"; error: string }
  | SiteBranchNeeded;
