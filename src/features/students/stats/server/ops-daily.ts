import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { reportWarning } from "@/lib/observability/report-error";
import { shiftDate } from "@/features/newcomers/onboarding-items";
import { loadNewcomers } from "@/features/newcomers/server/queries";
import { getDateRangeEvents } from "@/features/calendar/server/queries";
import { subjectLabelRecord } from "@/features/owner/subjects";
import type { SubjectSetting } from "@/features/owner/settings-types";
import { admissionsConsultationCandidates } from "@/features/dashboard/overview/admissions-links-server";
import { CONSULTATION_LINK_WINDOW_DAYS } from "@/features/dashboard/overview/admissions-consultation-link";
import { consultProgressList } from "@/features/dashboard/overview/consultation-progress-server";
import { summarizeProgress } from "@/features/dashboard/overview/consultation-progress";
import { monthAheadWindow } from "@/features/dashboard/overview/upcoming-window";
import { buildCareSummary } from "@/features/dashboard/overview/newcomer-care";
import type { OpsDaily } from "../ops-daily";

type Admin = ReturnType<typeof createAdminClient>;

/**
 * 그날의 **상담 진행 · 신규생 단계/체크** 기록(원장 2026-10-20 *"상세 눌렀을때 추이를 볼 수 없는곳 모두 추가해보자"* — 지금 상태만 있는
 * 지표라 과거는 되살릴 수 없어 오늘부터 쌓는다 · 코덱스 협의). 원생 매일 기록(0381a `student_daily_stats.data.ops`)과 한 줄에 함께 쓴다.
 * 계산은 운영실 카드와 **같은 함수**(`consultProgressList`·`summarizeProgress` · `loadNewcomers`·`buildCareSummary`) — 그날 23:55 운영실 값.
 * 관리 키라 모든 조회에 지점을 건다([[#104]] · 각 함수의 `deps`/`tenantId`). 이름은 싣지 않는다(건수만).
 * 두 부분은 따로 실패한다(실패한 부분은 빠지고 경고만 남는다 — 0으로 적지 않는다).
 */
export async function buildOpsDaily(
  admin: Admin,
  tenantId: string,
  today: string,
  subjects: readonly SubjectSetting[],
  modules: { calendar: boolean; newcomers: boolean },
): Promise<OpsDaily> {
  const deps = { db: admin, tenantId };
  const since = shiftDate(today, -CONSULTATION_LINK_WINDOW_DAYS);
  const programSubjects = subjects.map((s) => ({ key: s.key, label: s.label }));
  const warn = (part: string) => (error: unknown) => {
    reportWarning(`매일 기록 ${part} 실패 — 그날 줄에서 뺀다`, { scope: "student-daily-stats.ops", tenantId, cause: error instanceof Error ? error.message : String(error) });
    return undefined;
  };
  const [consult, newcomers] = await Promise.all([
    (async () => {
      const [rows, calendar] = await Promise.all([
        admissionsConsultationCandidates(since, deps),
        // 일정을 못 읽으면 입테만 '모름'(운영실 카드와 같다).
        modules.calendar
          ? getDateRangeEvents(since, monthAheadWindow(today).end, deps).catch(() => null)
          : Promise.resolve(null),
      ]);
      const notNames = Object.values(subjectLabelRecord([...subjects]));
      const { list, levelTestKnown } = await consultProgressList(rows, calendar?.ready ? calendar.events : null, notNames, since, today, deps);
      const summary = summarizeProgress(list, today, levelTestKnown);
      return { from: summary.from, counts: summary.counts, stalled: summary.stalled.length };
    })().catch(warn("상담 진행")),
    modules.newcomers
      ? (async () => {
          const view = await loadNewcomers(admin, today, tenantId);
          const care = buildCareSummary(view.rows, view.rows, programSubjects, view.checksAvailable && !view.checksError, today);
          return {
            total: care.total,
            stages: care.stages.map((s) => ({ label: s.label, value: s.value })),
            checksAvailable: care.checksAvailable,
            // 학생 이름(`needs`)은 남기지 않는다 — 건수만.
            items: care.items.map((i) => ({ label: i.label, optional: i.optional, done: i.done, overdue: i.overdue, due: i.due, upcoming: i.upcoming, pending: i.pending, waived: i.waived })),
          };
        })().catch(warn("신규생"))
      : Promise.resolve(undefined),
  ]);
  return { ...(consult ? { consult } : {}), ...(newcomers ? { newcomers } : {}) };
}
