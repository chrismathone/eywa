import { notFound } from "next/navigation";
import { BackLink } from "@/components/back-link";
import { requireAccess } from "@/lib/auth/require-access";
import { getStudentById } from "@/features/students/server/queries";
import { getTenantSettings } from "@/features/owner/server/queries";
import { StudentForm } from "../../_components/student-form";

export const metadata = { title: "학생 수정 — eywa" };

export default async function EditStudentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAccess("students");
  const { id } = await params;
  const [student, { operations }] = await Promise.all([getStudentById(id), getTenantSettings()]);
  if (!student) notFound();

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <BackLink href={`/students/${id}`} label="학생 상세로" />

      <header className="border-border space-y-1 border-b pb-5">
        <p className="eyebrow">학생 수정</p>
        <h1 className="font-bold tracking-tight text-foreground text-2xl">{student.name}</h1>
      </header>

      <StudentForm
        mode="edit"
        scope={`student:${id}`}
        gradeLevels={operations.gradeLevels}
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
          status: student.status,
          enrolledAt: student.enrolledAt,
          withdrawnAt: student.withdrawnAt,
          notes: student.notes,
        }}
      />
    </div>
  );
}
