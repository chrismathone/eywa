import { BackLink } from "@/components/back-link";
import { requireAccess } from "@/lib/auth/require-access";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { formInstanceKey } from "@/lib/recording-resume";
import { NewMeetingForm } from "./new-meeting-form";

export const metadata = { title: "새 회의록 — 에이와" };

export default async function NewMeetingPage({
  searchParams,
}: {
  searchParams: Promise<{ form?: string }>;
}) {
  const viewer = await requireAccess("meetings");
  // 작성 화면 한 벌 = `form` — 녹음이 걸린 회의록이 있을 때 연 새 작성 화면(recording-resume.ts). 같은 주소에서 쿼리만
  // 바뀌면 Next가 폼을 그대로 두므로 key로 갈라 새로 그린다.
  const { form } = await searchParams;
  // 주소로 바로 들어온 읽기 권한도 양식은 보이되 잠근다(칸 비활성 + 안내, 업로드·녹음·저장 단추 없음 — 원장 2026-11-05).
  // 판정은 생성 액션(startMeetingFromAudio·createTextMeeting)과 같은 함수다.
  const canWrite = await canWriteTenant(viewer.systemRole, "meetings");

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <BackLink href="/meetings" label="회의록으로" />

      <header className="border-border space-y-1 border-b pb-5">
        <p className="eyebrow">새 회의록</p>
        <h1 className="font-bold tracking-tight text-foreground text-2xl">녹음 업로드 + 자동 분석</h1>
        <p className="text-muted-foreground text-sm">
          MP3/M4A/WAV 등 음성 파일을 올리면 한국어 전사 후 8개 섹션으로 자동 분석합니다.
          브라우저에서 바로 녹음할 수도 있습니다. 다른 화면으로 이동해도 녹음은 계속되며, 녹음 아이콘에서 진행 상황을 확인할 수 있습니다.
        </p>
      </header>

      <NewMeetingForm key={formInstanceKey(form)} recordingOwner={{ tenantId: viewer.tenantId, userId: viewer.id }}
        instance={{ formId: typeof form === "string" ? form : undefined }} canWrite={canWrite} />
    </div>
  );
}
