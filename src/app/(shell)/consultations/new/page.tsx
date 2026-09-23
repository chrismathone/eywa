import { BackLink } from "@/components/back-link";
import { requireAccess } from "@/lib/auth/require-access";
import { getStudentOptionsForConsultation } from "@/features/consultations/server/queries";
import { getTeacherOptions } from "@/features/students/server/queries";
import { getTenantSettings } from "@/features/owner/server/queries";
import { subjectLabelRecord } from "@/features/owner/subjects";
import { ConsultationForm } from "../_components/consultation-form";
import { AudioConsultationForm } from "../_components/audio-consultation-form";

export const metadata = { title: "새 원생상담 — aywa" };

export default async function NewConsultationPage({
  searchParams,
}: {
  searchParams: Promise<{ studentId?: string }>;
}) {
  const viewer = await requireAccess("consultations");
  const { studentId } = await searchParams;
  const [students, counselors, settings] = await Promise.all([
    getStudentOptionsForConsultation(),
    getTeacherOptions(),
    getTenantSettings(),
  ]);

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <BackLink href="/consultations" label="원생상담으로" />

      <header className="border-border space-y-1 border-b pb-3">
        <p className="eyebrow">새 원생상담</p>
        <h1 className="font-bold tracking-tight text-foreground text-2xl">상담 기록 추가</h1>
        <p className="text-muted-foreground text-sm">
          학생/학부모 면담을 기록합니다. 후속 조치 날짜를 지정하면 기한이 다가올수록 색상으로 알려드립니다.
        </p>
      </header>

      <AudioConsultationForm students={students} />

      <ConsultationForm
        mode="create"
        students={students}
        counselors={counselors}
        subjectLabels={subjectLabelRecord(settings.operations.subjects)}
        currentUserId={viewer.id}
        templates={settings.consultations.templates}
        currentUserName={viewer.displayName}
        initialValue={
          studentId
            ? {
                studentId,
                counselorId: null,
                consultedAt: new Date().toISOString(),
                category: "general",
                subject: null,
                audience: "parent",
                summary: "",
                followUpAction: null,
                followUpDate: null,
                followUpDone: false,
              }
            : undefined
        }
      />
    </div>
  );
}
