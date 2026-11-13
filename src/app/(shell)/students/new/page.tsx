import { canManageStudentStatusNow } from "@/features/students/server/status-access";
import { redirect } from "next/navigation";
import { BackLink } from "@/components/back-link";
import { requireAccess } from "@/lib/auth/require-access";
import { accessLevelTenant } from "@/lib/auth/perm-matrix";
import { getTenantSettings } from "@/features/owner/server/queries";
import { StudentForm } from "../_components/student-form";
import { isModuleEnabled } from "@/lib/modules";

export const metadata = { title: "학생 등록 — 에이와" };

export default async function NewStudentPage() {
  const user = await requireAccess("students");
  // 강사(scoped)는 학생 열람 전용(원장 지시 2026-08-18) — 등록 폼도 강제 URL 차단(#77).
  if ((await accessLevelTenant(user.systemRole, "students")) !== "full") redirect("/students?list=1");
  const { operations, modules } = await getTenantSettings();

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <BackLink href="/students?list=1" label="원생목록으로" />

      <header className="border-border space-y-1 border-b pb-5">
        <p className="eyebrow">학생 등록</p>
        <h1 className="font-bold tracking-tight text-foreground text-2xl">새 원생 추가</h1>
        <p className="text-muted-foreground text-sm">
          기본 정보. 등록 후 수강 반을 배정하면 과목별 담당 강사·출결이 자동으로 따라옵니다.
        </p>
      </header>

      <StudentForm
        canManageStatus={await canManageStudentStatusNow()}
        mode="create"
        gradeLevels={operations.gradeLevels}
        showClassnoteName={isModuleEnabled(modules.disabled, "classnote")}
      />
    </div>
  );
}
