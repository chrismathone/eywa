import { notFound } from "next/navigation";
import { BackLink } from "@/components/back-link";
import { requireAccess } from "@/lib/auth/require-access";
import {
  getClassDetail,
  getClassTeacherOptions,
} from "@/features/classes/server/queries";
import { getClassroomOptions } from "@/features/enrollments/server/queries";
import { ClassForm } from "../../_components/class-form";

export const metadata = { title: "반 수정 — eywa" };

export default async function EditClassPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAccess("classes");
  const { id } = await params;

  const [klass, teachers, classrooms] = await Promise.all([
    getClassDetail(id),
    getClassTeacherOptions(),
    getClassroomOptions(),
  ]);

  if (!klass) notFound();

  return (
    <div className="space-y-6">
      <BackLink href={`/classes/${id}`} label="반 상세로" />

      <header className="border-border border-b pb-5">
        <p className="eyebrow">반 수정</p>
        <h1 className="display text-foreground text-2xl">{klass.className}</h1>
      </header>

      <ClassForm
        mode="edit"
        defaults={{
          id: klass.id,
          className: klass.className,
          subject: klass.subject,
          teacherId: klass.teacherId,
          classroomId: klass.classroomId,
          isActive: klass.isActive,
          notes: klass.notes,
          schedules: klass.scheduleSlots.map((s) => ({
            dayOfWeek: s.dayOfWeek,
            startTime: s.startTime,
            endTime: s.endTime,
          })),
        }}
        teacherOptions={teachers}
        classroomOptions={classrooms}
      />
    </div>
  );
}
