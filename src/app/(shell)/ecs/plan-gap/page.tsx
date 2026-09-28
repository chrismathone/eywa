import type { Metadata } from "next";
import Link from "next/link";
import { requireAccess } from "@/lib/auth/require-access";
import { PageHeader } from "@/components/page-header";
import { BigStat } from "@/components/atoms/big-stat";
import { Toolbar, ToolbarButton } from "@/components/toolbar";
import { PeriodNav } from "@/components/period-nav";
import { kstMonth, monthLabel, shiftMonth } from "@/lib/date-kst";
import { TONE_SOFT, TONE_TEXT } from "@/lib/design/semantic-color";
import { getPlanGapBoard, UNKNOWN_TEACHER, type PlanGapClassRow } from "@/features/textbooks/server/plan-gap";
import { matchRate, VERDICT_TONE, type CompareTally } from "@/features/textbooks/plan-compare";
import { getTeacherViewLang } from "@/features/teacher-view/server/lang";
import { getTeacherEnglishNames } from "@/features/teacher-view/server/teacher-names";
import { teacherNameFor } from "@/features/teacher-view/teacher-name";
import { sheetMonthLabel, sheetT, sheetTf, type SheetDictKey, type SheetLang } from "@/features/teacher-view/i18n";

export const metadata: Metadata = { title: "계획 대비 현황 — 에이와" };

/**
 * **계획 대비 현황** — 한 달, 선생님별로 실제 수업이 원래 월간계획과 얼마나 달랐나(원장 2026-09-28).
 * 입구 = ECS 랜딩 툴바의 [계획 대비 현황]. 규칙·판정은 [`getPlanGapBoard`](@/features/textbooks/server/plan-gap).
 * 반 줄을 펼치면 어긋난 교시가 날짜순으로 서고, [월간 보기]로 그 반 달력(칸마다 비교 칩)을 연다.
 */
export default async function EcsPlanGapPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  await requireAccess("ecs");
  const { month: monthRaw } = await searchParams;
  const [res, lang, names] = await Promise.all([
    getPlanGapBoard(monthRaw ?? null),
    getTeacherViewLang(),
    getTeacherEnglishNames(),
  ]);
  const title = sheetT(lang, "gap.title");

  if (!res.ok) {
    return (
      <div className="space-y-4">
        <PageHeader eyebrow={sheetT(lang, "landing.title")} title={title} />
        <p className="bg-card shadow-card rounded-2xl px-4 py-6 text-sm">{res.error}</p>
      </div>
    );
  }

  const cur = kstMonth();
  const monthText = sheetMonthLabel(res.month, monthLabel(res.month), lang);
  const t = (k: SheetDictKey) => sheetT(lang, k);
  const cells = (n: number) => sheetTf(lang, "gap.cells", { n });
  const rate = matchRate(res.total);
  const avgLag = res.total.behind > 0 ? Math.round((res.total.lagSum / res.total.behind) * 10) / 10 : 0;
  const teacherLabel = (name: string) =>
    name === UNKNOWN_TEACHER ? t("gap.unknownTeacher") : (teacherNameFor(name, names, lang) ?? name);

  return (
    <div className="space-y-4">
      <PageHeader eyebrow={sheetT(lang, "landing.title")} title={title} description={t("gap.desc")} embedLabel={`${title} · ${monthText}`} />

      <Toolbar>
        <ToolbarButton href="/ecs">{t("goals.back")}</ToolbarButton>
        <PeriodNav
          label={monthText}
          prevHref={`/ecs/plan-gap?month=${shiftMonth(res.month, -1)}`}
          nextHref={`/ecs/plan-gap?month=${shiftMonth(res.month, 1)}`}
          currentHref="/ecs/plan-gap"
          relation={res.month === cur ? "current" : res.month < cur ? "past" : "future"}
        />
      </Toolbar>

      {res.classCount === 0 ? (
        <p className="bg-card shadow-card rounded-2xl px-4 py-6 text-sm">{t("gap.empty")}</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <BigStat
              label={t("gap.stat.rate")}
              value={rate === null ? "—" : `${rate}%`}
              sub={res.total.due === 0 ? t("gap.noDue") : sheetTf(lang, "gap.stat.rate.sub", { n: res.total.due })}
              valueClass={TONE_TEXT.positive}
            />
            <BigStat
              label={t("gap.stat.behind")}
              value={cells(res.total.behind)}
              sub={res.total.behind > 0 ? sheetTf(lang, "gap.stat.behind.sub", { n: avgLag }) : undefined}
              valueClass={TONE_TEXT.info}
            />
            <BigStat label={t("gap.stat.differ")} value={cells(res.total.differ)} valueClass={TONE_TEXT.critical} />
            <BigStat label={t("gap.stat.unwritten")} value={cells(res.total.unwritten)} valueClass={TONE_TEXT.caution} />
          </div>

          <div className="bg-card shadow-card overflow-x-auto rounded-2xl px-1">
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <thead>
                <tr className="text-text-dim border-line border-b text-xs [&>th]:px-3 [&>th]:py-2 [&>th]:text-center [&>th]:font-bold">
                  <th className="text-left!">{t("gap.col.teacher")}</th>
                  <th>{t("gap.col.due")}</th>
                  <th>{t("gap.col.match")}</th>
                  <th>{t("gap.col.behind")}</th>
                  <th>{t("gap.col.ahead")}</th>
                  <th>{t("gap.col.differ")}</th>
                  <th>{t("gap.col.unwritten")}</th>
                  <th>{t("gap.col.rate")}</th>
                </tr>
              </thead>
              {res.teachers.map((row) => (
                <tbody key={row.teacher} className="border-line border-b last:border-0">
                  <tr className="bg-bg-soft/60 font-bold">
                    <td className="px-3 py-2">{teacherLabel(row.teacher)}</td>
                    <TallyCells tally={row.tally} />
                  </tr>
                  {row.classes.map((c) => (
                    <ClassRow key={c.classId} row={c} month={res.month} lang={lang} />
                  ))}
                </tbody>
              ))}
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function TallyCells({ tally }: { tally: CompareTally }) {
  const rate = matchRate(tally);
  const num = (n: number, tone?: keyof typeof TONE_TEXT) => (
    <td className={`num px-3 py-2 text-center ${n > 0 && tone ? TONE_TEXT[tone] : n === 0 ? "text-text-faint" : ""}`}>
      {n}
    </td>
  );
  return (
    <>
      {num(tally.due)}
      {num(tally.match, "positive")}
      {num(tally.behind, "info")}
      {num(tally.ahead, "special")}
      {num(tally.differ, "critical")}
      {num(tally.unwritten, "caution")}
      <td className="num px-3 py-2 text-center">{rate === null ? "—" : `${rate}%`}</td>
    </>
  );
}

function ClassRow({ row, month, lang }: { row: PlanGapClassRow; month: string; lang: SheetLang }) {
  const verdictText = (v: PlanGapClassRow["misses"][number]) =>
    v.verdict === "behind"
      ? sheetTf(lang, "cmp.v.behind", { n: v.lag })
      : v.verdict === "ahead"
        ? sheetTf(lang, "cmp.v.ahead", { n: v.lag })
        : sheetT(lang, `cmp.v.${v.verdict}` as SheetDictKey);
  return (
    <>
      <tr className="border-line-faint border-t">
        <td className="px-3 py-2 pl-6">
          <span className="flex flex-wrap items-center gap-2">
            <span>{row.className}</span>
            <Link
              href={`/ecs/${row.classId}/month?month=${month}`}
              className="text-primary text-xs font-bold underline underline-offset-2"
            >
              {sheetT(lang, "gap.openMonth")}
            </Link>
          </span>
        </td>
        <TallyCells tally={row.tally} />
      </tr>
      {row.misses.length > 0 ? (
        <tr>
          <td colSpan={8} className="px-3 pb-2 pl-6">
            {/* 어긋난 교시 — 접어 두고 필요할 때 펼친다(한 반이 한 달에 수십 칸일 수 있다). */}
            <details>
              <summary className="text-text-dim cursor-pointer text-xs font-bold">
                {sheetTf(lang, "gap.misses", { n: row.misses.length })}
              </summary>
              <ul className="mt-1.5 flex flex-wrap gap-1.5">
                {row.misses.map((m) => (
                  <li
                    key={`${m.date}|${m.slotStart}`}
                    className={`num rounded-full px-2 py-0.5 text-xs font-bold ${TONE_SOFT[VERDICT_TONE[m.verdict]]}`}
                  >
                    {m.date.slice(5).replace("-", "/")} {m.slotStart} · {verdictText(m)}
                  </li>
                ))}
              </ul>
            </details>
          </td>
        </tr>
      ) : null}
    </>
  );
}
