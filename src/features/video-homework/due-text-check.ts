/**
 * 보고서 **글에 적힌 영상 숙제 마감**이 저장될 마감과 같은가 — 순수(클라·서버 공용, `server-only` 금지 [[#61]]).
 *
 * 계기(원장 2026-10-28): 선생님이 마감 토글(7일 · 다음 수업)은 그대로 두고 글의 날짜만 고쳐 보냈다(`(11/3 (화)까지 제출)` →
 * `(10/30 (금)까지 제출)`, 12건). 학부모는 10/30으로 알았고 올리기 사이트·미수행 판정은 11/3을 봤다(due.ts가 기한의 단일 소스).
 * → 발송 직전에 글의 마감 날짜를 저장 마감과 대조해, 다르면 보내지 않고 **마감 토글을 바꾸라고** 알린다(화면 sendRow + 서버
 *   saveAndQueueClassnote, [[#77]]).
 *
 * 🔑 '영상'이 든 문장에서 `까지`가 붙은 날짜만 본다(`10/30 (금)까지` · `10월 30일까지`). `지난` 영상 숙제를 말하는 문장은 뺀다.
 * 🔑 기대 마감을 모르면(다음 수업인데 아직 날짜 전) 대조하지 않는다 — 막을 근거가 없다.
 * ⚠️ 해는 비교하지 않는다(글이 해를 안 적는다) — 마감은 숙제일 뒤 14일 안이라 달·일로 충분하다.
 */
import { addDays } from "@/lib/date-kst";
import { SITE_HOMEWORK_DAYS } from "@/features/video-submit/site";
import type { VideoHomeworkDueMode } from "./due";

const DOW = "(?:\\s*\\(\\s*[월화수목금토일]\\s*\\))?";
const SLASH_DATE = new RegExp(`(\\d{1,2})\\s*/\\s*(\\d{1,2})${DOW}\\s*(?:까지|전까지)`, "g");
const KO_DATE = new RegExp(`(\\d{1,2})\\s*월\\s*(\\d{1,2})\\s*일${DOW}\\s*(?:까지|전까지)`, "g");

/** "M/D" 꼴(앞 0 없음). */
const md = (m: string | number, d: string | number) => `${Number(m)}/${Number(d)}`;

/** 글에서 영상 숙제 마감으로 읽히는 날짜들("M/D", 나온 순서 · 중복 제거). */
export function videoDueDatesInText(text: string | null | undefined): string[] {
  if (!text) return [];
  const out: string[] = [];
  const segments = text.split(/\n+|(?<=[.!?])\s+/);
  for (const seg of segments) {
    if (!seg.includes("영상") || seg.includes("지난")) continue;
    for (const re of [SLASH_DATE, KO_DATE]) {
      re.lastIndex = 0;
      for (const m of seg.matchAll(re)) {
        const month = Number(m[1]);
        const day = Number(m[2]);
        if (month < 1 || month > 12 || day < 1 || day > 31) continue;
        const v = md(month, day);
        if (!out.includes(v)) out.push(v);
      }
    }
  }
  return out;
}

/**
 * 저장될 마감(YYYY-MM-DD) — 7일 = 숙제일 + 7일, 다음 수업 = 정해진 날짜(아직 모르면 null). due.ts `homeworkDue`와 같은 규칙이되
 * '다음 수업 · 날짜 모름'을 7일로 떨어뜨리지 않고 null로 둔다(대조하지 않게).
 */
export function expectedVideoDue(reportDate: string, mode: VideoHomeworkDueMode | undefined, nextDate: string | null | undefined): string | null {
  if (!reportDate) return null;
  if (mode === "next") return nextDate || null;
  return addDays(reportDate, SITE_HOMEWORK_DAYS);
}

/** 글의 마감이 기대 마감과 다른가 — 다르면 { found, expected }("M/D"), 같거나 대조할 수 없으면 null. */
export function videoDueTextMismatch(
  text: string | null | undefined,
  expected: string | null,
): { found: string; expected: string } | null {
  if (!expected) return null;
  const [, m, d] = expected.split("-");
  if (!m || !d) return null;
  const want = md(m, d);
  const bad = videoDueDatesInText(text).find((v) => v !== want);
  return bad ? { found: bad, expected: want } : null;
}
