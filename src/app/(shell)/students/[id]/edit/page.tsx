import { notFound } from "next/navigation";
import { BackLink } from "@/components/back-link";
import { requireAccess } from "@/lib/auth/require-access";
import { getStudentById, getTeacherOptions } from "@/features/students/server/queries";
import { StudentForm } from "../../_components/student-form";

export const metadata = { title: "학생 수정 — eywa" };

export default async function EditStudentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAccess("students");
  const { id } = await params;
  const [student, teachers] = await Promise.all([
    getStudentById(id),
    getTeacherOptions(),
  ]);
  if (!student) notFound();

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <BackLink href={`/students/${id}`} label="학생 상세로" />

      <header className="border-border space-y-1 border-b pb-5">
        <p className="eyebrow">학생 수정</p>
        <h1 className="display text-foreground text-2xl">{student.name}</h1>
      </header>

      <StudentForm
        mode="edit"
        teachers={teachers}
        initialValue={{
          id: student.id,
          name: student.name,
          grade: student.grade,
          school: student.school,
          studentCode: student.studentCode,
          parentName: student.parentName,
          parentPhone: student.parentPhone,
          status: student.status,
          primaryTeacherId: student.primaryTeacherId,
          secondaryTeacherId: student.secondaryTeacherId,
          enrolledAt: student.enrolledAt,
          withdrawnAt: student.withdrawnAt,
          notes: student.notes,
        }}
      />
    </div>
  );
}
