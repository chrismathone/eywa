import { BackLink } from "@/components/back-link";
import { requireAccess } from "@/lib/auth/require-access";
import { NewConsultationForm } from "./form";
import { NewConsultationRecordingForm } from "./recording-form";
import { ModeTabs } from "./mode-tabs";

export const metadata = { title: "신규 등록상담 — eywa" };

export default async function NewEnrollmentPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string }>;
}) {
  await requireAccess("enrollment");
  const { mode } = await searchParams;
  const tab = mode === "recording" ? "recording" : "manual";

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <BackLink href="/enrollment" label="등록상담으로" />

      <header className="border-border space-y-1 border-b pb-5">
        <p className="eyebrow">신규 등록상담</p>
        <h1 className="display text-foreground text-2xl">
          {tab === "recording" ? "녹음 업로드 + 13섹션 AI 분석" : "수동 입력"}
        </h1>
        <p className="text-muted-foreground text-sm">
          {tab === "recording"
            ? "MP3/M4A/WAV 등 음성 파일을 올리면 한국어 전사 후 13개 섹션으로 자동 분석합니다. 학생/학부모 정보도 전사에서 자동 추출."
            : "신입생 정보를 직접 입력합니다. 저장 후 상세 페이지에서 텍스트 기반 AI 분석을 실행할 수 있습니다."}
        </p>
      </header>

      <ModeTabs active={tab} />

      {tab === "recording" ? <NewConsultationRecordingForm /> : <NewConsultationForm />}
    </div>
  );
}
