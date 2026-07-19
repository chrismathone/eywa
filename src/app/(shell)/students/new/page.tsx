import { BackLink } from "@/components/back-link";
import { requireAccess } from "@/lib/auth/require-access";
import { getTenantSettings } from "@/features/owner/server/queries";
import { StudentForm } from "../_components/student-form";

export const metadata = { title: "학생 등록 — eywa" };

export default async function NewStudentPage() {
  await requireAccess("students");
  const { operations } = await getTenantSettings();

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <BackLink href="/students" label="학생목록으로" />

      <header className="border-border space-y-1 border-b pb-5">
        <p className="eyebrow">학생 등록</p>
        <h1 className="font-bold tracking-tight text-foreground text-2xl">새 학생 추가</h1>
        <p className="text-muted-foreground text-sm">
          기본 정보. 등록 후 수강 반을 배정하면 과목별 담당 강사·출결·AI 케어 인사이트가 자동으로 따라옵니다.
        </p>
      </header>

      <StudentForm mode="create" gradeLevels={operations.gradeLevels} />
    </div>
  );
}
