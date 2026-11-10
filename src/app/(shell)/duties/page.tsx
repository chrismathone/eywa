import { PageHeader } from "@/components/page-header";
import { requireAccess } from "@/lib/auth/require-access";
import { kstToday } from "@/lib/date-kst";
import { loadDutyAdmin, resolveDutyAdminScope } from "@/features/duties/server/admin";
import { adminRange, periodKey, periodsOf } from "@/features/duties/view-admin";
import { DutyAdmin } from "@/features/duties/components/admin/duty-admin";
import { flushDuties } from "@/features/duties/server/live-sync";
import { loadSubjectManagers } from "@/features/duties/server/managers";
import { getTenantSettings } from "@/features/owner/server/queries";

export const metadata = { title: "업무 완성도 — 에이와" };

/**
 * 업무 완성도(관리자) — 의무 장부(s2_0043)를 선생님별 × 종류 · 반별 · 학생별로 본다(원장 2026-11-10 *"관리자 화면 구축"* · 시안 ② 과목 관리자).
 * 과목 범위는 운영실과 같은 판정 — 과목 관리자는 담당 과목만, 원장은 전 과목 + 과목 칩. 첫 그리기는 '이번 달', 나머지 기간·드릴다운은 GET으로.
 */
export default async function DutiesPage() {
  const viewer = await requireAccess("duties");
  const [scope] = await Promise.all([resolveDutyAdminScope(viewer), flushDuties(viewer.tenantId)]);
  const today = kstToday();
  const period = periodKey("month", today);
  const range = adminRange(period, today);
  // 과목 관리자별 현황은 학원 전체를 보는 사람에게만(과목 관리자 · '담당' 권한에게는 없다).
  const [data, managers] = await Promise.all([loadDutyAdmin(viewer.tenantId, range.from, range.to, scope, periodsOf(period)), scope.subjects === null && !scope.ownerId ? getTenantSettings().then((settings) => loadSubjectManagers(viewer.tenantId, settings)).then((m) => Object.fromEntries(Object.entries(m).map(([key, v]) => [key, v.names]))) : null]);
  const subjectLabel = scope.subjects === null ? "학원 전체" : scope.subjects.map((k) => scope.labels[k]).filter(Boolean).join(" · ") || "담당 과목 없음";
  const scopeLabel = scope.ownerId ? `내 업무만 · ${subjectLabel}` : subjectLabel;
  return (
    <div className="space-y-5 compact-chrome:space-y-3">
      <PageHeader title="업무 완성도" description={scopeLabel} />
      <DutyAdmin initial={{ period, today, now: new Date().toISOString(), range, data }} scope={scope} managers={managers} tenantId={viewer.tenantId} />
    </div>
  );
}
