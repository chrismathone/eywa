import { BackLink } from "@/components/back-link";
import { requireAccess } from "@/lib/auth/require-access";
import { getTeacherOptions } from "@/features/students/server/queries";
import { getTenantSettings } from "@/features/owner/server/queries";
import { StudentForm } from "../_components/student-form";

export const metadata = { title: "학생 등록 — eywa" };

export default async function NewStudentPage() {
  await requireAccess("students");
  const [teachers, { operations }] = await Promise.all([getTeacherOptions(), getTenantSettings()]);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <BackLink href="/students" label="학생목록으로" />

      <header className="border-border space-y-1 border-b pb-5">
        <p className="eyebrow">학생 등록</p>
        <h1 className="display text-foreground text-2xl">새 학생 추가</h1>
        <p className="text-muted-foreground text-sm">
          기본 정보 + 담임 배정. 등록 후에는 수강 반 / 출결 / AI 케어 인사이트가 자동으로 따라옵니다.
        </p>
      </header>

      <StudentForm mode="create" teachers={teachers} gradeLevels={operations.gradeLevels} />
    </div>
  );
}
