import { Suspense } from "react";
import { requireAccess } from "@/lib/auth/require-access";
import { PageHeader } from "@/components/page-header";
import { getTenantSettings } from "@/features/owner/server/queries";
import { loadStudentStats } from "@/features/students/stats/server/load";
import { viewFromParam } from "@/features/students/stats/model";
import { BackToListButton } from "../../consultations/_components/back-to-list-button";
import { StatCard } from "./_components/stat-card";
import { SubjectSwitch } from "./_components/subject-switch";
import { CourseSection, FirstClassSection, FlowSection, HistorySection, SectionSkeleton, TrendSection } from "./_components/sections";
import { FIRST_CLASS_KEYS } from "@/features/students/stats/first-class-trend";
import { readPeriodParams } from "@/features/stats/period";

export const metadata = { title: "원생 통계 — 에이와" };

const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

/**
 * 원생 **통계 화면**(원장 2026-10-20 *"대시보드의 모든 상세를 해당 탭의 통계 페이지로"* — 시범 첫 탭).
 * 🔑 목적: 운영실은 지금·최근만 보이니, 여기서는 **그동안 학원에 무슨 일이 있었나**를 본다(원장 같은 날). 운영실 카드에 이미 보이는
 *    '지금 구성'은 다시 싣지 않고, 정확히 셀 수 없는 과거(퇴원 기록 전 · 과목은 수강 종료 기록 전)는 그리지 않는다.
 * 운영실 카드의 '상세'가 여기로 온다 — 재원생 추이 `#trend` · 재원생 구성 `?view=mix#trend` · 과목별 수강 `?view=subject#trend` ·
 * 등록·퇴원 추이 `#flow` · 오늘첫수업 `?fc=day#first`. 숫자는 운영실과 **같은 함수**를 더 긴 창으로 부른 것이라 오늘 값 = 카드 값(load.ts).
 * 권한 = 원생목록과 같은 `students` 게이트 · 과목 관리자는 자기 과목만(`?subject=` 전환 — 운영실과 같다) · 강사 범위는 보이지 않는다.
 * 🔑 카드마다 따로 기다린다(`<Suspense>` · 리뷰 2026-10-21 속도) — 먼저 끝난 카드부터 서고, 늦는 카드 자리엔 같은 id의 빈 표면(`SectionSkeleton`)이
 *    서 있어 '상세' 주소의 `#…`가 그 자리로 간다. 아래 경계 계산은 `bounds.ts` 한 곳.
 */
export default async function StudentStatsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAccess("students");
  const sp = await searchParams;
  const [stats, settings] = await Promise.all([loadStudentStats(one(sp.subject), readPeriodParams(sp, FIRST_CLASS_KEYS)), getTenantSettings()]);
  const view = viewFromParam(sp.view) ?? stats.prefs.view;
  const scope = stats.scope;
  const description = scope ? `그동안의 재원생 흐름과 달마다 있었던 등록·퇴원 · ${scope.label} 기준` : "그동안의 재원생 흐름과 달마다 있었던 등록·퇴원";
  const boardKey = `${view}|${scope?.active ?? scope?.label ?? "all"}`;
  const parts = stats.parts;
  const ctx = parts ? { stats, parts, settings, scopeLabel: scope?.label ?? null } : null;

  return (
    <div className="@container/panel space-y-4 compact-chrome:space-y-3">
      <PageHeader title="원생 통계" description={description} embedLabel="원생 통계" />
      <div className="flex flex-wrap items-center gap-2 px-1">
        <BackToListButton href="/students" />
        {scope?.active && scope.choices.length > 1 ? (
          <SubjectSwitch
            choices={scope.choices}
            active={scope.active}
            view={one(sp.view)}
            keep={Object.fromEntries(Object.values(FIRST_CLASS_KEYS).map((k) => [k, one(sp[k])]))}
          />
        ) : null}
      </div>
      {stats.teacherScoped ? (
        <StatCard id="trend" title="원생 통계" note="강사 화면">
          <p className="text-muted-foreground text-sm break-keep">강사 화면에서는 원생 통계를 보이지 않습니다. 담당 학생 기준 통계는 아직 준비되지 않았습니다.</p>
        </StatCard>
      ) : stats.scopeEmpty || !ctx ? (
        <StatCard id="trend" title="원생 통계" note="담당 과목">
          <p className="text-muted-foreground text-sm break-keep">담당 과목이 정해지지 않아 통계를 보이지 않습니다. 원장님께 담당 과목 지정을 요청해 주세요.</p>
        </StatCard>
      ) : (
        <>
          <Suspense fallback={<SectionSkeleton id="trend" title="재원생 추이" height="h-[28rem]" />}>
            <TrendSection {...ctx} view={view} boardKey={boardKey} />
          </Suspense>
          <Suspense fallback={<SectionSkeleton id="courses" title="강좌수 추이" />}>
            <CourseSection {...ctx} boardKey={boardKey} />
          </Suspense>
          <Suspense fallback={<SectionSkeleton id="first" title="첫 수업 추이" />}>
            <FirstClassSection {...ctx} keep={{ view: one(sp.view), subject: one(sp.subject) }} />
          </Suspense>
          <Suspense fallback={<SectionSkeleton id="flow" title="등록 · 퇴원 추이" />}>
            <FlowSection {...ctx} boardKey={boardKey} />
          </Suspense>
          <Suspense fallback={<SectionSkeleton id="history" title="지난 기록" />}>
            <HistorySection {...ctx} />
          </Suspense>
        </>
      )}
    </div>
  );
}
