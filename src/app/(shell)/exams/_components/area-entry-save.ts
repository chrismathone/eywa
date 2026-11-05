import { saveGradeScores } from "@/features/grades/server/actions";
import type { SchoolRoster } from "@/features/grades/unified/server/entry-actions";
import { areaEntriesFor, type AreaDraft, type AreaGridRow } from "./area-entry-grid";
import type { EntryResult } from "./entry-grid";

/**
 * 학교 시험·월말 명단 → 입력 줄. 영역 점수(영어 Monthly Test)도 함께 싣는다 — 영역 표만 그 값을 읽는다.
 * (만점이 같을 때만 오늘 수학 점수를 '오늘 수학' 표시용으로 싣는다.)
 */
export function schoolRowsOf(roster: SchoolRoster | null, classNamesOf: Record<string, string>, subject: string): AreaGridRow[] {
  return (roster?.rows ?? []).map((r) => {
    const tm = roster?.todaysMath?.[r.studentId];
    return { studentId: r.studentId, name: r.name, school: r.school, grade: r.grade,
      className: classNamesOf[`${r.studentId}|${subject}`] ?? r.className, existing: r.score,
      lockedReason: r.withdrawn ? "퇴원" : !r.applies ? "해당 없는 시험" : null,
      todaysMath: tm?.maxScore === roster?.selection.maxScore ? tm?.score ?? null : null, areas: r.areas };
  });
}

/**
 * 영어 Monthly Test 명단 저장 — 영역이 달라진 학생만 기존 명단 일괄 저장(`saveGradeScores`)으로 보낸다.
 * 서버가 영역의 합으로 점수를 다시 정하고, 성공하면 명단의 '저장된 값'을 올려 같은 줄이 다시 나가지 않게 한다.
 */
export async function saveAreaRoster(roster: SchoolRoster, rows: AreaGridRow[], draft: Record<string, AreaDraft>): Promise<{
  notice: { ok: boolean; text: string }; roster?: SchoolRoster; results: Record<string, EntryResult>;
}> {
  const entries = areaEntriesFor(rows, draft);
  if (!entries.length) return { notice: { ok: true, text: "바뀐 점수가 없습니다" }, results: {} };
  const sel = roster.selection;
  const fd = new FormData();
  fd.set("year", String(sel.year)); fd.set("term", String(sel.term)); fd.set("subject", sel.subject); fd.set("class", sel.classId);
  fd.set("slot", sel.slot); fd.set("date", sel.date); fd.set("max", String(sel.maxScore)); fd.set("entries", JSON.stringify(entries));
  const res = await saveGradeScores(undefined, fd);
  if (res?.error) return { notice: { ok: false, text: res.error }, results: {} };
  const saved = new Map(entries.map((e) => [e.studentId, e] as const));
  return {
    notice: { ok: true, text: `${res?.saved ?? entries.length}명 저장했습니다` },
    roster: { ...roster, rows: roster.rows.map((r) => { const e = saved.get(r.studentId); return e ? { ...r, score: e.score, areas: e.areas } : r; }) },
    results: Object.fromEntries(entries.map((e) => [e.studentId, { ok: true } as const])),
  };
}
