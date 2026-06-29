import { BackLink } from "@/components/back-link";
import { requireAccess } from "@/lib/auth/require-access";
import { NewConsultationForm } from "./form";

export const metadata = { title: "신규 등록상담 — eywa" };

export default async function NewEnrollmentPage() {
  await requireAccess("enrollment");

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <BackLink href="/enrollment" label="등록상담으로" />

      <header className="border-border space-y-1 border-b pb-5">
        <p className="eyebrow">신규 등록상담</p>
        <h1 className="display text-foreground text-2xl">신규 등록상담</h1>
        <p className="text-muted-foreground text-sm">
          학생·학부모 정보를 입력하세요. 상담을 <strong>입력하면서 바로 녹음</strong>하거나 음성 파일을 올리면, 저장 시
          자동으로 한국어 전사 + 13섹션 AI 분석까지 실행합니다(입력하신 내용은 보존).
        </p>
      </header>

      <NewConsultationForm />
    </div>
  );
}
