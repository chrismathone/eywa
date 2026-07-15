import { createAdminClient } from "@/lib/supabase/admin";
import { getTenantSettingsByTenantId } from "@/features/owner/server/queries";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { PublicIntakeForm } from "./public-intake-form";

export const metadata = { title: "입학 상담 신청" };

function ClosedScreen({ message }: { message: string }) {
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-3 px-6 text-center">
      <p className="text-foreground text-lg font-semibold">접수를 받을 수 없습니다</p>
      <p className="text-text-dim text-sm">{message}</p>
    </div>
  );
}

export default async function PublicIntakePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const admin = createAdminClient();
  const { data: tok } = await admin
    .from("intake_tokens")
    .select("id, tenant_id, is_active, expires_at, usage_count")
    .eq("token", token)
    .maybeSingle();

  if (!tok || !tok.is_active) {
    return <ClosedScreen message="유효하지 않거나 종료된 접수 링크입니다." />;
  }
  if (tok.expires_at && new Date(tok.expires_at as string) < new Date()) {
    return <ClosedScreen message="접수 기간이 만료되었습니다." />;
  }

  // 조회수 집계 — 유효한 공개 폼 노출 1회 = usage_count +1(제출수와 분리해 전환율 파악).
  await admin
    .from("intake_tokens")
    .update({ usage_count: ((tok.usage_count as number) ?? 0) + 1 })
    .eq("id", tok.id);

  const settings = await getTenantSettingsByTenantId(tok.tenant_id as string);
  const academyName = settings.profile.name || "학원";
  // 공개 접수에 노출할 과목만 — 재원생 대상 반(수학(심화) 등)은 학원설정에서 hiddenFromIntake로 숨긴다.
  // (코드에서 특정 과목 키를 빼면 설정이 바뀔 때 화면이 어긋난다 = 운영 enum 하드코딩 금지 규칙.)
  const subjects = buildSubjectMaps(
    settings.operations.subjects.filter((s) => !s.hiddenFromIntake),
  );

  // 봇 time-trap 기준 시각(서버, 제출 시 경과시간 측정) + 캡차 사이트키(env 없으면 캡차 미노출).
  // eslint-disable-next-line react-hooks/purity -- 동적 페이지, 요청당 1회 렌더
  const serverNow = Date.now();
  const turnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? null;

  return (
    <PublicIntakeForm
      token={token}
      academyName={academyName}
      subjectOptions={subjects.options}
      gradeLevels={settings.operations.gradeLevels}
      shuttle={settings.operations.shuttle}
      privacyTerms={settings.notifications.privacyTerms}
      serviceTerms={settings.notifications.serviceTerms}
      serverNow={serverNow}
      turnstileSiteKey={turnstileSiteKey}
    />
  );
}
