import { requireAccess } from "@/lib/auth/require-access";
import { PageHeader } from "@/components/page-header";
import { EmbedLink } from "@/components/embed-link";
import { TOOLBAR_SEG_BOX, TOOLBAR_SEG_ITEM, TOOLBAR_SEG_OFF, TOOLBAR_SEG_ON_PRIMARY } from "@/components/toolbar-controls";
import { loadBillingStats } from "@/features/billing/stats/load";
import { hasPeriodParams, monthSpanOf, parseStatsPeriod, readPeriodParams } from "@/features/stats/period";
import { BackToListButton } from "../../consultations/_components/back-to-list-button";
import { StatCard } from "../../students/stats/_components/stat-card";
import { BillingTrendCard } from "./billing-trend-card";

export const metadata = { title: "수납 통계 — 에이와" };

const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

/**
 * 수납 **통계 화면**(원장 2026-10-20 *"청구수납에 대해서도 상세 추이를 볼 수 있게. 지금 수납 상세 페이지로 이동하는데"*) — 운영실
 * '6개월 청구 · 수납'·'수납 현황'의 '상세'가 여기로 온다. 청구월별 실청구 · 수납 · 미수를 12·24개월로(이번 달 = 카드 값).
 * 일별은 없다 — 수납의 결제일은 청구서마다 대표 날짜 하나라 하루로 나누면 실제와 달라진다(코덱스 협의 2026-10-20).
 * 권한 = 수납관리와 같은 `billing` 게이트 · 과목 관리자는 운영실과 같은 청구 항목별 값(`?subject=` 전환).
 */
export default async function BillingStatsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAccess("billing");
  const sp = await searchParams;
  const params = readPeriodParams(sp);
  const stats = await loadBillingStats(hasPeriodParams(params) ? monthSpanOf(params.span) : null, one(sp.subject));
  const period = parseStatsPeriod({ span: String(stats.months.length) }, stats.today);
  const scope = stats.scope;
  return (
    <div className="@container/panel space-y-4 compact-chrome:space-y-3">
      <PageHeader
        title="수납 통계"
        description={scope ? `청구월별 실청구 · 수납 · 미수 · ${scope.label} 청구 항목 기준` : "청구월별 실청구 · 수납 · 미수"}
        embedLabel="수납 통계"
      />
      <div className="flex flex-wrap items-center gap-2 px-1">
        <BackToListButton href="/billing" />
        {scope?.active && scope.choices.length > 1 ? (
          <div role="group" aria-label="볼 과목" className={TOOLBAR_SEG_BOX}>
            {scope.choices.map((c) => (
              <EmbedLink
                key={c.key}
                href={`/billing/stats?subject=${encodeURIComponent(c.key)}${one(sp.span) ? `&span=${encodeURIComponent(one(sp.span)!)}` : ""}`}
                aria-current={c.key === scope.active ? "page" : undefined}
                className={`${TOOLBAR_SEG_ITEM} ${c.key === scope.active ? TOOLBAR_SEG_ON_PRIMARY : TOOLBAR_SEG_OFF}`}
              >
                {c.label}
              </EmbedLink>
            ))}
          </div>
        ) : null}
      </div>
      {stats.scopeEmpty ? (
        <StatCard id="billing" title="청구 · 수납 추이" note="담당 과목">
          <p className="text-muted-foreground text-sm break-keep">담당 과목이 정해지지 않아 통계를 보이지 않습니다. 원장님께 담당 과목 지정을 요청해 주세요.</p>
        </StatCard>
      ) : (
        <BillingTrendCard
          rows={stats.rows}
          next={stats.next}
          period={period}
          today={stats.today}
          scoped={!!scope}
          keep={{ subject: one(sp.subject) }}
        />
      )}
    </div>
  );
}
