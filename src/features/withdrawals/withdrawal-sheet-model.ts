/**
 * **수학 퇴원생 → '퇴원생 관리 차트' 구글시트** 기입 규칙(원장 2026-10-07) — 순수 모듈(Vitest로 잠금). 시트를 읽고 쓰는 쪽은
 * `server/withdrawal-sheet.ts`.
 *
 * 원장: *"학생 퇴원처리 시 시트로 자동 기입 … 학생명, 학교학년, 반명, 과목, 담당선생님, 등록일(메이크에듀 첫 등록일), 최종퇴원일,
 * 재원기간(개월) … 수학과 퇴원일 때만 … 년도와 월에 맞는 시트(26년 9월 퇴원이면 '26.9 퇴원')"*.
 * 같은 날 확정: 그 달 탭이 없으면 **직전 달 탭을 복사**해 만든다 · '수학만 퇴원'(다른 과목은 계속)도 적는다(반이동 제외) ·
 * 퇴원사유 칸은 **비워 둔다**(사람이 적는다). 재원캠퍼스는 같은 날 후속 지시로 채운다 — *"강의실에 따라 본원이면 본원, 고수면 고등관"*
 * (`campusOf`).
 *
 * 🔑 시트 모양을 고정 좌표로 가정하지 않는다 — 탭마다 머리줄 위치가 다르다(9월 탭은 1행 제목이 A1, 8월 탭은 B1). 그래서
 *    **머리줄을 글자로 찾고**(`최종퇴원일`이 있는 줄) 칸 위치를 머리 글자로 정한다. 학생명 칸만은 머리가 병합돼 글자가 왼쪽에
 *    붙어 있어(9월 탭: 머리 A='학생명', 값은 B) `학교/학년` 바로 왼쪽으로 정한다. A열은 사람이 매긴 번호다.
 */

import { roomGroupOf } from "@/features/timetable/lib/room-groups";

/** 시트 머리 글자 — 이 글자로 칸 위치를 찾는다. */
const HEAD = {
  school: "학교/학년",
  className: "반명",
  subject: "과목",
  teacher: "담당선생님",
  campus: "재원캠퍼스",
  enrolled: "등록일",
  withdrawn: "최종퇴원일",
  period: "재원기간",
} as const;

export type SheetLayout = {
  /** 머리줄(0-based 행 번호). 값은 그다음 줄부터. */
  headerRow: number;
  /** 0-based 열 번호. */
  numberCol: number;
  nameCol: number;
  schoolCol: number;
  classCol: number;
  subjectCol: number;
  teacherCol: number;
  /** 재원캠퍼스 — 머리에 없으면 -1(그 칸은 안 쓴다). */
  campusCol: number;
  enrolledCol: number;
  withdrawnCol: number;
  periodCol: number;
  /** 머리줄의 마지막 칸(새 탭을 비울 때 여기까지). */
  lastCol: number;
};

const norm = (s: string | undefined) => (s ?? "").replace(/\s+/g, "");

/** 머리줄을 찾아 칸 위치를 정한다. 못 찾으면 null(모양이 바뀐 탭에 엉뚱하게 쓰지 않는다). */
export function sheetLayoutOf(rows: readonly (readonly string[])[]): SheetLayout | null {
  const headerRow = rows.findIndex((r) => r.some((c) => norm(c) === HEAD.withdrawn));
  if (headerRow < 0) return null;
  const head = rows[headerRow]!.map(norm);
  const at = (label: string) => head.findIndex((c) => c === label);
  const schoolCol = at(HEAD.school);
  const classCol = at(HEAD.className);
  const subjectCol = at(HEAD.subject);
  const teacherCol = at(HEAD.teacher);
  const enrolledCol = at(HEAD.enrolled);
  const withdrawnCol = at(HEAD.withdrawn);
  const periodCol = head.findIndex((c) => c.startsWith(HEAD.period));
  const cols = [schoolCol, classCol, subjectCol, teacherCol, enrolledCol, withdrawnCol, periodCol];
  if (cols.some((c) => c < 0) || schoolCol < 2) return null;
  let lastCol = head.length - 1;
  while (lastCol > 0 && !head[lastCol]) lastCol--;
  return {
    headerRow,
    numberCol: 0,
    nameCol: schoolCol - 1,
    schoolCol,
    classCol,
    subjectCol,
    teacherCol,
    campusCol: at(HEAD.campus),
    enrolledCol,
    withdrawnCol,
    periodCol,
    lastCol,
  };
}

/** 강의실 건물명 → 시트의 캠퍼스 이름(원장 2026-10-07 *"본원이면 본원, 고수면 고등관"*). 목록에 없는 건물은 이름 그대로. */
const CAMPUS_OF_BUILDING: Record<string, string> = { 본원: "본원", 고수: "고등관" };

/**
 * 반의 강의실 이름들(`본원201`·`고수801`) → 재원캠퍼스. 가장 많이 쓴 건물을 고른다(한 반이 두 건물을 오가면 다수결 · 같으면 먼저 나온 쪽).
 * 강의실을 모르면 빈 칸(추측해 적지 않는다).
 */
export function campusOf(roomNames: readonly (string | null | undefined)[]): string {
  const count = new Map<string, number>();
  for (const name of roomNames) {
    const n = (name ?? "").trim();
    if (!n) continue;
    const b = roomGroupOf(n).building;
    count.set(b, (count.get(b) ?? 0) + 1);
  }
  let best = "";
  let max = 0;
  for (const [b, c] of count) {
    if (c > max) {
      best = b;
      max = c;
    }
  }
  return best ? (CAMPUS_OF_BUILDING[best] ?? best) : "";
}

/** `2026-09-30` → `26.09.30`(시트의 날짜 표기). */
export function sheetDate(ymd: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd ?? "");
  return m ? `${m[1]!.slice(2)}.${m[2]}.${m[3]}` : "";
}

/** 시트 날짜 비교용 — `26.9.30`·`26.09.30`·`2026-09-30`을 같은 값으로. */
function dateKey(s: string): string {
  const m = /(\d{2,4})\D+(\d{1,2})\D+(\d{1,2})/.exec(s.trim());
  if (!m) return s.trim();
  const y = m[1]!.length === 4 ? m[1]!.slice(2) : m[1]!;
  return `${y}.${m[2]!.padStart(2, "0")}.${m[3]!.padStart(2, "0")}`;
}

/**
 * 재원기간(개월) — **달력 달 차이**(등록 달 → 퇴원 달), 최소 1(한 달도 안 다녀도 '1개월').
 * 시트의 사람 기록과 가장 많이 맞는 규칙이다(26.02 → 26.09 = 7, 23.11 → 26.09 = 34, 26.08.31 → 26.09.30 = 1).
 * 등록일을 모르면 빈 칸.
 */
export function tenureMonths(enrolledAt: string | null | undefined, withdrawnAt: string): string {
  const a = /^(\d{4})-(\d{2})/.exec(enrolledAt ?? "");
  const b = /^(\d{4})-(\d{2})/.exec(withdrawnAt);
  if (!a || !b) return "";
  const diff = (Number(b[1]) - Number(a[1])) * 12 + (Number(b[2]) - Number(a[2]));
  return `${Math.max(1, diff)}개월`;
}

/** 퇴원일 → 그 달 탭 이름(`26.9 퇴원`). 시트의 기존 탭과 같은 모양(월은 0 없이). */
export function monthTabTitle(ymd: string): string {
  const [y, m] = ymd.split("-");
  return `${y!.slice(2)}.${Number(m)} 퇴원`;
}

/** 탭 이름이 'YY.M 퇴원'이면 정렬 키(YYMM 수), 아니면 null. 띄어쓰기는 무시한다. */
export function monthTabKey(title: string): number | null {
  const m = /^(\d{2})\.(\d{1,2})퇴원$/.exec(norm(title));
  if (!m) return null;
  const month = Number(m[2]);
  return month >= 1 && month <= 12 ? Number(m[1]) * 100 + month : null;
}

/** 그 달 탭(띄어쓰기 무시)을 찾는다. */
export function findMonthTab<T extends { title: string }>(tabs: readonly T[], ymd: string): T | null {
  const want = monthTabKey(monthTabTitle(ymd));
  return tabs.find((t) => monthTabKey(t.title) === want) ?? null;
}

/** 새 탭의 본보기 — 그 달보다 **앞선** 달 탭 중 가장 최근(없으면 아무 달 탭 중 최근). */
export function templateTabFor<T extends { title: string }>(tabs: readonly T[], ymd: string): T | null {
  const want = monthTabKey(monthTabTitle(ymd))!;
  const months = tabs
    .map((t) => ({ t, k: monthTabKey(t.title) }))
    .filter((x): x is { t: T; k: number } => x.k != null)
    .sort((a, b) => b.k - a.k);
  return (months.find((x) => x.k < want) ?? months[0])?.t ?? null;
}

/** 새 탭 제목 칸 글자(`2026.10월 학습종료퇴원`) — 기존 탭의 제목 모양 그대로. */
export function monthTitleText(ymd: string): string {
  const [y, m] = ymd.split("-");
  return `${y}.${m}월 학습종료퇴원`;
}

export type SheetEntry = {
  name: string;
  schoolGrade: string;
  className: string;
  subject: string;
  teacher: string;
  /** 재원캠퍼스(`campusOf`) — 모르면 빈 문자열(칸을 안 쓴다). */
  campus?: string;
  enrolledAt: string | null;
  withdrawnAt: string;
};

/** 같은 학생·같은 반·같은 퇴원일 줄이 이미 있는가 — 두 번 눌러도 한 줄만. */
export function alreadyListed(rows: readonly (readonly string[])[], layout: SheetLayout, e: SheetEntry): boolean {
  const out = dateKey(sheetDate(e.withdrawnAt));
  return rows.slice(layout.headerRow + 1).some(
    (r) =>
      norm(r[layout.nameCol]) === norm(e.name) &&
      dateKey(r[layout.withdrawnCol] ?? "") === out &&
      (!norm(r[layout.classCol]) || !norm(e.className) || norm(r[layout.classCol]) === norm(e.className)),
  );
}

/**
 * 적을 줄(1-based)과 번호 — 머리줄 아래 **이름 칸이 빈 첫 줄**. 사람이 번호만 매겨 둔 빈 줄을 그대로 쓴다.
 * 빈 줄이 없으면 맨 아래 다음 줄에 쓰고 번호를 이어 매긴다(`number`가 있으면 A열에도 쓴다).
 * `taken` = 이번 실행에서 이미 쓴 줄(한 번에 두 반을 적을 때 같은 줄에 겹치지 않게).
 */
export function nextRowOf(
  rows: readonly (readonly string[])[],
  layout: SheetLayout,
  taken: ReadonlySet<number> = new Set(),
): { row: number; number: string | null } {
  let lastNo = 0;
  for (let i = layout.headerRow + 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const no = Number(norm(r[layout.numberCol]));
    if (Number.isFinite(no) && no > 0) lastNo = Math.max(lastNo, no);
    if (taken.has(i + 1)) continue;
    const empty = [layout.nameCol, layout.schoolCol, layout.classCol, layout.withdrawnCol].every((c) => !norm(r[c]));
    if (empty) return { row: i + 1, number: norm(r[layout.numberCol]) ? null : String(lastNo + 1) };
  }
  let row = Math.max(rows.length, layout.headerRow + 1) + 1;
  while (taken.has(row)) {
    row++;
    lastNo++;
  }
  return { row, number: String(lastNo + 1) };
}

/** 한 줄에 쓸 칸들(0-based 열 → 값). 퇴원사유 칸은 건드리지 않는다 · 캠퍼스는 알 때만. */
export function entryCells(layout: SheetLayout, e: SheetEntry, number: string | null): Map<number, string> {
  const cells = new Map<number, string>();
  if (number) cells.set(layout.numberCol, number);
  cells.set(layout.nameCol, e.name);
  cells.set(layout.schoolCol, e.schoolGrade);
  cells.set(layout.classCol, e.className);
  cells.set(layout.subjectCol, e.subject);
  cells.set(layout.teacherCol, e.teacher);
  if (layout.campusCol >= 0 && e.campus) cells.set(layout.campusCol, e.campus);
  cells.set(layout.enrolledCol, sheetDate(e.enrolledAt));
  cells.set(layout.withdrawnCol, sheetDate(e.withdrawnAt));
  cells.set(layout.periodCol, tenureMonths(e.enrolledAt, e.withdrawnAt));
  return cells;
}

/** 0-based 열 → `A`·`B`…`Z`·`AA`. */
export function colLetter(i: number): string {
  let s = "";
  let n = i + 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** 수학 퇴원으로 적을 수강인가 — 판정만(조회는 서버). */
export type EnrollmentFact = {
  id: string;
  endDate: string | null;
  isTransferred: boolean;
  isMath: boolean;
};

/**
 * 이 날 **수학을 그만둔** 수강들 — 그날 끝났고 반이동이 아니며, 그 뒤에도 **열려 있는 수학 수강이 하나도 없을 때만**.
 * (반이동·수학 반 하나만 정리하고 다른 수학 반은 계속 다니는 경우는 퇴원이 아니다.)
 * `only`를 주면 그 수강들만 본다(수강 종료 화면에서 고른 것).
 */
export function mathWithdrawalsOn(
  facts: readonly EnrollmentFact[],
  date: string,
  only?: ReadonlySet<string>,
): EnrollmentFact[] {
  const math = facts.filter((f) => f.isMath);
  const stillOpen = math.some((f) => f.endDate == null || f.endDate > date);
  if (stillOpen) return [];
  return math.filter((f) => f.endDate === date && !f.isTransferred && (!only || only.has(f.id)));
}
