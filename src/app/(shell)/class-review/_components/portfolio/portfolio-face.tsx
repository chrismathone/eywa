import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import { getTenantSettings } from "@/features/owner/server/queries";
import { subjectLabelRecord } from "@/features/owner/subjects";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import type { SystemRole } from "@/lib/permissions";
import { kstDateOf, kstTimeOf } from "@/lib/date-kst";
import { getPortfolioView } from "@/features/teacher-portfolio/server/queries";
import { readMyUiPrefs } from "@/lib/ui-prefs/read";
import { dayLabel } from "@/features/teacher-portfolio/view";
import { PortfolioBoard, RefreshButton } from "./portfolio-board";

/**
 * 직원 평가 > 직원 포트폴리오 면. 저장된 달만 읽는다 — 무거운 집계는 매일 cron과 [지금 집계]가 한다.
 * 저장 표가 아직 없거나(SQL 적용 전) 첫 집계 전이면 빈 상태로 안내한다(화면이 죽지 않는다 — #95).
 */
export async function PortfolioFace({ role, teacherId }: { role: SystemRole; teacherId: string | null }) {
  const [view, canRefresh, prefs] = await Promise.all([getPortfolioView({ teacherId }), canWriteTenant(role, "class_review"), readMyUiPrefs()]);
  // 항목별 내역 '점수 기준' 상자 접힘 — 계정 귀속(원장 2026-10-14 *"접고 펼치기해서 컴팩트 가능하게"*).
  const ruleCollapsed = (prefs.portfolio as { ruleCollapsed?: unknown } | undefined)?.ruleCollapsed === true;
  // 직원 비교 표의 정렬 — 계정 귀속(모든 뷰 세팅). 모양이 틀리면 기본(총점 높은 순).
  const saved = (prefs.portfolio as { compareSort?: { key?: unknown; dir?: unknown } } | undefined)?.compareSort;
  const compareSort = typeof saved?.key === "string" && (saved.dir === "asc" || saved.dir === "desc")
    ? { key: saved.key, dir: saved.dir as "asc" | "desc" } : undefined;
  if (!view) return <EmptyState compact title="직원 포트폴리오를 볼 권한이 없습니다" />;
  if (view.state !== "ready") {
    return view.state === "tableMissing"
      ? <EmptyState compact title="직원 포트폴리오를 준비하고 있습니다" description="저장 준비가 끝나면 강사별 월간 점수가 표시됩니다." />
      : (
        <EmptyState compact title="아직 집계한 점수가 없습니다" description="매일 새벽에 자동으로 집계합니다. 지금 바로 보려면 집계를 시작하세요."
          action={canRefresh ? <RefreshButton label="지금 집계 시작" /> : undefined} />
      );
  }
  // 강사를 고르기 전엔 요약만 — 강사 이름 목록·점수는 [강사별 보기]로(원장 2026-10-29 *"들어갔을 때 개별 리스트가 먼저 뜨지 않게"*).
  if (!teacherId) {
    const month = view.teachers.flatMap((t) => Object.keys(t.months)).sort().at(-1) ?? null;
    const labels = subjectLabelRecord((await getTenantSettings()).operations.subjects);
    const counted = month ? view.teachers.filter((t) => t.months[month]) : [];
    const subjectCount = new Map<string, number>();
    for (const t of counted) for (const s of t.months[month!]!.subjects) subjectCount.set(s, (subjectCount.get(s) ?? 0) + 1);
    const tiles = [
      { label: "평가 대상 강사", value: `${view.teachers.length}명` },
      { label: month ? `${Number(month.slice(5))}월 집계` : "집계", value: `${counted.length}명` },
      { label: "담당 반", value: `${counted.reduce((s, t) => s + t.months[month!]!.classCount, 0)}개` },
      { label: "과목별 강사", value: [...subjectCount].map(([s, n]) => `${labels[s] ?? s} ${n}`).join(" · ") || "—" },
    ];
    return (
      <div className="space-y-4">
        <section aria-label="직원 포트폴리오 요약" className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {tiles.map((t) => <div key={t.label} className="rounded-xl border p-4">
            <p className="text-text-dim text-xs">{t.label}</p>
            <p className="mt-1 text-lg font-bold">{t.value}</p>
          </div>)}
        </section>
        <Link href={`/class-review?tab=portfolio&teacher=${view.teachers[0]!.id}`} className="inline-flex rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted">
          강사별 보기 ({view.teachers.length}명)
        </Link>
      </div>
    );
  }
  const computedAt = view.selected.periods[0]?.closing.computedAt ?? null;
  const day = kstDateOf(computedAt);
  return (
    <PortfolioBoard teachers={view.teachers} selected={view.selected} studentNames={view.studentNames} studentSchools={view.studentSchools} canRefresh={canRefresh} ruleCollapsed={ruleCollapsed} compareSort={compareSort}
      computedLabel={day ? `${dayLabel(day)} ${kstTimeOf(computedAt) ?? ""}`.trim() : "—"} />
  );
}
