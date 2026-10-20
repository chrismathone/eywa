import { ONBOARDING_ITEMS } from "@/features/newcomers/onboarding-items";
import type { NewcomerRow } from "@/features/newcomers/server/queries";
import type { ProgramSubject } from "@/features/students/enrollment/program";
import { careStatus } from "./care";
import type { CareSummary } from "./model";
import { newcomerStages } from "./newcomer-composition";

/**
 * 운영실 '신규생 단계별 관리'·'신규생 체크 진행'의 집계 **한 벌** — 운영실(`server.ts newcomers`)과 매일 기록(`ops-daily.ts`)이 같이 쓴다.
 * 체크 표를 못 읽으면(`available` false) 항목을 비운다 — 지연 건수를 지어내지 않는다. 순수 함수.
 * @param rows 단계별 인원을 셀 학생 줄 · @param careRows 체크 판정에 쓸 줄(과목 관리자는 그 과목 줄로 좁힌 것).
 */
export function buildCareSummary(
  rows: readonly NewcomerRow[],
  careRows: readonly NewcomerRow[],
  subjects: readonly ProgramSubject[],
  available: boolean,
  today: string,
): CareSummary {
  return {
    total: rows.length,
    stages: newcomerStages(rows, subjects),
    checksAvailable: available,
    items: available
      ? ONBOARDING_ITEMS.map((item) => {
          const statuses = careRows.map((r) => careStatus(item, r, today));
          return {
            label: item.shortLabel,
            needs: careRows.filter((_, i) => statuses[i] === "due" || statuses[i] === "overdue").map((r) => ({ id: r.studentId, name: r.name })),
            optional: !!item.optional,
            done: statuses.filter((s) => s === "done").length,
            overdue: statuses.filter((s) => s === "overdue").length,
            due: statuses.filter((s) => s === "due").length,
            upcoming: statuses.filter((s) => s === "upcoming").length,
            pending: statuses.filter((s) => s === "pending").length,
            waived: statuses.filter((s) => s === "waived").length,
          };
        })
      : [],
  };
}
