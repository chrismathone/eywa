import { BackLink } from "@/components/back-link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireAccess } from "@/lib/auth/require-access";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { createClient } from "@/lib/supabase/server";
import { referrerColumnsReady } from "@/features/enrollment/server/referrer-queries";
import { formInstanceKey } from "@/lib/recording-resume";
import { NewConsultationForm } from "./form";

export const metadata = { title: "신규 콜&상담 작성 — 에이와" };

export default async function NewEnrollmentPage({
  searchParams,
}: {
  searchParams: Promise<{ form?: string }>;
}) {
  const viewer = await requireAccess("enrollment");
  // 작성 화면 한 벌 = `form` — 녹음이 걸린 상담이 있을 때 연 새 작성 화면(recording-resume.ts). 같은 주소에서 쿼리만
  // 바뀌면 Next가 폼을 그대로 두므로 key로 갈라 새로 그린다.
  const { form } = await searchParams;
  // 소개한 사람 칸(0362a)이 DB에 있을 때만 그린다(#95) — 행을 받지 않는 확인 한 번.
  // 읽기 권한이면 칸을 잠그고 저장·녹음 단추를 그리지 않는다 — 저장 액션 게이트와 같은 함수·같은 키(원장 2026-11-05 · write-lock.ts).
  const [referrerReady, canWrite] = await Promise.all([
    referrerColumnsReady((await createClient()) as unknown as SupabaseClient),
    canWriteTenant(viewer.systemRole, "enrollment"),
  ]);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <BackLink href="/enrollment" label="신규 콜&상담으로" />

      <header className="border-border space-y-1 border-b pb-5">
        <p className="eyebrow">신규 콜&상담</p>
        <h1 className="font-bold tracking-tight text-foreground text-2xl">신규 콜&상담 작성</h1>
        <p className="text-muted-foreground text-sm">
          학생·학부모 정보를 입력하세요. 상담을 <strong>입력하면서 바로 녹음</strong>하거나 음성 파일을 올리면, 저장 시
          자동으로 한국어 전사 + 13섹션 AI 분석까지 실행합니다(입력하신 내용은 보존).
        </p>
      </header>

      <NewConsultationForm key={formInstanceKey(form)} recordingOwner={{ tenantId: viewer.tenantId, userId: viewer.id }} referrerReady={referrerReady}
        counselor={viewer.displayName} instance={{ formId: typeof form === "string" ? form : undefined }} readOnly={!canWrite} />
    </div>
  );
}
