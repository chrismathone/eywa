/**
 * 퇴원관리 '강사별 퇴원율 추이'(원장 2026-11-11 *"모든 강사를 한번에 … 기간에 걸친 퇴원율 변화"* → *"퇴원관리에 그 기능이
 * 있으면 되겠다. 계기판이나 다른 디자인 활용해서 비교가능하게"*) — 강사 × 달 칸.
 *
 * 🔴 값은 강사평가(직원 포트폴리오)가 달마다 저장한 퇴원율 그대로다(`teacher_portfolio_months`의 churn 항목 — 계산은
 *    `teacher-portfolio/model/churn.ts`). 여기서 다시 세지 않는다(같은 데이터는 같은 원본 — 포트폴리오와 숫자가 갈리지 않게).
 *    칸 = 지난달 그 강사가 절반 이상 맡은 학생(분모) 중 그 달 그만둔 학생(분자)의 비율.
 * 🔴 강사들을 더한 '합산'·평균 선은 두지 않는다(Claude·Codex 협의 2026-11-11) — 한 학생을 담임·교시 담당 두 강사가 맡으면
 *    양쪽에 다 들어 학원 전체 퇴원율이 아니고, 4~7월과 8월 뒤는 퇴원율을 낸 강사 수부터 다르다.
 * ⚠️ 일반 모듈 — 서버(조회)와 클라(카드)가 함께 쓴다([[#61]]).
 */

/**
 * 한 강사 · 한 달. `state` — ok = 퇴원율 있음 · noBase = 지난달 담당 학생이 없어 퇴원율이 없다 · unreadable = 저장된 줄은
 * 있는데 퇴원율 항목을 읽지 못했다. 저장 줄이 아예 없는 달(그 달 평가 대상 아님)은 칸이 없다(`cells`에 키 없음).
 * `closed` = 그 강사의 그 달이 마감됐다(진행 중이거나 마감 대기면 false).
 */
export type ChurnCell = { state: "ok" | "noBase" | "unreadable"; rate: number | null; base: number; counted: number; closed: boolean; end: string };
/**
 * 한 달 — `partial` = 진행 중 · `ends` = 그 달 저장 줄들이 반영한 마지막 날(강사마다 다르면 둘 이상 · 오름차순).
 * 저장 줄이 하나도 없는 달도 축에 선다(`ends` 빈 배열) — 그 달을 건너뛰어 앞뒤 달이 붙어 보이지 않게.
 */
export type ChurnMonth = { month: string; partial: boolean; ends: string[] };

/** 지점의 강사별 퇴원율 캐시 열쇠 — 강사평가를 [지금 집계]하면 비운다. */
export const teacherChurnTag = (tenantId: string) => `withdrawals-teacher-churn:${tenantId}`;
/**
 * `subjects` = 가장 최근 달에 가르친 과목 라벨(줄 머리) · `subjectsByMonth` = 달마다 가르친 과목 키(가르친 과목 필터 — 고른 기간 안의 달만 본다).
 * `hireDate` = 직원 정보의 입사일 · `resignDate` = 퇴사한 강사의 퇴사일(재직 중이면 null) — 재직 밖 달 칸은 싣지 않는다(`inTenure`).
 */
export type ChurnTeacherRow = {
  id: string; name: string; subjects: string[]; subjectsByMonth: Record<string, string[]>; hireDate: string | null; resignDate: string | null;
  cells: Record<string, ChurnCell>;
};
export type TeacherChurnData = { months: ChurnMonth[]; teachers: ChurnTeacherRow[] };

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** 저장된 항목 하나 → 칸. churn 항목이 아니거나 모양이 틀리면 `unreadable`(없는 값을 만들지 않는다). */
export function churnCellOf(item: unknown, closed: boolean, end = ""): ChurnCell {
  const bad: ChurnCell = { state: "unreadable", rate: null, base: 0, counted: 0, closed, end };
  if (!item || typeof item !== "object") return bad;
  const o = item as Record<string, unknown>;
  const base = num(o.base), counted = num(o.counted), raw = num(o.raw);
  if (o.id !== "churn" || base === null || counted === null) return bad;
  // 분모가 없으면 강사평가가 퇴원율을 비운다(raw null) — 0%가 아니다. 분모가 있는데 퇴원율이 비었으면 저장 모양이 어긋난 것.
  if (base === 0 && raw === null) return { state: "noBase", rate: null, base, counted, closed, end };
  if (base <= 0 || raw === null) return bad;
  return { state: "ok", rate: raw, base, counted, closed, end };
}

/**
 * 퇴원율을 보이기 시작하는 달 — 입사한 **다음 달**부터(원장 2026-11-11 *"실제 선생님이 입사한 날부터. 0%하지말고"*).
 * 퇴원율은 '지난달 담당 학생' 기준이라 입사한 달의 값도 입사 전 달의 기록으로 셈한 것이다(실데이터: 9/1 입사 강사에게 4~9월 값이
 * 저장돼 있었다). 입사일이 없으면 null(자르지 않는다).
 */
export function countsFrom(hireDate: string | null): string | null {
  if (!hireDate || !/^\d{4}-\d{2}/.test(hireDate)) return null;
  return nextMonth(hireDate.slice(0, 7));
}

/**
 * 그 달 퇴원율을 보일지 — 입사 다음 달부터(`countsFrom`) 퇴사한 달까지(원장 2026-11-11 *"퇴사한 선생님도 근무한 달까지 보이게"*).
 * 퇴사 뒤 달의 값은 그 강사가 없는 동안의 그만둠이라 싣지 않는다.
 */
export function inTenure(month: string, hireDate: string | null, resignDate: string | null): boolean {
  const from = countsFrom(hireDate);
  if (from && month < from) return false;
  return !resignDate || month <= resignDate.slice(0, 7);
}

/** "YYYY-MM"부터 "YYYY-MM"까지 빠짐없이(오름차순). */
export function monthSpan(from: string, to: string): string[] {
  const out: string[] = [];
  for (let m = from; m <= to && out.length < 240; m = nextMonth(m)) out.push(m);
  return out;
}
function nextMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return m === 12 ? `${y! + 1}-01` : `${y}-${String(m! + 1).padStart(2, "0")}`;
}

/** 분모가 이보다 작으면 한 명이 그만둬도 10%p 넘게 오른다 — 칸에 표식. */
export const SMALL_BASE = 10;
/** 색 농도의 끝 — 이 값 이상은 가장 진하다. 경계(경고 기준)가 아니라 연속 눈금이다. */
export const HEAT_CAP = 20;
/** 칸 배경의 노랑 섞는 비율(0~80) — 퇴원율에만 비례한다(분모로 옅게 하지 않는다: 같은 %가 다른 색이면 색의 뜻이 둘이 된다). */
export function heatMix(rate: number | null): number {
  if (rate === null || rate <= 0) return 0;
  return Math.round((Math.min(rate, HEAT_CAP) / HEAT_CAP) * 80);
}

/** 이전 달 "YYYY-MM". */
function prevMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return m === 1 ? `${y! - 1}-12` : `${y}-${String(m! - 1).padStart(2, "0")}`;
}

/**
 * 증감을 낼 **공통** 두 달 — 진행 중이 아닌 가장 최근 달과 그 바로 앞 달(둘 다 표에 있을 때). 강사마다 다른 두 달을 견주지
 * 않는다(그 달이 아직 마감 대기인 강사는 '마감 전'). 없으면 null.
 */
export function comparePair(months: readonly ChurnMonth[]): [string, string] | null {
  const last = [...months].reverse().find((m) => !m.partial)?.month;
  if (!last) return null;
  const before = prevMonth(last);
  return months.some((m) => m.month === before) ? [before, last] : null;
}

/**
 * 가르친 과목 필터 — 고른 기간(`months`) 안에 그 과목을 가르친 달이 있는 강사(Codex 리뷰 2026-11-11: 기간 밖 과목 이력으로 고르지 않는다).
 * ⚠️ 칸의 퇴원율은 과목별 값이 아니라 그 강사의 퇴원율이다(강사평가와 같은 값) — 그래서 필터 이름이 '가르친 과목'이다.
 */
export function taughtIn(row: ChurnTeacherRow, months: readonly ChurnMonth[], subject: string): boolean {
  return subject === "all" || months.some((m) => (row.subjectsByMonth[m.month] ?? []).includes(subject));
}
/** 고른 기간에 누군가 가르친 과목 키. */
export function subjectsTaught(rows: readonly ChurnTeacherRow[], months: readonly ChurnMonth[]): Set<string> {
  return new Set(rows.flatMap((r) => months.flatMap((m) => r.subjectsByMonth[m.month] ?? [])));
}

export type ChurnDelta = { kind: "value"; delta: number } | { kind: "open" } | { kind: "none" };
/** 증감(%p) — 두 칸 다 마감·퇴원율이 있을 때만. 한쪽이 아직 마감 전이면 `open`, 비교할 값이 없으면 `none`. */
export function deltaOf(row: ChurnTeacherRow, pair: readonly [string, string] | null): ChurnDelta {
  if (!pair) return { kind: "none" };
  const a = row.cells[pair[0]], b = row.cells[pair[1]];
  if (!a || !b) return { kind: "none" };
  if (!a.closed || !b.closed) return { kind: "open" };
  if (a.rate === null || b.rate === null) return { kind: "none" };
  return { kind: "value", delta: Math.round((b.rate - a.rate) * 10) / 10 };
}

export type ChurnSort = "recent" | "name";
export const DEFAULT_CHURN_SORT: ChurnSort = "recent";
export function parseChurnSort(raw: unknown): ChurnSort {
  return raw === "name" ? "name" : DEFAULT_CHURN_SORT;
}

/**
 * 정렬 — `recent` = 공통 비교 달(`comparePair`의 뒤 달) 퇴원율 높은 순(마감 전·값 없는 강사는 뒤 · 같으면 이름) · `name` = 가나다.
 */
export function sortTeachers(rows: readonly ChurnTeacherRow[], pair: readonly [string, string] | null, key: ChurnSort): ChurnTeacherRow[] {
  const byName = (a: ChurnTeacherRow, b: ChurnTeacherRow) => a.name.localeCompare(b.name, "ko");
  if (key === "name" || !pair) return [...rows].sort(byName);
  const score = (r: ChurnTeacherRow): number | null => {
    const c = r.cells[pair[1]];
    return c && c.closed ? c.rate : null;
  };
  return [...rows].sort((a, b) => {
    const x = score(a), y = score(b);
    if (x === null || y === null) return x === y ? byName(a, b) : x === null ? 1 : -1;
    return y - x || byName(a, b);
  });
}

/** "2026-04" → "26.04" — 이 카드의 달 표기는 모두 yy.mm(원장 2026-11-11). */
export function yyMm(month: string): string {
  return `${month.slice(2, 4)}.${month.slice(5, 7)}`;
}

/** 퇴원율 글자 — 소수 한 자리(정수면 그대로). */
export function rateText(rate: number): string {
  return `${Number.isInteger(rate) ? rate : rate.toFixed(1)}%`;
}

/** 증감 글자 — "+2.1%p" · "−1.5%p" · "0%p". */
export function deltaText(delta: number): string {
  const abs = Math.abs(delta);
  const n = Number.isInteger(abs) ? String(abs) : abs.toFixed(1);
  return delta > 0 ? `+${n}%p` : delta < 0 ? `−${n}%p` : "0%p";
}
