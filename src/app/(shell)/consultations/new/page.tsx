import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireAccess } from "@/lib/auth/require-access";
import { getStudentOptionsForConsultation } from "@/features/consultations/server/queries";
import { getTeacherOptions } from "@/features/students/server/queries";
import { ConsultationForm } from "../_components/consultation-form";

export const metadata = { title: "새 학생상담 — eywa" };

export default async function NewConsultationPage({
  searchParams,
}: {
  searchParams: Promise<{ studentId?: string }>;
}) {
  await requireAccess("consultations");
  const { studentId } = await searchParams;
  const [students, counselors] = await Promise.all([
    getStudentOptionsForConsultation(),
    getTeacherOptions(),
  ]);

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
        <p className="eyebrow">새 학생상담</p>
        <h1 className="display text-foreground text-2xl">상담 기록 추가</h1>
        <p className="text-muted-foreground text-sm">
          학생/학부모 면담을 기록합니다. 후속 조치 날짜를 지정하면 기한이 다가올수록 색상으로 알려드립니다.
        </p>
      </header>

      <ConsultationForm
        mode="create"
        students={students}
        counselors={counselors}
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
