import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { isModuleEnabled } from "@/lib/modules";
import { getTenantSettingsByTenantId } from "@/features/owner/server/queries";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { PublicIntakeForm } from "./public-intake-form";
import { isIntakeExpired } from "@/features/enrollment/intake-expiry";
import { expiredLinkHref } from "@/features/link-expired/kinds";

export const metadata = { title: "입학 상담 신청" };

/**
 * ⚠️ 제출 액션이 `after()`로 상담 브리프를 자동 생성한다(심층 분석 실측 ~70초). 기본 15초면 플랫폼이
 * 백그라운드 작업을 죽여 브리프가 'generating'에 멈춘다 — 학부모 응답 자체는 즉시 끝나므로
 * 이 상한은 대기 시간이 아니라 백그라운드 여유다.
 */
export const maxDuration = 300;

function ClosedScreen({ message }: { message: string }) {
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-3 px-6 text-center">
      <p className="text-foreground text-lg font-bold">접수를 받을 수 없습니다</p>
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
  // 기간 만료 → 공용 '링크 만료' 페이지로 307(원장 2026-10-01). 주소엔 종류만(토큰 금지). 학원이 끈 링크(is_active)·
  // 없는 토큰은 뜻이 달라 위 화면 그대로다. 조회수(usage_count) 집계보다 앞이라 만료 열람은 세지 않는다(종전과 같다).
  if (isIntakeExpired(tok.expires_at as string | null)) redirect(expiredLinkHref("intake"));

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
      // 셔틀 기능이 꺼진 학원은 셔틀 신청 칸이 없다(2026-09-30 "꺼지면 흔적 없이").
      shuttle={isModuleEnabled(settings.modules.disabled, "shuttle") ? settings.operations.shuttle : { ...settings.operations.shuttle, enabled: false }}
      privacyTerms={settings.notifications.privacyTerms}
      serviceTerms={settings.notifications.serviceTerms}
      serverNow={serverNow}
      turnstileSiteKey={turnstileSiteKey}
    />
  );
}
