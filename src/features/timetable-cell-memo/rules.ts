import type { DayOfWeek } from "@/features/timetable/lib/periods";

/**
 * 시간표 **칸 메모**(영어 강사뷰, 원장 2026-10-22 *"각 셀마다 우클릭해서 엑셀처럼 메모 입력"*) — 순수 규칙(서버·클라 공용).
 *
 * 🔑 메모 하나 = (지점 · 과목 · **날짜** · 강사 열 · 칸 시작 시각). 원장이 "그 날짜 칸에만"을 골랐다 —
 *    10/22(목) 16:20 김태건 칸의 메모는 그날만 보이고, 다른 주로 넘기면 빈 칸이다.
 * 🔑 표시는 **그 시각을 품은 칸**에 한다(`memosInRange`) — 행 간격 설정(10분 → 30분)을 바꿔도 메모가 사라지지 않는다.
 *    수업 블록은 블록 시작 시각을 열쇠로 쓰므로 축 간격과 무관하게 같은 블록에 붙는다.
 */

/** 칸 메모가 서는 과목 — 강사뷰가 영어 시트를 미러하는 과목만(원장 지시 범위). */
export const CELL_MEMO_SUBJECTS = ["english"] as const;
export function isCellMemoSubject(s: string): boolean {
  return (CELL_MEMO_SUBJECTS as readonly string[]).includes(s);
}

/** 글자 상한 — DB 검사(0394a)와 같은 값. */
export const MEMO_BODY_MAX = 2000;
/** 강사 열 라벨 상한 — DB 검사와 같은 값. */
export const MEMO_LABEL_MAX = 100;

/** 메모 상자 크기(px, 확대 배율 1 기준) — 기본·최소·최대. DB 검사(0394a)와 같은 범위. */
export const MEMO_BOX = { defaultW: 240, defaultH: 140, minW: 160, minH: 80, maxW: 640, maxH: 480 } as const;

export type CellMemo = {
  id: string;
  /** YYYY-MM-DD */
  date: string;
  /** 화면의 강사 열 라벨(강사뷰 `teacherOf`와 같은 값) — 서버가 저장 열쇠에서 지금 이름으로 풀어 준다. */
  col: string;
  /** 칸 시작 시각(자정 기준 분) */
  startMin: number;
  body: string;
  width: number | null;
  height: number | null;
  version: number;
  updatedAt: string;
  updatedByName: string | null;
};

const YMD = /^\d{4}-\d{2}-\d{2}$/;
export function isYmd(s: unknown): s is string {
  if (typeof s !== "string" || !YMD.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** 날짜 더하기(UTC 산술 — 서버 시간대와 무관). */
export function addDaysYmd(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function isMondayYmd(ymd: string): boolean {
  if (!isYmd(ymd)) return false;
  const [y, m, d] = ymd.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay() === 1;
}

const DAY_OFFSET: Record<DayOfWeek, number> = { mon: 0, tue: 1, wed: 2, thu: 3, fri: 4, sat: 5, sun: 6 };

/** 그 주(월요일)의 요일 칸 날짜. */
export function memoDateOf(weekMonday: string, day: DayOfWeek): string {
  return addDaysYmd(weekMonday, DAY_OFFSET[day]);
}

/** 그 주 범위(월~일) — 조회를 이 7일로만 좁힌다(지점 전체 무기한 조회 금지, B2). */
export function weekRange(weekMonday: string): { from: string; to: string } {
  return { from: weekMonday, to: addDaysYmd(weekMonday, 6) };
}

const STAMP = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Seoul",
  year: "2-digit",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/**
 * 메모 상자 마지막 줄 — `yy.mm.dd hh:mm 이름`(원장 지정 형식, 예 `26.10.22 18:40 박소선`).
 * 🔴 시각은 KST · 저장값(수정 시각·수정자)에서 그린다 — 본문에 꼬리표를 덧붙여 저장하지 않는다.
 */
export function formatMemoStamp(iso: string | null | undefined, name: string | null | undefined): string {
  if (!iso) return "";
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const p = Object.fromEntries(STAMP.formatToParts(at).map((x) => [x.type, x.value]));
  const stamp = `${p.year}.${p.month}.${p.day} ${p.hour}:${p.minute}`;
  const who = name?.trim();
  return who ? `${stamp} ${who}` : stamp;
}

/** `16:20` — 자정 기준 분 → 시:분. */
export function hmOf(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

const DOW_KO = ["일", "월", "화", "수", "목", "금", "토"];

/** 감사로그 대상 문구 — `10/22(목) 16:20 김태건`. */
export function memoPlaceLabel(date: string, startMin: number, col: string): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const dow = DOW_KO[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] ?? "";
  return `${m}/${d}(${dow}) ${hmOf(startMin)} ${col}`;
}

/** 메모 상자 크기 — 저장 범위로 자른다(정수 px). 값이 없으면 기본 크기. */
export function clampMemoSize(width: number | null | undefined, height: number | null | undefined): { width: number; height: number } {
  const w = Number.isFinite(width) ? Math.round(width as number) : MEMO_BOX.defaultW;
  const h = Number.isFinite(height) ? Math.round(height as number) : MEMO_BOX.defaultH;
  return {
    width: Math.min(MEMO_BOX.maxW, Math.max(MEMO_BOX.minW, w)),
    height: Math.min(MEMO_BOX.maxH, Math.max(MEMO_BOX.minH, h)),
  };
}

/**
 * 저장할 본문 — 줄바꿈만 맞추고 글자는 그대로 둔다. 공백뿐이면 null(= 비운 메모 → 지우기 대상).
 * 상한을 넘으면 `too_long`.
 */
export function normalizeMemoBody(raw: unknown): string | null | "too_long" {
  if (typeof raw !== "string") return null;
  const body = raw.replace(/\r\n?/g, "\n");
  if (body.trim().length === 0) return null;
  if (body.length > MEMO_BODY_MAX) return "too_long";
  return body;
}

/**
 * 이 칸(열 · 날짜 · [from, to))에 보일 메모 — 시각순. 행 간격을 넓혀 한 칸에 둘 이상 들어오면 전부 보인다.
 */
export function memosInRange(
  memos: readonly CellMemo[],
  col: string,
  date: string,
  from: number,
  to: number,
): CellMemo[] {
  return memos
    .filter((m) => m.col === col && m.date === date && m.startMin >= from && m.startMin < to)
    .sort((a, b) => a.startMin - b.startMin || a.id.localeCompare(b.id));
}

/** 편집·삭제 대상 — 칸 열쇠 시각과 같은 메모, 없으면 가장 이른 것. */
export function primaryMemo(list: readonly CellMemo[], keyStart: number): CellMemo | null {
  return list.find((m) => m.startMin === keyStart) ?? list[0] ?? null;
}
