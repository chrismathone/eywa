import "server-only";
import { canAccessTenant } from "@/lib/auth/perm-matrix";
import { requireMcsClassAccess } from "@/features/math-sheets/server/access";
import { getStudentLearningMap } from "@/features/math-progress-map/server/learning-map-query";
import { learningSheetHref } from "@/features/math-progress-map/learning-map";
import { sectionResult, type LiveItem } from "@/features/students/ontology/live-contract";
import { readSection, unavailableSection, type LiveContext } from "./live-context";
import { readLiveSection } from "./live-query";
import { getTenantSettings } from "@/features/owner/server/queries";
import { isModuleEnabled } from "@/lib/modules";

export function readLiveLearningPlan(c: LiveContext) {
  const href = `/students/${c.studentId}?tab=progress`;
  return readSection("learning-plan", "수학 학습 계획·진도", href, async () => {
    const settings = await getTenantSettings();
    if (!isModuleEnabled(settings.modules.disabled, "mcs")) return unavailableSection("learning-plan", "수학 학습 계획·진도", href, "off");
    if (!(await canAccessTenant(c.role, "mcs"))) return unavailableSection("learning-plan", "수학 학습 계획·진도", href, "forbidden");
    const enrollment = await readLiveSection("classes", c);
    if (enrollment.state !== "ready" && enrollment.state !== "partial") return unavailableSection("learning-plan", "수학 학습 계획·진도", href, enrollment.state);
    let denied = false;
    const results = await Promise.all(enrollment.items.filter((i) => i.subject === "math").map(async (item) => {
      const gate = await requireMcsClassAccess(item.id);
      if (!gate.ok) { denied = true; return null; }
      return getStudentLearningMap(item.id, c.studentId, c.today.slice(0, 7));
    }));
    const items: LiveItem[] = [];
    let partial = enrollment.state === "partial" || denied;
    for (const result of results) {
      if (!result || result.status === "no-goal") continue;
      if (result.status !== "ok" || !result.goal.source) { partial = true; continue; }
      const link = learningSheetHref(result.classId, c.studentId, result.month);
      items.push({ id: result.goal.source.id, title: result.className,
        detail: `${result.goal.startDate}–${result.goal.endDate} · ${result.goal.textbook || "교재 미입력"} · 마지막으로 확인된 진도: ${result.progress.currentBlock || "확인 전"}`,
        date: result.progress.currentDate ?? undefined,
        evidence: [{ source: result.goal.source.table, id: result.goal.source.id, studentId: c.studentId, href: link },
          ...result.records.filter((r) => r.sourceId).slice(-3).map((r) => ({ source: "lesson_reports", id: r.sourceId!, studentId: c.studentId, href: link }))] });
    }
    if (denied && results.every((r) => !r)) return unavailableSection("learning-plan", "수학 학습 계획·진도", href, "forbidden");
    return { ...sectionResult("learning-plan", "수학 학습 계획·진도", href, items, items.length), state: partial ? "partial" as const : "ready" as const,
      note: "열람 가능한 현재 수강 반의 학습 원장을 연결합니다. 계획·진도와 개념 숙련도는 다르며, 개념별 정오답 근거가 없는 숙련도는 만들지 않습니다." };
  });
}
