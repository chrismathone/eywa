import { requireAccess } from "@/lib/auth/require-access";
import { PageHeader } from "@/components/page-header";
import { EmbedLink } from "@/components/embed-link";
import { TOOLBAR_SEG_BOX, TOOLBAR_SEG_ITEM, TOOLBAR_SEG_OFF, TOOLBAR_SEG_ON_PRIMARY } from "@/components/toolbar-controls";
import { loadAttendanceStats } from "@/features/attendance/stats/load";
import { PERIOD_KEYS, readPeriodParams } from "@/features/stats/period";
import { BackToListButton } from "../../consultations/_components/back-to-list-button";
import { StatCard } from "../../students/stats/_components/stat-card";
import { RateTrendCard } from "./rate-trend-card";

export const metadata = { title: "출결 통계 — 에이와" };

const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

/**
 * 출결 **통계 화면**(원장 2026-10-20 *"상세 눌렀을때 추이를 볼 수 없는곳 모두 추가해보자"*) — 운영실 '최근 14일 등원율'의 '상세'가 여기로 온다.
 * 등원율(출석 + 지각 ÷ 기록 칸)을 월별 12·24개월 · 일별(한 달) · 구간(최대 두 달)으로. 오늘 칸 = 카드의 오늘 점(같은 판정 · RPC 0387a).
 * 권한 = 출석부와 같은 `attendance` 게이트 · 과목 관리자는 반 과목으로(운영실과 같은 판정 · `?subject=` 전환) · 강사 화면엔 없다.
 */
export default async function AttendanceStatsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAccess("attendance");
  const sp = await searchParams;
  const stats = await loadAttendanceStats(readPeriodParams(sp), one(sp.subject));
  const scope = stats.scope;
  const keepPeriod = Object.fromEntries(Object.values(PERIOD_KEYS).map((k) => [k, one(sp[k])]));
  return (
    <div className="@container/panel space-y-4 compact-chrome:space-y-3">
      <PageHeader
        title="출결 통계"
        description={scope ? `등원율 추이 · ${scope.label} 반 출결 기준` : "등원율 추이 — 출석 + 지각 ÷ 기록 칸"}
        embedLabel="출결 통계"
      />
      <div className="flex flex-wrap items-center gap-2 px-1">
        <BackToListButton href="/attendance" />
        {scope?.active && scope.choices.length > 1 ? (
          <div role="group" aria-label="볼 과목" className={TOOLBAR_SEG_BOX}>
            {scope.choices.map((c) => (
              <EmbedLink
                key={c.key}
                href={`/attendance/stats?${new URLSearchParams({ subject: c.key, ...Object.fromEntries(Object.entries(keepPeriod).filter(([, v]) => !!v)) } as Record<string, string>).toString()}`}
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
        <StatCard id="rate" title="등원율 추이" note="강사 화면">
          <p className="text-muted-foreground text-sm break-keep">강사 화면에서는 출결 통계를 보이지 않습니다. 담당 반 출결은 출석부에서 볼 수 있습니다.</p>
        </StatCard>
      ) : stats.scopeEmpty ? (
        <StatCard id="rate" title="등원율 추이" note="담당 과목">
          <p className="text-muted-foreground text-sm break-keep">담당 과목이 정해지지 않아 통계를 보이지 않습니다. 원장님께 담당 과목 지정을 요청해 주세요.</p>
        </StatCard>
      ) : (
        <RateTrendCard trend={stats.trend} period={stats.period} today={stats.today} groups={stats.groups} keep={{ subject: one(sp.subject) }} scoped={!!scope} />
      )}
    </div>
  );
}
