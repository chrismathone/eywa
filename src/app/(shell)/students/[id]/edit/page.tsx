import { canManageStudentStatusNow } from "@/features/students/server/status-access";
import { notFound, redirect } from "next/navigation";
import { BackLink } from "@/components/back-link";
import { requireAccess } from "@/lib/auth/require-access";
import { accessLevelTenant } from "@/lib/auth/perm-matrix";
import { getStudentById } from "@/features/students/server/queries";
import { getTenantSettings } from "@/features/owner/server/queries";
import { StudentForm } from "../../_components/student-form";
import { isModuleEnabled } from "@/lib/modules";
import { getStudentSiblings } from "@/features/students/server/siblings";
import { siblingHint } from "@/features/students/siblings";

export const metadata = { title: "학생 수정 — 에이와" };

export default async function EditStudentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireAccess("students");
  const { id } = await params;
  // 강사(scoped)는 학생 열람 전용(원장 지시 2026-08-18) — 강제 URL도 상세로 되돌린다(#77).
  // 서버 액션(updateStudent)도 같은 full 판정으로 막혀 있어 이 리다이렉트는 UX용 이중 방어다.
  if ((await accessLevelTenant(user.systemRole, "students")) !== "full") redirect(`/students/${id}`);
  const [student, { operations, modules }] = await Promise.all([getStudentById(id), getTenantSettings()]);
  if (!student) notFound();
  // 형제 칸(0376a) — 짝 표가 아직 없으면(SQL 적용 전) 칸을 안 띄운다. 자동 판정은 미리 넣는다('자동 추천').
  const sib = await getStudentSiblings(student);
  const option = (s: (typeof sib.siblings)[number]) => ({ value: s.id, label: s.name, hint: siblingHint(s), auto: s.basis !== "manual" });

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <BackLink href={`/students/${id}`} label="학생 상세로" />

      <header className="border-border space-y-1 border-b pb-5">
        <p className="eyebrow">학생 수정</p>
        <h1 className="font-bold tracking-tight text-foreground text-2xl">{student.name}</h1>
      </header>

      <StudentForm
        canManageStatus={await canManageStudentStatusNow()}
        mode="edit"
        scope={`student:${id}`}
        gradeLevels={operations.gradeLevels}
        showClassnoteName={isModuleEnabled(modules.disabled, "classnote")}
        siblings={sib.ready ? { initial: sib.siblings.map(option), review: sib.review.map(option), suggested: sib.autoIds } : undefined}
        initialValue={{
          id: student.id,
          name: student.name,
          englishName: student.englishName,
          classnoteName: student.classnoteName,
          grade: student.grade,
          school: student.school,
          studentCode: student.studentCode,
          attendanceCode: student.attendanceCode,
          gender: student.gender,
          birthDate: student.birthDate,
          nickname: student.nickname,
          graduationYear: student.graduationYear,
          address: student.address,
          zipCode: student.zipCode,
          addressDetail: student.addressDetail,
          email: student.email,
          studentPhone: student.studentPhone,
          homePhone: student.homePhone,
          otherPhone: student.otherPhone,
          parentName: student.parentName,
          parentPhone: student.parentPhone,
          parentRelation: student.parentRelation,
          parent2Name: student.parent2Name,
          parent2Phone: student.parent2Phone,
          parent2Relation: student.parent2Relation,
          status: student.status,
          enrolledAt: student.enrolledAt,
          withdrawnAt: student.withdrawnAt,
          notes: student.notes,
        }}
      />
    </div>
  );
}
