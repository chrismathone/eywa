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
    .select("id, tenant_id, is_active, expires_at")
    .eq("token", token)
    .maybeSingle();

  if (!tok || !tok.is_active) {
    return <ClosedScreen message="유효하지 않거나 종료된 접수 링크입니다." />;
  }
  if (tok.expires_at && new Date(tok.expires_at as string) < new Date()) {
    return <ClosedScreen message="접수 기간이 만료되었습니다." />;
  }

  const settings = await getTenantSettingsByTenantId(tok.tenant_id as string);
  const academyName = settings.profile.name || "학원";
  const subjects = buildSubjectMaps(settings.operations.subjects);

  return (
    <PublicIntakeForm
      token={token}
      academyName={academyName}
      subjectOptions={subjects.options}
      gradeLevels={settings.operations.gradeLevels}
    />
  );
}
