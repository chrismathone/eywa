/**
 * '출결 모드'의 **지각 메모 조립·해석** — 순수 함수(Vitest).
 *
 * 원장 2026-08-20: *"지각도 자동으로 지각선택한 시각으로 메모입력되고, 필요시 시간 재설정"*.
 * '지각'을 고르면 확인 단계가 **`HH:MM 등원`** 으로 채워져 열리고, 사람이 시각을 보고 저장한다
 * (지각만 확인 단계를 두는 이유 = 메모에 시각이 들어가기 때문 — 잘못된 시각은 나중에 못 되짚는다).
 *
 * 🔴 시각은 **KST 단일 소스**다([`kstMinutesOfDay`](@/lib/date-kst)) — 서버는 UTC라 `new Date()`의
 *    로컬 시·분을 그대로 찍으면 9시간 어긋난 등원 시각이 학부모 연락의 근거가 된다(전역 규칙).
 * 🔑 조립뿐 아니라 **해석**(`parseLateNote`)도 여기 둔다. 이미 찍힌 지각 칸을 다시 열 때 저장된 메모를
 *    초기값으로 되살려야 하는데, 그 규칙이 화면에 흩어지면 "17:05로 저장했는데 열면 지금 시각"이 된다.
 * ⚠️ 자유 텍스트로 적힌 옛 메모(`차가 막혀서`)는 **사유 자리로 되살린다** — 시각을 못 읽었다고 메모를
 *    통째로 버리면 강사가 적어 둔 사실이 조용히 사라진다.
 */
import { kstMinutesOfDay } from "@/lib/date-kst";

/** 메모 꼬리말 — "무엇의 시각인가"를 사람 말로 남긴다(raw 시각만 적으면 등원인지 하원인지 모른다). */
export const LATE_NOTE_SUFFIX = "등원";
/** 시각과 사유를 잇는 구분자 — 결석 메모(사유만)와 달리 지각은 두 조각이다. */
export const LATE_NOTE_SEP = " · ";

const HHMM = /^(\d{1,2}):(\d{2})$/;
const MIN_OF_DAY = 24 * 60 - 1;

/**
 * 조립과 **같은 상수**에서 만든 해석기 — 꼬리말·구분자를 바꿔도 둘이 갈리지 않는다.
 * (가운뎃점 `·`는 정규식 메타문자가 아니라 그대로 넣어도 안전하다.)
 */
const LATE_NOTE_RE = new RegExp(
  `^(\\d{1,2}:\\d{2})\\s*${LATE_NOTE_SUFFIX}\\s*(?:${LATE_NOTE_SEP.trim()}\\s*(.*))?$`,
);

/** 분(0–1439) → "HH:MM". 하루 밖은 하루 안으로 접는다(−5분을 자정에 눌러도 전날로 안 넘어간다). */
export function minutesToHhmm(min: number): string {
  const clamped = Math.max(0, Math.min(MIN_OF_DAY, Math.round(min)));
  return `${String(Math.floor(clamped / 60)).padStart(2, "0")}:${String(clamped % 60).padStart(2, "0")}`;
}

/** "HH:MM" → 분. 못 읽으면 null(형식이 틀린 값을 00:00으로 삼키지 않는다). */
export function hhmmToMinutes(hhmm: string): number | null {
  const m = HHMM.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (h > 23 || mm > 59) return null;
  return h * 60 + mm;
}

/**
 * 메모에 적을 등원 시각 — `now`가 Date면 **KST 시·분**, "HH:MM" 문자열이면 그 값에서 출발한다.
 * ⚠️ 읽을 수 없는 문자열은 **지금(KST)** 으로 떨어진다 — 형식이 깨진 값을 00:00으로 적으면
 *    "새벽 0시에 등원"이라는 사실이 아닌 메모가 남는다.
 */
export function lateArrivalTime(now: Date | string = new Date(), minutesDelta = 0): string {
  const base =
    typeof now === "string" ? (hhmmToMinutes(now) ?? kstMinutesOfDay()) : kstMinutesOfDay(now);
  return minutesToHhmm(base + minutesDelta);
}

/**
 * 지각 메모 한 줄. 사유가 없으면 시각만(`17:05 등원`), 있으면 뒤에 붙인다(`17:05 등원 · 버스 놓침`).
 * 사유는 앞뒤 공백을 떼고, 비어 있으면 붙이지 않는다(꼬리에 ` · `만 남는 메모 방지).
 */
export function buildLateNote(
  now: Date | string = new Date(),
  minutesDelta = 0,
  reason?: string | null,
): string {
  const head = `${lateArrivalTime(now, minutesDelta)} ${LATE_NOTE_SUFFIX}`;
  const tail = (reason ?? "").trim();
  return tail ? `${head}${LATE_NOTE_SEP}${tail}` : head;
}

/**
 * 저장된 지각 메모 → 시각·사유. 이 형식이 아니면 시각은 null이고 **메모 전체가 사유**가 된다.
 * (`17:05 등원` → 시각만 · `17:05 등원 · 버스 놓침` → 둘 다 · `차가 막혀서` → 사유만)
 */
export function parseLateNote(note: string | null | undefined): {
  time: string | null;
  reason: string | null;
} {
  const raw = (note ?? "").trim();
  if (!raw) return { time: null, reason: null };
  const m = LATE_NOTE_RE.exec(raw);
  if (!m) return { time: null, reason: raw };
  const min = hhmmToMinutes(m[1]!);
  if (min == null) return { time: null, reason: raw };
  const reason = (m[2] ?? "").trim();
  return { time: minutesToHhmm(min), reason: reason || null };
}
