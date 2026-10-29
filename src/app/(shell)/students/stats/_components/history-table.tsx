import type { HistoryField, HistoryYear } from "@/features/students/stats/history";
import type { HistoryPrograms } from "./history-board";

const fmt = (n: number | undefined) => (n === undefined ? "—" : n.toLocaleString("ko-KR"));

/**
 * '지난 기록' 연도별 표 — 최근 해가 위(월별 기록 표와 같은 모양). 학생 수는 값이 있는 달의 월평균, 신규는 합(`yearlyHistory`).
 * 값이 없는 칸은 '—'(0과 다르다) · 열두 달이 안 찬 해는 달 수를 적고, 그해 다른 칸보다 적은 달로 낸 칸은 그 칸에 달 수를 적는다
 * (2026년 메이크에듀 기록은 1~3월뿐). 값이 한 해도 없는 열(EiE가 없는 지점 · 메이크에듀를 쓰지 않은 지점 · 수납 권한이 없어 청구 칸을
 * 받지 않은 사람)은 세우지 않는다.
 */
export function HistoryTable({
  years,
  hasEie,
  split,
  programs,
  shown,
  subjectKeys = [],
}: {
  years: readonly HistoryYear[];
  hasEie: boolean;
  split: boolean;
  programs: HistoryPrograms;
  /** 차트에 선 칸 — 프로그램 열은 차트와 같은 기준으로 세운다(값이 늘 0인 프로그램은 열도 없다). */
  shown: ReadonlySet<HistoryField>;
  /** 그 밖의 과목을 과목마다 세운 열(차트의 과목 선과 같은 과목 · 원장 2026-10-28) — 있으면 '그 밖의 과목' 열 대신. */
  subjectKeys?: readonly string[];
}) {
  const cell = "px-2 py-1.5";
  const ordered = [...years].reverse();
  const has = (f: HistoryField) => years.some((y) => y[f] !== undefined);
  type Column = { key: string; label: string; bold?: boolean; value: (y: HistoryYear) => number | undefined; months: (y: HistoryYear) => number | undefined };
  const field = (key: HistoryField, label: string, bold?: boolean): Column => ({ key, label, bold, value: (y) => y[key], months: (y) => y.fieldMonths[key] });
  const subject = (k: string): Column => ({
    key: `subject:${k}`,
    label: `${programs.subjects?.[k]?.label ?? k}(월평균)`,
    value: (y) => y.subjects?.[k],
    months: (y) => y.subjectMonths?.[k],
  });
  const columns: Column[] = [
    ...(split && shown.has("payingMath") ? [field("payingMath", `${programs.math.label}(월평균)`)] : []),
    ...(split && shown.has("payingInjaewon") ? [field("payingInjaewon", `${programs.injaewon.label}(월평균)`)] : []),
    ...(split ? subjectKeys.map(subject) : []),
    ...(split && shown.has("payingOther") && !subjectKeys.length ? [field("payingOther", "그 밖의 과목(월평균)")] : []),
    ...(has("payingGeneral") ? [field("payingGeneral", hasEie ? "EiE 외 수업(월평균)" : "수업료가 청구된 학생(월평균)")] : []),
    ...(hasEie ? [field("payingEie", `${programs.eie.label}(월평균)`)] : []),
    field("newReal", "실제 신규", true),
    ...(has("stoppedPaying") ? [field("stoppedPaying", "청구가 끊긴 학생")] : []),
    ...(has("enrolledRecord") ? [field("enrolledRecord", "메이크에듀 재원생 기록(월평균)")] : []),
  ];
  return (
    <details open>
      <summary className="text-primary cursor-pointer text-sm font-medium select-none">연도별 표</summary>
      <div className="mt-2 overflow-x-auto px-1">
        <table className="w-full min-w-[420px] border-collapse text-sm [&_tr>*:not(:first-child)]:border-l [&_tr>*:not(:first-child)]:border-line-faint">
          <thead>
            <tr className="border-line text-muted-foreground border-b text-xs">
              <th className={`${cell} text-center font-medium`}>연도</th>
              {columns.map((c) => (
                <th key={c.key} className={`${cell} text-right font-medium`}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="num">
            {ordered.map((y) => (
              <tr key={y.year} className="border-line-faint border-b">
                <td className={`${cell} text-center whitespace-nowrap`}>
                  {y.year}년{y.months < 12 ? <span className="text-muted-foreground"> ({y.months}개월)</span> : null}
                </td>
                {columns.map((c) => {
                  const n = c.months(y);
                  return (
                    <td key={c.key} className={`${cell} text-right whitespace-nowrap${c.bold ? " font-bold" : ""}`}>
                      {fmt(c.value(y))}
                      {n !== undefined && n < y.months ? <span className="text-muted-foreground font-normal"> ({n}개월)</span> : null}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
