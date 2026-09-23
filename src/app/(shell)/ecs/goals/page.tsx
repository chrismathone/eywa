import type { Metadata } from "next";
import { requireAccess } from "@/lib/auth/require-access";
import { PageHeader } from "@/components/page-header";
import { BigStat } from "@/components/atoms/big-stat";
import { Toolbar, ToolbarButton } from "@/components/toolbar";
import { WeekNav } from "@/app/(shell)/timetable/_components/week-nav";
import { getGoalsBoard } from "@/features/class-sheets/server/goals-board";
import { countGoalCells } from "@/features/class-sheets/lib/goals-board";
import { getTeacherViewLang } from "@/features/teacher-view/server/lang";
import { getTeacherEnglishNames } from "@/features/teacher-view/server/teacher-names";
import { teacherNameFor } from "@/features/teacher-view/teacher-name";
import { classNameFor } from "@/features/teacher-view/class-name";
import { sheetMonthLabel, sheetT, sheetTf, sheetWeekLabel } from "@/features/teacher-view/i18n";
import { GoalsRoleSwitch } from "./_components/goals-role-switch";
import { GoalsTable, GOAL_STATE_DOT } from "./_components/goals-table";

export const metadata: Metadata = { title: "반 계획 보기 — aywa" };

/**
 * **반 계획 보기** — 인재원 영어 반 × 6영역, 그 달 월간 목표와 그 주 주간 목표를 한 칸에서 대조한다
 * (원장 2026-09-23, 시안 C안). 입구 = ECS 랜딩 툴바 오른쪽 끝 [반 계획 보기].
 * 🔴 읽기 전용 — 고치는 곳은 반 시트의 왼쪽 계획 표 하나다(반 이름을 누르면 그 주 시트).
 * 규칙·거르기는 [`getGoalsBoard`](@/features/class-sheets/server/goals-board) 주석.
 */
export default async function EcsGoalsPage({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  await requireAccess("ecs");
  const { week } = await searchParams;
  const [res, lang, names] = await Promise.all([getGoalsBoard(week ?? null), getTeacherViewLang(), getTeacherEnglishNames()]);
  const title = sheetT(lang, "goals.title");

  if (!res.ok) {
    return (
      <div className="space-y-4">
        <PageHeader eyebrow={sheetT(lang, "landing.title")} title={title} />
        <p className="bg-card shadow-card rounded-2xl px-4 py-6 text-sm">{res.error}</p>
      </div>
    );
  }

  const weekText = sheetWeekLabel(res.weekMonday, res.weekLabel, lang);
  const monthText = sheetMonthLabel(
    res.monthStart.slice(0, 7),
    `${Number(res.monthStart.slice(5, 7))}월`,
    lang,
  );
  const counts = countGoalCells(res.rows.flatMap((r) => r.cells.map((c) => c.state)));
  const cells = (n: number) => sheetTf(lang, "goals.cells", { n });

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow={sheetT(lang, "landing.title")}
        title={title}
        description={sheetT(lang, "goals.desc")}
        embedLabel={`${title} · ${weekText}`}
      />

      <Toolbar>
        <ToolbarButton href={`/ecs?view=week&week=${res.weekMonday}`}>{sheetT(lang, "goals.back")}</ToolbarButton>
        <WeekNav currentWeek={res.weekMonday} today={res.today} hrefForWeek={(m) => `/ecs/goals?week=${m}`} />
        <GoalsRoleSwitch value={res.role} />
        <span className="text-sm">{sheetTf(lang, "goals.caption", { month: monthText, week: weekText })}</span>
      </Toolbar>

      {res.areas.length === 0 ? (
        <p className="bg-card shadow-card rounded-2xl px-4 py-6 text-sm">{sheetT(lang, "goals.noAreas")}</p>
      ) : res.rows.length === 0 ? (
        <p className="bg-card shadow-card rounded-2xl px-4 py-6 text-sm">{sheetT(lang, "goals.empty")}</p>
      ) : (
        <>
          <div className="grid grid-cols-4 gap-3">
            <BigStat label={sheetT(lang, "goals.stat.same")} value={cells(counts.same)} tone="green" valueClass="text-green" />
            <BigStat label={sheetT(lang, "goals.stat.diff")} value={cells(counts.diff)} tone="amber" valueClass="text-amber" />
            <BigStat label={sheetT(lang, "goals.stat.weekEmpty")} value={cells(counts.weekEmpty)} />
            <BigStat label={sheetT(lang, "goals.stat.none")} value={cells(counts.none)} />
          </div>
          <p className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-sm">
            {(["same", "diff", "weekEmpty"] as const).map((s) => (
              <span key={s} className="inline-flex items-center gap-1.5">
                <span className={`size-2.5 rounded-full ${GOAL_STATE_DOT[s]}`} aria-hidden />
                {sheetT(lang, s === "same" ? "goals.stat.same" : s === "diff" ? "goals.stat.diff" : "goals.stat.weekEmpty")}
              </span>
            ))}
            <span className="ml-auto">{sheetT(lang, "goals.readonly")}</span>
          </p>
          <GoalsTable
            rows={res.rows}
            areas={res.areas}
            weekMonday={res.weekMonday}
            lang={lang}
            classLabel={(n) => classNameFor(n, lang)}
            teacherLabel={(n) => {
              const name = teacherNameFor(n, names, lang);
              return name ? sheetTf(lang, "goals.homeroomOf", { name }) : null;
            }}
          />
        </>
      )}
    </div>
  );
}
