/**
 * 수업보고서 · 출결 기록 항목 — 수업 의무(`teacherDuties`)를 지표 한 칸으로 만든다. 순수 함수.
 *
 * 🔴 **본인이 수업 당일에 쓴 것만 작성, 나머지는 전부 미작성**(원장 2026-10-14 *"당일 수업을 당일에 작성하지 않으면 점수에서는
 *    미작성으로 취급할것"* · *"대리 이런건 됐고, 오로지 작성/미작성만"* · *"본인의 작성/미작성만 카운트할것"*).
 */
import { round1 } from "./dates";
import type { TeacherDuties } from "./duties";
import { METRIC_MAX, type AttendanceMetric, type ReportMetric } from "./types";

export function reportItem(duties: TeacherDuties): ReportMetric {
  const cells = duties.reportCells;
  const written = cells.filter((c) => c.state === "own").length;
  const ratio = cells.length ? (100 * written) / cells.length : null;
  return {
    id: "report", max: METRIC_MAX.report,
    value: duties.untracked ? null : ratio === null ? 0 : round1((METRIC_MAX.report * written) / cells.length),
    raw: duties.untracked ? null : ratio,
    basis: duties.untracked ? `외부 보고 대상 ${duties.untracked}건` : `작성 ${written} / 대상 ${cells.length} · 미작성 ${cells.length - written}`,
    reason: duties.untracked
      ? "앱 밖에서 보고하는 과목이거나 작성 면제 강사라 작성 여부를 확인할 수 없는 대상이 있습니다."
      : "본인이 수업 당일(한국 시간)에 쓴 보고서만 작성으로 셉니다. 다른 사람이 쓴 것·다음 날 이후에 쓴 것은 미작성입니다. 학생·수업일마다 한 번만 세고, 결석·휴원일·보고서 제외 반은 대상에서 뺐습니다.",
    detail: cells,
  };
}

export function attendanceItem(duties: TeacherDuties): AttendanceMetric {
  const rows = duties.attendance;
  const done = rows.filter((r) => r.done).length;
  return {
    id: "attendance", max: METRIC_MAX.attendance,
    value: rows.length ? round1((METRIC_MAX.attendance * done) / rows.length) : 0,
    raw: rows.length ? (100 * done) / rows.length : null,
    basis: `작성 ${done} / 대상 ${rows.length}건 · 미작성 ${rows.length - done}`,
    reason: "수업을 맡은 날 그 학생의 출결을 본인이 수업 당일(한국 시간)에 넣었으면 작성입니다. 다른 사람(데스크·키오스크)이 넣은 것·다음 날 이후에 넣은 것은 미작성입니다.",
    detail: rows,
  };
}
