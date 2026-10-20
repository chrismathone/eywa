import { requireAccess } from "@/lib/auth/require-access";
import { PageHeader } from "@/components/page-header";
import { EmbedLink } from "@/components/embed-link";
import { TOOLBAR_SEG_BOX, TOOLBAR_SEG_ITEM, TOOLBAR_SEG_OFF, TOOLBAR_SEG_ON_PRIMARY } from "@/components/toolbar-controls";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { loadReportStats } from "@/features/lesson-reports/stats/load";
import { PERIOD_KEYS, readPeriodParams } from "@/features/stats/period";
import { BackToListButton } from "../../consultations/_components/back-to-list-button";
import { StatCard } from "../../students/stats/_components/stat-card";
import { ReportTrendCard } from "./report-trend-card";

export const metadata = { title: "보고서 통계 — 에이와" };

const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

/**
 * 수업보고서 **통계 화면**(원장 2026-10-20 *"상세 눌렀을때 추이를 볼 수 없는곳 모두 추가해보자"*) — 운영실 '학습 · 학부모 보고'의 '상세'가 여기로 온다.
 * 숙제 60% 미만 기록 비율 · 발송 후 48시간 안 학부모 확인율을 월별 12·24개월 · 일별 · 구간으로(RPC 0388a — 카드와 같은 판정).
 * 권한 = 보고서 목록과 같은 `lesson_reports` 게이트 · 과목 관리자는 그 과목(`?subject=` 전환) · 강사 화면엔 없다.
 */
export default async function ReportStatsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAccess("lesson_reports");
  const sp = await searchParams;
  const [stats, settings] = await Promise.all([loadReportStats(readPeriodParams(sp), one(sp.subject)), getTenantSettings()]);
  const scope = stats.scope;
  const labels = buildSubjectMaps(settings.operations.subjects);
  const subjectsLabel = scope ? `${scope.label} 보고서` : stats.tracked.length ? `${stats.tracked.map((k) => labels.labelOf(k)).join("·")} 보고서` : "모든 과목 보고서";
  const keepPeriod = Object.fromEntries(Object.values(PERIOD_KEYS).map((k) => [k, one(sp[k])]).filter((e): e is [string, string] => !!e[1]));
  return (
    <div className="@container/panel space-y-4 compact-chrome:space-y-3">
      <PageHeader title="보고서 통계" description={`${stats.classnoteOn ? "숙제 수행 · 학부모 확인 추이" : "숙제 수행 추이"} — ${subjectsLabel}`} embedLabel="보고서 통계" />
      <div className="flex flex-wrap items-center gap-2 px-1">
        <BackToListButton href="/lesson-reports?tab=list" />
        {scope?.active && scope.choices.length > 1 ? (
          <div role="group" aria-label="볼 과목" className={TOOLBAR_SEG_BOX}>
            {scope.choices.map((c) => (
              <EmbedLink
                key={c.key}
                href={`/lesson-reports/stats?${new URLSearchParams({ subject: c.key, ...keepPeriod }).toString()}`}
                aria-current={c.key === scope.active ? "page" : undefined}
                className={`${TOOLBAR_SEG_ITEM} ${c.key === scope.active ? TOOLBAR_SEG_ON_PRIMARY : TOOLBAR_SEG_OFF}`}
              >
                {c.label}
              </EmbedLink>
            ))}
          </div>
        ) : null}
      </div>
      {stats.teacherScoped ? (
        <StatCard id="reports" title="학습 · 학부모 보고 추이" note="강사 화면">
          <p className="text-muted-foreground text-sm break-keep">강사 화면에서는 보고서 통계를 보이지 않습니다. 내 보고서는 보고서 목록에서 볼 수 있습니다.</p>
        </StatCard>
      ) : stats.scopeEmpty ? (
        <StatCard id="reports" title="학습 · 학부모 보고 추이" note="담당 과목">
          <p className="text-muted-foreground text-sm break-keep">담당 과목이 정해지지 않아 통계를 보이지 않습니다. 원장님께 담당 과목 지정을 요청해 주세요.</p>
        </StatCard>
      ) : (
        <ReportTrendCard
          trend={stats.trend}
          period={stats.period}
          today={stats.today}
          keep={{ subject: one(sp.subject) }}
          subjectsLabel={subjectsLabel}
          classnoteOn={stats.classnoteOn}
        />
      )}
    </div>
  );
}
