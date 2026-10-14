/**
 * 퇴원율 계산기 하나 — 강사평가(`build.ts`)와 시간표 X 겹침(`withdrawals/server/exit-overlay.ts`)이 **이 함수**를 같은 재료로 부른다
 * (원장 2026-10-14 *"모든 데이터가 일치해야함. 이쪽만 다른 출력이 되면 안됨"*). 판정은 `churn.ts` 한 벌이고, 여기서는 선생님 × 기간
 * 결과를 한 번만 계산해 둔다. 순수 함수.
 */
import type { ChurnOptions } from "../evaluation/config";
import { churnResult, type ChurnResult } from "./churn";
import { addDays, daysBetween } from "./dates";
import type { ChurnSource } from "./students";
import type { PeriodWindow, PortfolioSnapshot, SnapshotClass } from "./types";

type Window = Pick<PeriodWindow, "start" | "end">;
export type ChurnModel = {
  /** 근거 화면·점수에 싣는 퇴원율. */
  period: (teacherId: string, w: Window) => ChurnResult["metric"];
  /** 그 기간 이 선생님 퇴원율에 넣은 그만둠 — 학생과 과목(시간표 X 겹침의 담당 선생님). */
  exits: (teacherId: string, w: Window) => ChurnResult["exits"];
  /** 그 기간 분모가 있는 선생님 → 분모 학생을 정규 수업으로 가르친 과목(시간표 X 겹침의 '퇴원 0'). */
  eligibleSubjects: (w: Window) => ReadonlyMap<string, ReadonlySet<string>>;
};

export function buildChurnModel(input: {
  source: ChurnSource; classes: readonly SnapshotClass[]; options: ChurnOptions;
} & Pick<PortfolioSnapshot, "futureEnrollments" | "studentReasons">): ChurnModel {
  const classes = new Map(input.classes.map((c) => [c.id, c]));
  const results = new Map<string, ChurnResult>();
  const run = (teacherId: string, w: Window) => {
    const key = `${teacherId}|${w.start}|${w.end}`;
    let r = results.get(key);
    if (!r) results.set(key, (r = churnResult({ ...input, classes, teacherId, w })));
    return r;
  };
  return {
    period: (teacherId, w) => run(teacherId, w).metric,
    exits: (teacherId, w) => run(teacherId, w).exits,
    eligibleSubjects(w) {
      const prevEnd = addDays(w.start, -1);
      const teachers = new Set<string>();
      for (const day of daysBetween(`${prevEnd.slice(0, 7)}-01`, prevEnd)) for (const id of input.source.teachersOn(day)) teachers.add(id);
      const out = new Map<string, ReadonlySet<string>>();
      for (const id of teachers) {
        const r = run(id, w);
        if (r.metric.base) out.set(id, r.subjects);
      }
      return out;
    },
  };
}
