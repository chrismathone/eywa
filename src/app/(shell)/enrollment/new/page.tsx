import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { NewConsultationForm } from "./form";

export const metadata = { title: "신규 등록상담 — eywa" };

export default function NewEnrollmentPage() {
  return (
    <div className="space-y-6">
      <Link
        href="/enrollment"
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm transition"
      >
        <ArrowLeft className="size-3.5" />
        등록상담으로
      </Link>

      <PageHeader
        title="신규 등록상담"
        description="신입생 정보 입력 후 저장하면 상세 페이지에서 AI 분석을 실행할 수 있습니다."
      />

      <NewConsultationForm />
    </div>
  );
}
