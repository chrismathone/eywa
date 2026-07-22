import { notFound } from "next/navigation";
import { BackLink } from "@/components/back-link";
import { requireAccess } from "@/lib/auth/require-access";
import {
  getClassDetail,
  getClassTeacherOptions,
} from "@/features/classes/server/queries";
import { getClassroomOptions } from "@/features/enrollments/server/queries";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { settingsToPeriodsConfig } from "@/features/timetable/lib/periods";
import { ClassForm } from "../../_components/class-form";

export const metadata = { title: "반 수정 — eywa" };

export default async function EditClassPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAccess("classes");
  const { id } = await params;

  const [klass, teachers, classrooms, settings] = await Promise.all([
    getClassDetail(id),
    getClassTeacherOptions(),
    getClassroomOptions(),
    getTenantSettings(),
  ]);

  if (!klass) notFound();
  const subjectOptions = buildSubjectMaps(settings.operations.subjects).options;
  const periodsConfig = settingsToPeriodsConfig(settings.operations);

  return (
    <div className="space-y-6">
      <BackLink href={`/classes/${id}`} label="반 상세로" />

      <header className="border-border border-b pb-5">
        <p className="eyebrow">반 수정</p>
        <h1 className="font-bold tracking-tight text-foreground text-2xl">{klass.className}</h1>
      </header>

      <ClassForm
        mode="edit"
        scope={`class:${id}`}
        defaults={{
          id: klass.id,
          className: klass.className,
          subject: klass.subject,
          teacherId: klass.teacherId,
          classroomId: klass.classroomId,
          notes: klass.notes,
          bgColor: klass.bgColor,
          schedules: klass.scheduleSlots.map((s) => ({
            dayOfWeek: s.dayOfWeek,
            startTime: s.startTime,
            endTime: s.endTime,
            teacherId: s.teacherId,
            classroomId: s.classroomId,
          })),
        }}
        teacherOptions={teachers}
        classroomOptions={classrooms}
        subjectOptions={subjectOptions}
        periodsConfig={periodsConfig}
      />
    </div>
  );
}
