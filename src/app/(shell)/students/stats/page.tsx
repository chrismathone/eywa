import { requireAccess } from "@/lib/auth/require-access";
import { PageHeader } from "@/components/page-header";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { DASHBOARD_SUBJECT_COLORS } from "@/features/dashboard/overview/subject-colors";
import { loadStudentStats } from "@/features/students/stats/server/load";
import { distinctSubjectTokens, firstFlowMonth, firstNonZeroMonth, laterMonth, tokenColor, viewFromParam } from "@/features/students/stats/model";
import type { MixKey } from "@/features/dashboard/overview/enrolled-trend";
import { BackToListButton } from "../../consultations/_components/back-to-list-button";
import { StatCard } from "./_components/stat-card";
import { TrendBoard } from "./_components/trend-board";
import { FlowBoard } from "./_components/flow-board";
import { SubjectSwitch } from "./_components/subject-switch";

export const metadata = { title: "원생 통계 — 에이와" };

/** 수강 구성 선 — 운영실 '재원생 구성'·'학년별 재원생' 범례와 같은 이름·색(영어 빨강 · 동시수강 보라 · 수학 파랑). */
const MIX_META: Record<MixKey, { label: string; color: string }> = {
  englishOnly: { label: "영어만", color: DASHBOARD_SUBJECT_COLORS.english },
  both: { label: "동시수강", color: DASHBOARD_SUBJECT_COLORS.both },
  mathOnly: { label: "수학만", color: DASHBOARD_SUBJECT_COLORS.math },
  otherOnly: { label: "그 밖의 과목만", color: DASHBOARD_SUBJECT_COLORS.other },
};
const monthText = (ym: string) => `${ym.slice(0, 4)}년 ${Number(ym.slice(5, 7))}월`;
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

/**
 * 원생 **통계 화면**(원장 2026-10-20 *"대시보드의 모든 상세를 해당 탭의 통계 페이지로"* — 시범 첫 탭).
 * 🔑 목적: 운영실은 지금·최근만 보이니, 여기서는 **그동안 학원에 무슨 일이 있었나**를 본다(원장 같은 날). 운영실 카드에 이미 보이는
 *    '지금 구성'은 다시 싣지 않고, 정확히 셀 수 없는 과거(퇴원 기록 전 · 과목은 수강 종료 기록 전)는 그리지 않는다.
 * 운영실 카드의 '상세'가 여기로 온다 — 재원생 추이 `#trend` · 재원생 구성 `?view=mix#trend` · 과목별 수강 `?view=subject#trend` ·
 * 등록·퇴원 추이 `#flow`. 숫자는 운영실과 **같은 함수**를 더 긴 창으로 부른 것이라 오늘 값 = 카드 값(load.ts).
 * 권한 = 원생목록과 같은 `students` 게이트 · 과목 관리자는 자기 과목만(`?subject=` 전환 — 운영실과 같다) · 강사 범위는 보이지 않는다.
 */
export default async function StudentStatsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAccess("students");
  const sp = await searchParams;
  const [stats, settings] = await Promise.all([loadStudentStats(one(sp.subject)), getTenantSettings()]);
  const subjectMaps = buildSubjectMaps(settings.operations.subjects);
  const tokens = distinctSubjectTokens(settings.operations.subjects.map((s) => ({ key: s.key, color: subjectMaps.colorOf(s.key) })));
  const view = viewFromParam(sp.view) ?? stats.prefs.view;
  const scope = stats.scope;
  const trend = stats.trend?.data ?? null;
  const flowRows = stats.flow?.data ?? null;
  // 아래 경계 — 학원 전체는 퇴원 기록 시작부터(퇴원 기록이 아직 없으면 첫 학생이 있는 달과 지점이 에이와를 시작한 달 중 늦은 쪽부터) ·
  // 과목 관리자는 과목을 가를 수 있는 달(수강 종료 첫 기록 · 그것도 없으면 지점 시작 달)부터도.
  const { recordsFrom, breakdownFrom, createdMonth } = stats.bounds;
  const baseFrom = recordsFrom ?? laterMonth(trend ? firstNonZeroMonth(trend.total.monthly) : null, createdMonth);
  const countFrom = scope ? laterMonth(baseFrom, breakdownFrom ?? createdMonth) : baseFrom;
  const flowBase = recordsFrom ?? laterMonth(flowRows ? firstFlowMonth(flowRows) : null, createdMonth);
  const flowFrom = scope ? laterMonth(flowBase, breakdownFrom ?? createdMonth) : flowBase;
  const monthEnd = trend ? Object.fromEntries(trend.total.monthly.filter((p) => !flowFrom || p.key >= flowFrom).map((p) => [p.key, p.count])) : null;
  const clipNote =
    scope && countFrom
      ? breakdownFrom && countFrom === breakdownFrom
        ? `${scope.label} 흐름은 ${monthText(countFrom)}부터입니다 — 그 전에 그만둔 학생은 수강 기록이 남아 있지 않아 과목을 가를 수 없습니다.`
        : `${scope.label} 흐름은 ${monthText(countFrom)}부터의 기록만 보입니다.`
      : recordsFrom
        ? `퇴원 기록이 ${monthText(recordsFrom)}부터 있어, 그 전 기간은 정확히 셀 수 없어 보이지 않습니다.`
        : countFrom
          ? `${monthText(countFrom)}부터의 기록만 보입니다 — 그 전 기간은 떠난 학생의 기록이 없어 정확히 셀 수 없습니다.`
          : null;
  const description = scope ? `그동안의 재원생 흐름과 달마다 있었던 등록·퇴원 · ${scope.label} 기준` : "그동안의 재원생 흐름과 달마다 있었던 등록·퇴원";
  const boardKey = `${view}|${scope?.active ?? scope?.label ?? "all"}`;

  return (
    <div className="@container/panel space-y-4 compact-chrome:space-y-3">
      <PageHeader title="원생 통계" description={description} embedLabel="원생 통계" />
      <div className="flex flex-wrap items-center gap-2 px-1">
        <BackToListButton href="/students" />
        {scope?.active && scope.choices.length > 1 ? <SubjectSwitch choices={scope.choices} active={scope.active} view={one(sp.view)} /> : null}
      </div>
      {stats.teacherScoped ? (
        <StatCard id="trend" title="원생 통계" note="강사 화면">
          <p className="text-muted-foreground text-sm break-keep">강사 화면에서는 원생 통계를 보이지 않습니다. 담당 학생 기준 통계는 아직 준비되지 않았습니다.</p>
        </StatCard>
      ) : stats.scopeEmpty ? (
        <StatCard id="trend" title="원생 통계" note="담당 과목">
          <p className="text-muted-foreground text-sm break-keep">담당 과목이 정해지지 않아 통계를 보이지 않습니다. 원장님께 담당 과목 지정을 요청해 주세요.</p>
        </StatCard>
      ) : (
        <>
          {trend ? (
            <TrendBoard
              key={`trend|${boardKey}`}
              total={trend.total}
              subjects={trend.bySubject.map((s) => ({
                key: `subject:${s.key}`,
                label: subjectMaps.labelOf(s.key),
                color: tokenColor(tokens.get(s.key) ?? subjectMaps.colorOf(s.key)),
                set: s,
              }))}
              mixes={trend.byMix.map((m) => ({ key: `mix:${m.key}`, label: MIX_META[m.key].label, color: MIX_META[m.key].color, set: m }))}
              countFrom={countFrom}
              breakdownFrom={breakdownFrom}
              clipNote={clipNote}
              today={stats.today}
              scopeLabel={scope?.label ?? null}
              initial={{ range: stats.prefs.range, view, off: stats.prefs.off, kind: stats.prefs.trendKind }}
            />
          ) : (
            <StatCard id="trend" title="재원생 추이" note="달마다 말일 기준" error />
          )}
          {flowRows ? (
            <FlowBoard
              key={`flow|${boardKey}`}
              rows={flowRows}
              from={flowFrom}
              monthEnd={monthEnd}
              initialRange={stats.prefs.flowRange}
              initialKind={stats.prefs.flowKind}
              scopeLabel={scope?.label ?? null}
            />
          ) : (
            <StatCard id="flow" title="월별 기록" note="달마다 등록·퇴원" error />
          )}
        </>
      )}
    </div>
  );
}
