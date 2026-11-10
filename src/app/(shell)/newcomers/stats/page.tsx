import { requireAccess } from "@/lib/auth/require-access";
import { kstToday } from "@/lib/date-kst";
import { readMyUiPrefs } from "@/lib/ui-prefs/read";
import { PageHeader } from "@/components/page-header";
import { hasPeriodParams, paramsForMode, parsePeriodMode, parseStatsPeriod, readPeriodParams } from "@/features/stats/period";
import { NEWCOMER_KEYS } from "@/features/students/stats/ops-keys";
import { firstRecorded, opsSeries } from "@/features/students/stats/ops-series";
import { loadOpsHistory } from "@/features/students/stats/server/ops-history";
import { saveNewcomerStatsMode } from "@/features/newcomers/server/stats-prefs-actions";
import { BackToListButton } from "../../consultations/_components/back-to-list-button";
import { StatCard } from "../../students/stats/_components/stat-card";
import { OpsHistoryCard } from "../../students/stats/_components/ops-history-card";

export const metadata = { title: "신규생 기록 — 에이와" };

/** 단계 색 — 갓 등록(0–7일)이 가장 진하고 오래될수록 옅게(같은 파랑 계열). */
// 단계 색 = 기본 색의 진하기 다섯 단계(테마를 따른다 — 2026-11-09 색감 통일).
const STAGE_COLORS = [100, 78, 58, 40, 24].map((p) => `color-mix(in srgb, var(--primary) ${p}%, var(--card))`);

/**
 * 신규생 **기록 화면**(원장 2026-10-20 *"상세 눌렀을때 추이를 볼 수 없는곳 모두 추가해보자"*) — 운영실 '신규생 단계별 관리'·'신규생 체크 진행'의
 * '상세'가 여기로 온다. 신규생 단계·체크 지연은 **지금 상태만** 남는 값이라 과거를 되살릴 수 없어 2026-10-21부터 매일 밤 그날 값을 쌓는다
 * (`student_daily_stats.data.ops.newcomers` — 운영실 카드와 같은 계산 `buildCareSummary`). 학원 전체 값이다(과목 관리자 카드와 다를 수 있다).
 * 권한 = 신규생 관리와 같은 `newcomers` 게이트(기록 표는 서버 전용 — 게이트를 지난 뒤 관리 키 + 지점으로 읽는다).
 */
export default async function NewcomerStatsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireAccess("newcomers");
  const today = kstToday();
  const [sp, prefs] = await Promise.all([searchParams, readMyUiPrefs()]);
  const params = readPeriodParams(sp, NEWCOMER_KEYS);
  const ns = prefs.newcomerStats;
  // 저장된 보기가 없으면 최근 구간(일별) — 막 쌓이기 시작한 기록이라 월별은 점 하나 · '이번 달 일별'은 매달 1일에 하루 종일 빈다(리뷰 2026-10-21).
  const saved = parsePeriodMode(ns && typeof ns === "object" && !Array.isArray(ns) ? (ns as Record<string, unknown>).mode : undefined) ?? "range";
  const period = parseStatsPeriod(hasPeriodParams(params) ? params : paramsForMode(saved, today), today);
  const rows = await loadOpsHistory(user.tenantId, period, today).catch((error: unknown) => {
    console.error("[newcomers/stats]", error);
    return null;
  });
  const sum = (pick: "overdue" | "due") => (o: NonNullable<Parameters<Parameters<typeof opsSeries>[2]>[0]>) =>
    !o.newcomers ? undefined : o.newcomers.checksAvailable ? o.newcomers.items.filter((i) => !i.optional).reduce((n, i) => n + i[pick], 0) : null;
  // 단계(등록 후 0–7일 …) 이름은 기록에 적힌 그대로 — 운영실 '신규생 단계별 관리' 막대와 같은 칸.
  const stageLabels = [...new Set((rows ?? []).flatMap((r) => r.ops?.newcomers?.stages.map((st) => st.label) ?? []))];
  return (
    <div className="@container/panel space-y-4 compact-chrome:space-y-3">
      <PageHeader title="신규생 기록" description="신규생 수 · 꼭 할 체크의 기한 경과를 매일 밤 쌓은 기록 (학원 전체)" embedLabel="신규생 기록" />
      <div className="flex flex-wrap items-center gap-2 px-1">
        <BackToListButton href="/newcomers" />
      </div>
      {rows ? (
        <OpsHistoryCard
          id="history"
          title="신규생 기록"
          note="운영실 '신규생 단계별 관리'·'신규생 체크 진행'의 그날 값 — 등록 후 90일 안 신규생(단계별로 쌓음) · 꼭 할 체크의 기한 경과·3일 내 기한"
          firstDate={firstRecorded(rows, (o) => !!o.newcomers)}
          period={period}
          today={today}
          keys={NEWCOMER_KEYS}
          keep={{}}
          charts={[
            {
              title: "신규생",
              kind: "bar",
              unit: "명",
              series: [
                { key: "total", name: "신규생", color: "var(--color-primary)", values: opsSeries(rows, period, (o) => o.newcomers?.total), tooltipOnly: true },
                ...stageLabels.map((label, i) => ({
                  key: `stage:${label}`,
                  name: label,
                  color: STAGE_COLORS[i % STAGE_COLORS.length]!,
                  values: opsSeries(rows, period, (o) => (o.newcomers ? (o.newcomers.stages.find((st) => st.label === label)?.value ?? 0) : undefined)),
                  stack: "stages",
                })),
              ],
            },
            {
              title: "꼭 할 체크",
              kind: "line",
              unit: "건",
              series: [
                { key: "overdue", name: "기한 경과", color: "var(--color-danger)", values: opsSeries(rows, period, sum("overdue")), strong: true },
                { key: "due", name: "3일 내 기한", color: "var(--color-amber)", values: opsSeries(rows, period, sum("due")) },
              ],
            },
          ]}
          onMode={saveNewcomerStatsMode}
        />
      ) : (
        <StatCard id="history" title="신규생 기록" note="매일 기록" error />
      )}
    </div>
  );
}
