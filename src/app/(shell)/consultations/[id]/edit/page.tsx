import { notFound } from "next/navigation";
import { requireAccess } from "@/lib/auth/require-access";
import { BackLink } from "@/components/back-link";
import {
  getStudentConsultationById,
  getStudentOptionsForConsultation,
} from "@/features/consultations/server/queries";
import { getTeacherOptions } from "@/features/students/server/queries";
import { ConsultationForm } from "../../_components/consultation-form";
import { ConsultationDeleteButton } from "../../_components/consultation-delete-button";

export const metadata = { title: "상담 수정 — eywa" };

export default async function EditConsultationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAccess("consultations");
  const { id } = await params;
  const [item, students, counselors] = await Promise.all([
    getStudentConsultationById(id),
    getStudentOptionsForConsultation(),
    getTeacherOptions(),
  ]);
  if (!item) notFound();

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* 상세(읽기) 페이지가 생겨(2026-07-03) 뒤로가기는 상세로 — 녹음/전사/AI 패널(읽기 콘텐츠)도 상세로 이동. */}
      <BackLink href={`/consultations/${item.id}`} label="상담 상세로" />

      <header className="border-border flex flex-wrap items-end justify-between gap-3 border-b pb-5">
        <div className="space-y-1">
          <p className="eyebrow">상담 수정</p>
          <h1 className="display text-foreground text-2xl">{item.studentName}</h1>
        </div>
        <ConsultationDeleteButton
          id={item.id}
          studentId={item.studentId}
          redirectTo="/consultations"
        />
      </header>

      <ConsultationForm
        mode="edit"
        students={students}
        counselors={counselors}
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
        }}
      />
    </div>
  );
}
