import { notFound } from "next/navigation";
import { requireAccess } from "@/lib/auth/require-access";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { BackLink } from "@/components/back-link";
import {
  getStudentConsultationById,
  getStudentOptionsForConsultation,
} from "@/features/consultations/server/queries";
import { getTeacherOptions } from "@/features/students/server/queries";
import { getTenantSettings } from "@/features/owner/server/queries";
import { subjectLabelRecord } from "@/features/owner/subjects";
import { getNewcomerLinkTargets } from "@/features/newcomers/server/consult-link";
import { ConsultationForm } from "../../_components/consultation-form";
import { ConsultationDeleteButton } from "../../_components/consultation-delete-button";

export const metadata = { title: "상담 수정 — 에이와" };

export default async function EditConsultationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const viewer = await requireAccess("consultations");
  const { id } = await params;
  const [canWrite, item, students, counselors, settings, newcomerTargets] = await Promise.all([
    // 저장·삭제 게이트(update/deleteStudentConsultation)와 같은 판정 — 읽기 권한이면 칸만 잠그고 단추는 그리지 않는다.
    canWriteTenant(viewer.systemRole, "consultations"),
    getStudentConsultationById(id),
    getStudentOptionsForConsultation(),
    getTeacherOptions(),
    getTenantSettings(),
    // 신규생 관리 칸(0295a) — 못 읽어도 상담 수정은 된다(칸만 안 뜬다).
    getNewcomerLinkTargets(id).catch(() => []),
  ]);
  if (!item) notFound();

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* 상세(읽기) 페이지가 생겨(2026-07-03) 뒤로가기는 상세로 — 녹음/전사/AI 패널(읽기 콘텐츠)도 상세로 이동. */}
      <BackLink href={`/consultations/${item.id}`} label="상담 상세로" />

      <header className="border-border flex flex-wrap items-end justify-between gap-3 border-b pb-5">
        <div className="space-y-1">
          <p className="eyebrow">상담 수정</p>
          <h1 className="font-bold tracking-tight text-foreground text-2xl">{item.studentName}</h1>
        </div>
        {canWrite ? (
          <ConsultationDeleteButton
            id={item.id}
            studentId={item.studentId}
            redirectTo="/consultations"
          />
        ) : null}
      </header>

      <ConsultationForm
        mode="edit"
        readOnly={!canWrite}
        students={students}
        counselors={counselors}
        subjectLabels={subjectLabelRecord(settings.operations.subjects)}
        currentUserId={viewer.id}
        // 🔴 고를 수 있는 학생(담당 범위로 좁힌 목록)의 것만 내려보낸다 — 강사에게 전사 신입 명단이 새지 않게.
        newcomerTargets={newcomerTargets.filter((t) => students.some((s) => s.id === t.studentId))}
        classSupported={item.classSupported}
        initialValue={{
          id: item.id,
          studentId: item.studentId,
          counselorId: item.counselorId,
          consultedAt: item.consultedAt,
          category: item.category,
          subject: item.subject,
          audience: item.audience,
          summary: item.summary,
          followUpAction: item.followUpAction,
          followUpDate: item.followUpDate,
          followUpDone: item.followUpDone,
          classId: item.classId,
          className: item.className,
          classSource: item.classSource,
        }}
      />
    </div>
  );
}
