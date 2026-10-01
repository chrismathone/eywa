import { notFound, redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTenantSettingsByTenantId } from "@/features/owner/server/queries";
import { NEUTRAL_ACADEMY_NAME } from "@/features/owner/defaults";
import { formatShortKoreanDate, kstDateOf } from "@/lib/date-kst";
import { HOMEWORK_VIDEO_MAX_LABEL } from "@/features/students/homework-video-limits";
import { maskStudentName, VIDEO_LINK_EXPIRED_URL } from "@/features/video-submit/rules";
import { videoSubmitAvailability } from "@/features/video-submit/server/availability";
import { resolveSubmitToken } from "@/features/video-submit/server/links";
import { VideoSubmitForm } from "./video-submit-form";

// 학생 정보가 걸린 공개 화면 — 색인 금지. 리퍼러 없음: 주소의 토큰이 외부(글꼴·Google 업로드 요청)로 새지 않게.
export const metadata = { title: "숙제 영상 제출", robots: { index: false, follow: false }, referrer: "no-referrer" as const };
export const dynamic = "force-dynamic";

function Closed({ title, message }: { title: string; message: string }) {
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-3 px-6 pb-8 text-center lg:pb-10">
      <p className="text-foreground text-lg font-bold">{title}</p>
      <p className="text-text-dim text-sm break-keep">{message}</p>
    </div>
  );
}
const UNAVAILABLE = <Closed title="지금은 제출을 받을 수 없습니다" message="잠시 후 다시 열어 주시거나 담당 선생님께 알려 주세요." />;

/**
 * 숙제 영상 제출 — 학부모가 로그인 없이 연다(`/v/<토큰>`, 원장 2026-10-01). 토큰이 지점·학생·반을 정한다(service_role 단건 조회).
 *  · 만료(7일 지남) → 공용 '링크 만료' 화면(`/expired?kind=video`)으로. 🔴 토큰을 그 주소에 싣지 않는다.
 *  · 없는 토큰·끊긴 링크 → 같은 문구("사용할 수 없는 링크") — 끊김은 시간 만료와 뜻이 달라 만료 화면으로 보내지 않는다.
 *  · ClassNote 기능이 꺼진 학원 → 없는 주소(404) — 기능 스위치 OFF는 흔적 없이.
 *  · Drive 값·SQL·워커 기록이 아직 없다 → "지금은 제출을 받을 수 없습니다".
 */
export default async function VideoSubmitPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const db = createAdminClient();
  let resolved: Awaited<ReturnType<typeof resolveSubmitToken>>;
  try {
    resolved = await resolveSubmitToken(db, token);
  } catch {
    return UNAVAILABLE; // 표가 아직 없거나(0325a 전) 순간 DB 오류
  }
  if (resolved.state === "expired") redirect(VIDEO_LINK_EXPIRED_URL);
  if (resolved.state !== "ok")
    return <Closed title="사용할 수 없는 링크입니다" message="이 링크로는 더 이상 영상을 올릴 수 없습니다. 담당 선생님께 새 링크를 받아 주세요." />;
  const { link } = resolved;
  const settings = await getTenantSettingsByTenantId(link.tenant_id);
  const availability = await videoSubmitAvailability(link.tenant_id, settings, db);
  if (!availability.ok && availability.reason === "module_off") notFound();
  if (!availability.ok) return UNAVAILABLE;
  const [studentRes, classRes] = await Promise.all([
    db.from("students").select("name").eq("tenant_id", link.tenant_id).eq("id", link.student_id).maybeSingle(),
    db.from("classes").select("class_name").eq("tenant_id", link.tenant_id).eq("id", link.class_id).maybeSingle(),
  ]);
  if (studentRes.error || classRes.error) return UNAVAILABLE;
  if (!studentRes.data || !classRes.data)
    return <Closed title="사용할 수 없는 링크입니다" message="담당 선생님께 새 링크를 받아 주세요." />;
  return (
    <VideoSubmitForm
      token={token}
      academyName={settings.profile.name?.trim() || NEUTRAL_ACADEMY_NAME}
      studentLabel={maskStudentName(studentRes.data.name as string | null)}
      className={(classRes.data.class_name as string | null)?.trim() || "수업"}
      // 마지막으로 쓸 수 있는 날(끝나는 순간 1ms 전의 한국 날짜) — 서버에서 글자로 만들어 넘긴다(하이드레이션 차이 없음, [[#108]]).
      lastDayLabel={formatShortKoreanDate(kstDateOf(new Date(Date.parse(link.expires_at) - 1)) ?? "")}
      maxLabel={HOMEWORK_VIDEO_MAX_LABEL}
    />
  );
}
