/**
 * '퇴원생 관리 차트'(구글 시트)의 **담당선생님**을 과거 퇴원의 정답으로 쓴다(순수 · Vitest).
 * 원장 2026-11-11 *"시트대로 일단 맞춰놓고 이후에는 우리데이터 같은 퇴원보고서 및 관련 데이터로 측정하면 되지않나? 시트가 지금
 * 정확한 데이터니까"* — 시트는 그때 담임(퇴사한 김민주·이유정·권나현 선생님 포함)을 적었고, 에이와는 인계 기록이 비어 지금 담임으로
 * 소급하거나 아무에게도 안 붙였다.
 *
 * - 쓰는 달 = 시트의 'YY.M 퇴원' 탭 중 `SHEET_LAST_MONTH`까지. 그 뒤는 에이와 판정(`exit-homeroom.ts`)만 — 지금은 퇴원 처리가
 *   시트에 자동으로 적히므로(`withdrawal-sheet.ts`) 그 뒤 달을 시트로 읽으면 에이와 판정을 되읽는 셈이다.
 * - 줄 찾기 = 이름(띄어쓰기·대소문자 무시) + 과목 + 달. 달은 퇴원관리의 센 달 → 실제 날짜의 달 → 그 앞뒤 한 달 순서(시트는 1일 종료를
 *   전달로 적는 등 한 달씩 어긋난다). 못 찾으면 null — 호출부가 에이와 판정으로 넘어간다.
 * - 선생님 칸에 여럿이면(`김윤하/김은정`) 모두.
 */
import { monthTabKey, sheetLayoutOf } from "./withdrawal-sheet-model";

/** 시트 '학교/학년' 글(`경명여중1` · `달성초6`) → 학교·학년(`경명여중` · `중1`). 학년 숫자가 없으면 학교만. */
export function splitSchoolGrade(text: string | null): { school: string | null; grade: string | null } {
  const t = (text ?? "").replace(/\s+/g, "");
  const m = /^(.*?([초중고]))(\d)$/.exec(t);
  if (!m) return { school: t || null, grade: null };
  return { school: m[1]!, grade: `${m[2]}${m[3]}` };
}

/** 이름 대조 키 — 띄어쓰기·대소문자 무시. `loose`는 끝의 동명이인 알파벳(`권민서A`)을 뗀다(정확히 맞는 줄이 없을 때만). */
export function nameKey(name: string, loose = false): string {
  const k = name.replace(/\s+/g, "").toUpperCase();
  return loose ? k.replace(/(?<=[가-힣])[A-Z]$/, "") : k;
}

/** 시트를 정답으로 쓰는 마지막 달(원장 2026-11-11 — 그 뒤는 에이와 데이터로 잰다). */
export const SHEET_LAST_MONTH = "2026-10";

export type SheetTeacherIndex = ReadonlyMap<string, readonly string[]>;

const normName = (s: string) => s.replace(/\s+/g, "").toUpperCase();
const keyOf = (month: string, subject: string, name: string) => `${month}|${subject}|${normName(name)}`;

/** 시트 과목 글 → 과목 키. 모르면 null(그 줄은 쓰지 않는다). */
export function sheetSubjectKey(text: string): "math" | "english" | null {
  if (/수학/.test(text)) return "math";
  if (/영어|eie/i.test(text)) return "english";
  return null;
}

/** 시트 한 줄 — 퇴원관리가 2026-10까지 이 줄들을 통계로 그대로 쓴다(`sheet-exit-rows.ts`). */
export type SheetExitRecord = {
  /** 탭의 달(`YYYY-MM`) — 시트가 그 퇴원을 센 달. */
  month: string;
  subject: "math" | "english";
  /** EiE로 적힌 줄(프로그램 판정). */
  eie: boolean;
  name: string;
  teachers: string[];
  /** '학교/학년' 칸 글 그대로. */
  schoolGrade: string | null;
  className: string | null;
  /** '최종퇴원일'을 읽을 수 있으면 `YYYY-MM-DD`. */
  date: string | null;
  reason: string | null;
  memo: string | null;
};

type Tab = { title: string; rows: readonly (readonly string[])[] };
const clean = (s: string | undefined) => (s ?? "").replace(/\s+/g, " ").trim() || null;

/** '최종퇴원일' 글(`26.10.07` · `2026.7.29` · `26.9.30` · `2026-11-13(목)`) → `YYYY-MM-DD`. 못 읽으면 null. */
export function sheetDateOf(text: string | undefined): string | null {
  const m = /(\d{2,4})[.\-/]\s*(\d{1,2})[.\-/]\s*(\d{1,2})/.exec(text ?? "");
  if (!m) return null;
  const y = m[1]!.length === 2 ? `20${m[1]}` : m[1]!;
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** 달 탭들 → 시트 줄들. 머리줄을 못 찾는 탭·`SHEET_LAST_MONTH` 뒤 탭·이름이나 과목이 없는 줄은 건너뛴다. */
export function buildSheetExitRecords(tabs: readonly Tab[]): SheetExitRecord[] {
  const out: SheetExitRecord[] = [];
  for (const tab of tabs) {
    const k = monthTabKey(tab.title);
    if (k == null) continue;
    const month = `20${String(Math.floor(k / 100)).padStart(2, "0")}-${String(k % 100).padStart(2, "0")}`;
    if (month > SHEET_LAST_MONTH) continue;
    const layout = sheetLayoutOf(tab.rows);
    if (!layout) continue;
    const head = tab.rows[layout.headerRow]!.map((c) => c.replace(/\s+/g, ""));
    const reasonCol = head.findIndex((c) => c.startsWith("퇴원사유(대분류"));
    const memoCol = head.findIndex((c) => c.startsWith("퇴원사유(상세"));
    for (const row of tab.rows.slice(layout.headerRow + 1)) {
      const name = (row[layout.nameCol] ?? "").trim();
      const subjectText = row[layout.subjectCol] ?? "";
      const subject = sheetSubjectKey(subjectText);
      if (!name || !subject || !/^\d+$/.test((row[layout.numberCol] ?? "").trim())) continue;
      out.push({
        month,
        subject,
        eie: /eie/i.test(subjectText),
        name,
        teachers: [...new Set((row[layout.teacherCol] ?? "").split(/[/,·]/).map((t) => t.trim()).filter(Boolean))],
        schoolGrade: clean(row[layout.schoolCol]),
        className: clean(row[layout.classCol]),
        date: sheetDateOf(row[layout.withdrawnCol]),
        reason: reasonCol >= 0 ? clean(row[reasonCol]) : null,
        memo: memoCol >= 0 ? clean(row[memoCol]) : null,
      });
    }
  }
  return out;
}

/** 시트 줄들 → (달·과목·이름) → 담당선생님 이름들. */
export function sheetTeacherIndexOf(records: readonly SheetExitRecord[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const r of records) {
    if (!r.teachers.length) continue;
    const key = keyOf(r.month, r.subject, r.name);
    out.set(key, [...new Set([...(out.get(key) ?? []), ...r.teachers])]);
  }
  return out;
}

/** 달 탭들 → 담당선생님 표(`buildSheetExitRecords` → `sheetTeacherIndexOf`). */
export function buildSheetTeacherIndex(tabs: readonly Tab[]): Map<string, string[]> {
  return sheetTeacherIndexOf(buildSheetExitRecords(tabs));
}

const shiftMonth = (ym: string, n: number) => {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y!, m! - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};

/** 이 줄의 시트 담당선생님 이름들 — 못 찾으면 null. `months` = [센 달, 실제 날짜의 달](앞일수록 먼저). */
export function sheetTeachersFor(index: SheetTeacherIndex, input: { name: string; subject: string; months: readonly string[] }): readonly string[] | null {
  // 시트를 쓰는 달 뒤에 센 줄은 에이와 데이터로만(앞뒤 한 달로 넘어가 옛 줄을 집지 않게).
  if (input.months.every((m) => m > SHEET_LAST_MONTH)) return null;
  const tries = [...input.months, ...input.months.flatMap((m) => [shiftMonth(m, -1), shiftMonth(m, 1)])];
  for (const m of [...new Set(tries)]) {
    if (m > SHEET_LAST_MONTH) continue;
    const hit = index.get(keyOf(m, input.subject, input.name));
    if (hit) return hit;
  }
  // 정확히 맞는 이름이 없으면 끝의 동명이인 알파벳을 떼고 한 번 더(`권민서A` ↔ 시트 `권민서`).
  const loose = nameKey(input.name, true);
  for (const m of [...new Set(tries)]) {
    if (m > SHEET_LAST_MONTH) continue;
    const prefix = `${m}|${input.subject}|`;
    for (const [k, v] of index) if (k.startsWith(prefix) && nameKey(k.slice(prefix.length), true) === loose) return v;
  }
  return null;
}

/** 시트 이름을 에이와 계정으로 못 이었을 때의 표시 전용 id — 이름 그대로 보인다(`teacherNames`). */
export const SHEET_TEACHER_PREFIX = "sheet:";
