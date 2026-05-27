import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireAccess } from "@/lib/auth/require-access";
import {
  getStudentConsultationById,
  getStudentOptionsForConsultation,
} from "@/features/consultations/server/queries";
import { getTeacherOptions } from "@/features/students/server/queries";
import { ConsultationForm } from "../../_components/consultation-form";

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
    <div className="mx-auto max-w-2xl space-y-6">
      <Link
        href="/consultations"
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm transition"
      >
        <ArrowLeft className="size-3.5" />
        학생상담으로
      </Link>

      <header className="border-border space-y-1 border-b pb-5">
        <p className="eyebrow">상담 수정</p>
        <h1 className="display text-foreground text-2xl">{item.studentName}</h1>
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
