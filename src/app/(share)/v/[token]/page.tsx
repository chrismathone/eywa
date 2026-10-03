import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTenantSettingsByTenantId } from "@/features/owner/server/queries";
import { NEUTRAL_ACADEMY_NAME } from "@/features/owner/defaults";
import { formatShortKoreanDate, kstToday } from "@/lib/date-kst";
import { HOMEWORK_VIDEO_MAX_LABEL } from "@/features/students/homework-video-limits";
import { maskStudentName } from "@/features/video-submit/rules";
import { uploadLastDay, VIDEO_UPLOAD_OTHER_WAYS } from "@/features/video-submit/site";
import { expiredLinkHref } from "@/features/link-expired/kinds";
import { videoSubmitAvailability } from "@/features/video-submit/server/availability";
import { resolveSubmitToken } from "@/features/video-submit/server/links";
import { isAssignedHomeworkDate, openHomeworkDates } from "@/features/video-submit/server/site-homework";
import { siteAvailability } from "@/features/video-submit/server/site";
import type { LinkRow } from "@/features/video-submit/server/links";
import { VideoSubmitForm } from "./video-submit-form";

// 학생 정보가 걸린 공개 화면 — 색인 금지. 리퍼러 없음: 주소의 토큰이 외부(글꼴·Google 업로드 요청)로 새지 않게.
export const metadata = { title: "숙제 영상 제출", robots: { index: false, follow: false }, referrer: "no-referrer" as const };
export const dynamic = "force-dynamic";

function Closed({ title, message, toSite = false }: { title: string; message: string; toSite?: boolean }) {
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-3 px-6 pb-8 text-center lg:pb-10">
      <p className="text-foreground text-lg font-bold">{title}</p>
      <p className="text-text-dim text-sm break-keep">{message}</p>
      {/* 링크가 닫혔으면 올리기 사이트로 — 학생마다 새 링크는 만들지 않는다(2026-10-03). 같은 주소의 `/v`다. */}
      {toSite ? <Link href="/v" prefetch={false} className="border-line text-foreground hover:bg-muted rounded-lg border px-4 py-3 text-base font-bold">숙제 영상 올리기 사이트로</Link> : null}
    </div>
  );
}
const UNAVAILABLE = <Closed title="지금은 제출을 받을 수 없습니다" message="잠시 후 다시 열어 주시거나 담당 선생님께 알려 주세요." />;
const CLASSNOTE_ONLY = "숙제 영상은 ClassNote 알림장에 올려 주세요.";

/**
 * 이 링크로 못 올릴 때 갈 길(지점 기능을 확인한 뒤에만 부른다) — 학생마다 새 링크는 없으므로(2026-10-03) ClassNote 또는 올리기 사이트.
 * 사이트는 **그 지점이 지금 쓸 수 있을 때만** 권한다(없는 주소로 보내지 않는다). 오늘 끊긴 사이트 링크는 오늘 사이트로 다시 열 수 없어
 * ClassNote만 안내한다(`openSiteLink`의 끊김 판정과 같다).
 */
async function closedElsewhere(db: ReturnType<typeof createAdminClient>, link: LinkRow, lead: string) {
  const site = link.origin === "site" ? null : await siteAvailability(db).catch(() => null);
  const toSite = !!site?.ok && site.tenantId === link.tenant_id;
  return <Closed title="사용할 수 없는 링크입니다" message={`${lead}${toSite ? VIDEO_UPLOAD_OTHER_WAYS : CLASSNOTE_ONLY}`} toSite={toSite} />;
}

/**
 * 숙제 영상 제출 — 학부모가 로그인 없이 연다(`/v/<토큰>`, 원장 2026-10-01). 토큰이 지점·학생·반을 정한다(service_role 단건 조회).
 *  · 만료(7일 지남) → 공용 '링크 만료' 화면(`/expired?kind=video`)으로. 🔴 토큰을 그 주소에 싣지 않는다.
 *  · 없는 토큰·끊긴 링크 → 같은 문구("사용할 수 없는 링크") — 끊김은 시간 만료와 뜻이 달라 만료 화면으로 보내지 않는다.
 *  · ClassNote 기능이 꺼진 학원 → 없는 주소(404) — 기능 스위치 OFF는 흔적 없이.
 *  · Drive 값·SQL·워커 기록이 아직 없다 → "지금은 제출을 받을 수 없습니다".
 *  · 올리기 사이트가 만든 링크는 **고른 숙제**(`?h=숙제일`)가 있어야 연다(원장 2026-10-03) — 주소의 값을 믿지 않고 그 학생 × 반에
 *    실제로 나간 영상 숙제인지 다시 확인한다. 없거나 틀리면 사이트 첫 화면으로 돌려보낸다(숙제를 다시 고른다).
 */
export default async function VideoSubmitPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ h?: string | string[] }> }) {
  const { token } = await params;
  const { h } = await searchParams;
  const picked = typeof h === "string" ? h : null;
  const db = createAdminClient();
  let resolved: Awaited<ReturnType<typeof resolveSubmitToken>>;
  try {
    resolved = await resolveSubmitToken(db, token);
  } catch {
    return UNAVAILABLE; // 표가 아직 없거나(0325a 전) 순간 DB 오류
  }
  // 올리기 사이트가 만든 링크는 숙제 기한까지 살고 보고서와 무관하다 — "7일" 만료 안내가 맞지 않는다.
  // 사이트 첫 화면으로 돌려보내면 그 자리에서 새 링크를 만든다(주소창·방문 기록에 남은 옛 주소로 들어온 학생).
  if (resolved.state === "expired") redirect(resolved.link.origin === "site" ? "/v" : expiredLinkHref("video"));
  // 없는 토큰 — 지점을 모르니 갈 길을 단정하지 않는다.
  if (resolved.state === "invalid")
    return <Closed title="사용할 수 없는 링크입니다" message="이 링크로는 영상을 올릴 수 없습니다. 담당 선생님께 알려 주세요." />;
  const { link } = resolved;
  // 끊긴 링크도 지점 기능부터 본다 — 꺼진 지점은 없는 주소와 똑같이(흔적 없이), 갈 길 안내는 그 뒤에.
  const settings = await getTenantSettingsByTenantId(link.tenant_id);
  const availability = await videoSubmitAvailability(link.tenant_id, settings, db);
  if (!availability.ok && availability.reason === "module_off") notFound();
  if (!availability.ok) return UNAVAILABLE;
  if (resolved.state === "revoked") return closedElsewhere(db, link, "이 링크로는 더 이상 영상을 올릴 수 없습니다. ");
  const [studentRes, classRes] = await Promise.all([
    db.from("students").select("name").eq("tenant_id", link.tenant_id).eq("id", link.student_id).maybeSingle(),
    db.from("classes").select("class_name").eq("tenant_id", link.tenant_id).eq("id", link.class_id).maybeSingle(),
  ]);
  if (studentRes.error || classRes.error) return UNAVAILABLE;
  if (!studentRes.data || !classRes.data) return closedElsewhere(db, link, "");
  // 고른 숙제 — 확인된 날짜만 화면·업로드에 싣는다. 사이트 링크인데 확인이 안 되면 숙제를 다시 고르게 한다.
  let homeworkDate: string | null = null;
  if (picked) {
    try {
      if (await isAssignedHomeworkDate(db, link.tenant_id, { studentId: link.student_id, classId: link.class_id }, picked, kstToday())) homeworkDate = picked;
    } catch {
      return UNAVAILABLE;
    }
  }
  if (link.origin === "site" && !homeworkDate) redirect("/v");
  // 같은 반의 **다른** 안 낸 숙제 — 숙제 하나를 올린 뒤 다음 숙제로 바로 간다(같은 링크에 숙제일만 바꾼다). 숙제마다 처음 화면으로 돌아가
  // 번호·이름을 다시 넣게 하면 조회·열기 횟수 제한과 하루 링크 수 상한이 "학생당 한 번"이 아니라 "숙제 수"만큼 든다(리뷰 2026-10-03).
  // 못 읽으면 그냥 비운다(이 화면의 숙제는 이미 확인됐다).
  let otherHomework: { date: string; label: string }[] = [];
  if (link.origin === "site" && homeworkDate) {
    try {
      const open = await openHomeworkDates(db, link.tenant_id, [{ studentId: link.student_id, classId: link.class_id }], kstToday());
      otherHomework = (open?.get(`${link.class_id}:${link.student_id}`) ?? [])
        .filter((date) => date !== homeworkDate)
        .map((date) => ({ date, label: formatShortKoreanDate(date) }));
    } catch {
      otherHomework = [];
    }
  }
  return (
    <VideoSubmitForm
      token={token}
      academyName={settings.profile.name?.trim() || NEUTRAL_ACADEMY_NAME}
      studentLabel={maskStudentName(studentRes.data.name as string | null)}
      className={(classRes.data.class_name as string | null)?.trim() || "수업"}
      homeworkDate={homeworkDate}
      homeworkLabel={homeworkDate ? formatShortKoreanDate(homeworkDate) : null}
      otherHomework={otherHomework}
      // 마지막으로 쓸 수 있는 날 — 서버에서 글자로 만들어 넘긴다(하이드레이션 차이 없음, [[#108]]). 고른 숙제가 있으면 그 숙제의 기한
      // (숙제일 + 7일)과 링크가 끝나는 날 중 이른 날(학생에게는 "이 숙제를 언제까지 올리나"가 중요하다).
      lastDayLabel={formatShortKoreanDate(uploadLastDay(link.expires_at, homeworkDate))}
      maxLabel={HOMEWORK_VIDEO_MAX_LABEL}
    />
  );
}
