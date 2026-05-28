import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireAccess } from "@/lib/auth/require-access";
import { NewMeetingForm } from "./new-meeting-form";

export const metadata = { title: "새 회의록 — eywa" };

export default async function NewMeetingPage() {
  await requireAccess("meetings");

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Link
        href="/meetings"
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm transition"
      >
        <ArrowLeft className="size-3.5" />
        회의록으로
      </Link>

      <header className="border-border space-y-1 border-b pb-5">
        <p className="eyebrow">새 회의록</p>
        <h1 className="display text-foreground text-2xl">녹음 업로드 + 자동 분석</h1>
        <p className="text-muted-foreground text-sm">
          MP3/M4A/WAV 등 음성 파일을 올리면 한국어 전사 후 8개 섹션으로 자동 분석합니다.
          또는 브라우저에서 바로 녹음 — 별도 창에서 진행되어 메인 화면을 자유롭게 사용할 수 있습니다.
        </p>
      </header>

      <NewMeetingForm />
    </div>
  );
}
