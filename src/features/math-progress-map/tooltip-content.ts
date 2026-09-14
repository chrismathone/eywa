/**
 * 링 칸에 마우스를 올렸을 때의 툴팁 글 — 순수(Vitest). 화면은 제목 + [라벨, 값] 줄만 그린다.
 * 숫자는 전부 `derive.ts`의 뷰에서 오고 여기서 새로 세지 않는다.
 */
import { formatMdW, formatRange, monthsOfQuarter } from "./calendar";
import type { YearView } from "./derive";
import { monthOf } from "./focus";
import type { PlanVsActual, StudentProgress } from "./model";
import { paceDelta } from "./pace";
import { STATUS_LABEL } from "./palette";

export type HoverTarget =
  | { kind: "month"; month: number }
  | { kind: "week"; month: number; week: number }
  | { kind: "day"; date: string }
  | { kind: "quarter"; q: 1 | 2 | 3 | 4 };

export type TooltipContent = { title: string; rows: [label: string, value: string][] };

const pageRange = (a: number | null, b: number | null): string => (a != null && b != null ? `p.${a} → p.${b}` : "—");

export function tooltipContent(
  view: YearView,
  progress: StudentProgress,
  pace: PlanVsActual,
  target: HoverTarget,
): TooltipContent {
  if (target.kind === "quarter") {
    const q = view.quarters[target.q - 1]!;
    const months = monthsOfQuarter(target.q);
    return {
      title: `${target.q}분기 (${months[0]}~${months[2]}월)`,
      rows: [
        ["진도율", `${q.pct}% (${q.donePages} / ${q.plannedPages}쪽)`],
        ["달별", q.months.map((m) => `${m.month}월 ${m.pct}%`).join(" · ")],
      ],
    };
  }
  if (target.kind === "month") {
    const m = monthOf(view, target.month);
    // 계획 범위는 진도율의 분모와 **같은 출처**(기록이 있으면 기록의 범위, 없으면 연간 계획) — 둘이 다른 분모를 말하지 않게.
    const rows: TooltipContent["rows"] = [
      ["교재", m.plan?.bookName ?? "—"],
      ["단원", m.plan?.chapter ?? "—"],
      ["계획", pageRange(m.pageFrom, m.pageTo)],
    ];
    if (m.isCurrent) rows.push(["현재", `p.${progress.curriculum.currentPage}`]);
    rows.push(["진도율", `${m.pct}% (${m.donePages} / ${m.plannedPages}쪽)`], ["상태", STATUS_LABEL[m.status]]);
    if (m.isCurrent) rows.push(["계획 대비", paceDelta(pace.differenceDays)]);
    return { title: `${view.year}년 ${m.month}월`, rows };
  }
  if (target.kind === "week") {
    const m = monthOf(view, target.month);
    const w = m.weeks.find((x) => x.index === target.week);
    if (!w) return { title: `${m.month}월 ${target.week}주차`, rows: [] };
    const rows: TooltipContent["rows"] = [
      ["교재", m.plan?.bookName ?? "—"],
      ["단원", w.topic ?? m.plan?.chapter ?? "—"],
      ["계획", pageRange(w.pageFrom, w.pageTo)],
    ];
    if (w.isCurrent) rows.push(["현재", `p.${progress.curriculum.currentPage}`]);
    rows.push(["진도율", `${w.pct}% (${w.donePages} / ${w.plannedPages}쪽)`], ["상태", STATUS_LABEL[w.status]]);
    if (w.isCurrent) rows.push(["계획 대비", paceDelta(pace.differenceDays)]);
    return { title: `${m.month}월 ${w.index}주차 (${formatRange(w.start, w.end)})`, rows };
  }
  const month = Number(target.date.slice(5, 7));
  const day = monthOf(view, month).weeks.flatMap((w) => w.days).find((d) => d.date === target.date);
  const r = day?.record ?? null;
  if (!day || !r) return { title: formatMdW(target.date), rows: [["상태", "기록 없음"]] };
  const rows: TooltipContent["rows"] = [
    ["교재", r.bookName],
    ["단원", r.subChapter ? `${r.chapter} › ${r.subChapter}` : r.chapter],
  ];
  if (day.plannedPages > 0) {
    rows.push(["계획", `p.${r.startPage}~${r.endPage} (${day.plannedPages}쪽)`]);
    rows.push(["완료", day.donePages > 0 ? `p.${r.completedPage} (${day.donePages} / ${day.plannedPages}쪽)` : "아직 없음"]);
  }
  rows.push(["상태", STATUS_LABEL[day.status]]);
  if (r.note) rows.push(["메모", r.note]);
  return { title: formatMdW(target.date), rows };
}
