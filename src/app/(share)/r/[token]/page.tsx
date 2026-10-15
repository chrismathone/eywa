import { authorizeInternalWorker } from "@/features/sync-agent/server/internal-auth";
import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTenantSettingsByTenantId } from "@/features/owner/server/queries";
import { resolveBrandingSrc, resolveTenantReadUrls } from "@/lib/storage/media-storage";
import { parseForwardedFor } from "@/features/attendance/kiosk/device-info";
import { isShareExpired } from "@/features/onescreen/share-expiry";
import { expiredLinkHref } from "@/features/link-expired/kinds";
import { visibleAttachments } from "@/features/onescreen/attachment-utils";
import { fetchReportTrendRows, fetchSpecialClassIds } from "@/features/onescreen/server/score-history";
import { resolveReportAuthorSettings } from "@/features/onescreen/server/report-author-name";
import { formatReportAuthorName } from "@/features/onescreen/report-author-name";
import { buildTrendPoints } from "@/features/onescreen/report-trend";
import { ParentReportCard } from "@/features/onescreen/components/parent-report-card";
import { reportVideoHomework } from "@/features/onescreen/server/report-video-homework";
import { classKindMeta } from "@/features/classes/list-filters";
import { loadReportJjSnapshot } from "@/features/ijw/server/report-snapshot";
import { ClosedReportScreen } from "./_closed";
import { NEUTRAL_ACADEMY_NAME } from "@/features/owner/defaults";

// 학생 PII 문서 — 검색엔진 색인 차단(링크 유출 시에도 인덱싱 방지).
export const metadata = { title: "수업 보고서", robots: { index: false, follow: false } };

/**
 * 학부모 공개 수업 보고서 — 강사 원스크린 "카톡용/문자용 저장"이 만든 공유 링크(/r/[token])로 진입.
 * 인증 불필요: share_token(전역 유니크)을 service_role(admin)로 단건 조회 → 그 행의 tenant로 학원 브랜드 해석.
 * 토큰이 곧 접근권한이므로 다른 학생/테넌트 데이터 누수 없음((intake) 공개 토큰 패턴과 동일).
 * (print)/lesson_reports/[id]/print는 내부 인쇄용(로그인 게이트) — 이 페이지는 학부모 모바일 열람용.
 */
export default async function PublicLessonReportPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const admin = createAdminClient();

  const { data: report, error: reportError } = await admin
    .from("lesson_reports")
    .select(
      "id, tenant_id, student_id, class_id, subject, report_date, revoked_at, textbook, progress, exam_info, homework_score, homework_today, teacher_name, notes, trend_note, daily_test, check_test, attitude, attachments, makeup",
    )
    .eq("share_token", token)
    .maybeSingle();
  // 순간 DB 오류를 "링크 없음(404)"으로 보이면 학부모는 링크가 없어졌다고 받아들인다(E8) — 다시 열어 달라고 안내한다.
  if (reportError) return <ClosedReportScreen reason="unavailable" />;
  if (!report) notFound();
  // 취소(강사가 열람 차단) → 그 자리 취소화면. 만료와 뜻이 달라 만료 페이지로 보내지 않는다(취소된 사흘 전 보고서에
  // "90일 동안 열 수 있습니다"는 거짓이다). 취소가 만료보다 먼저 — 둘 다면 강사의 차단이 사실이다.
  if (report.revoked_at) return <ClosedReportScreen reason="revoked" />;
  // 만료(보고서일+90일 경과, 90일째 당일은 유효) → 공용 '링크 만료' 페이지로 307(원장 2026-10-01).
  // 🔴 주소엔 종류만 — 토큰을 싣지 않는다. 조회 로그(share_link_views)보다 앞이라 만료 열람은 적지 않는다(종전과 같다).
  // ⚠️ redirect()는 throw로 끝난다 — try 안에 넣지 말 것. ClassNote 워커 캡처는 이동 뒤 `.report-capture`가 없어 게시하지 않는다.
  if (isShareExpired(report.report_date as string)) redirect(expiredLinkHref("report"));

  // 조회 로그(0086a, best-effort) — 부모 열람 1회 = 1행. 워커 스크린샷(x-eywa-internal secret 일치)은 제외해 과집계 방지.
  const hdrs = await headers();
  const internalSecret = process.env.CLASSNOTE_INTERNAL_SECRET;
  const workerHeader = hdrs.get("x-eywa-internal");
  const scopedWorker = workerHeader?.startsWith("agent:") ? await authorizeInternalWorker(workerHeader) : null;
  const isInternal = (!!internalSecret && workerHeader === internalSecret) || (!!scopedWorker?.tenantId && scopedWorker.tenantId === report.tenant_id);
  if (!isInternal) {
    const ipRaw = parseForwardedFor(hdrs.get("x-forwarded-for"), hdrs.get("x-real-ip"));
    const ipHash = createHash("sha256")
      .update(`${ipRaw ?? "unknown"}:${report.tenant_id as string}`)
      .digest("hex");
    try {
      await admin.from("share_link_views").insert({
        tenant_id: report.tenant_id,
        lesson_report_id: report.id,
        ip_hash: ipHash,
        user_agent: hdrs.get("user-agent"),
      });
    } catch {
      /* 조회 로그 실패가 학부모 열람을 막으면 안 됨 */
    }
  }

  // 특강 반 목록 — 정규/특강 추이를 가르는 축(2026-07-23). admin은 RLS 우회라 tenant 필터 필수.
  const specialClassIds = await fetchSpecialClassIds(admin, report.tenant_id as string).catch(
    () => [] as string[],
  );
  const [{ data: student }, settings, trendRows, sendName, jj, reportClass, videoHomework] = await Promise.all([
    admin.from("students").select("name, school, grade").eq("id", report.student_id).maybeSingle(),
    getTenantSettingsByTenantId(report.tenant_id as string),
    // 성적 추이 이력 — admin(service_role)이라 tenantId 필터로 테넌트 격리 필수(#B6 규약). 실패해도 페이지 안 깨짐.
    fetchReportTrendRows(admin, report.student_id as string, report.subject as string | null, report.report_date as string, {
      tenantId: report.tenant_id as string,
      classId: report.class_id as string | null,
      specialClassIds,
    }).catch(() => []),
    // 발송용 이름(0217a) — 강사가 정했으면 '담임' 칸에 실명 대신 표시. fail-soft(실패=실명 그대로).
    // ClassNote 게시 이미지는 이 페이지의 워커 스크린샷이라 여기 한 곳으로 이미지 표기가 함께 바뀐다.
    resolveReportAuthorSettings(report.tenant_id as string, report.teacher_name as string | null),
    // 영어 보고서의 인재원 그림 재료(0261a, 저장 때 묶인 동결본) — 위 SELECT에 섞지 않고 **따로** 읽는다(#95).
    // 표가 없거나 실패하면 null = 그림 자리만 빈다(글은 그대로). 워커 캡처도 이 페이지라 ClassNote 이미지에 같이 실린다.
    report.subject === "english"
      ? loadReportJjSnapshot(report.tenant_id as string, report.id as string)
      : Promise.resolve(null),
    // 제목 "[특강]"(원장 2026-09-30) — 이 보고서 반이 특강인가(수업목록 '구분'과 같은 판정). admin이라 tenant 필터 필수.
    report.class_id
      ? admin
          .from("classes")
          .select("is_special, class_name")
          .eq("tenant_id", report.tenant_id as string)
          .eq("id", report.class_id as string)
          .maybeSingle()
          .then(({ data }) => data, () => null)
      : Promise.resolve(null),
    reportVideoHomework(admin, report.tenant_id as string, report.id as string),
  ]);
  const trend = buildTrendPoints(trendRows, report.id as string);

  const academyName = settings.profile.name || NEUTRAL_ACADEMY_NAME;
  const rpt = settings.report; // 보고서 표시 설정(학원 운영 > 보고서 탭): 로고/학원명/제목/필드 토글/바닥글
  // 로고 해석은 GCS signed URL 등 외부 의존 — 실패해도 페이지는 로고 없이 렌더(학부모 링크가 깨지지 않게).
  const logoSrc = settings.profile.logoUrl
    ? await resolveBrandingSrc(settings.profile.logoUrl, report.tenant_id as string).catch(() => null)
    : null;

  // 학생 사진 첨부(P2b) — path별 signed URL(실패 path는 resolveTenantReadUrls가 자동 생략, 페이지 안 깨짐).
  // 학원 설정에서 첨부 표시를 끄면 signed URL 생성도 건너뜀(불필요한 외부 호출 회피).
  const attachments = (report.attachments as { path: string; name: string }[] | null) ?? [];
  const attachmentUrls: Record<string, string> =
    rpt.showAttachments && attachments.length
      ? await resolveTenantReadUrls(
          attachments.map((a) => a.path),
          "report_attachment",
          report.tenant_id as string,
        ).catch(() => ({}))
      : {};
  const attachmentAll = attachments
    .map((a) => ({ ...a, url: attachmentUrls[a.path] }))
    .filter((a): a is { path: string; name: string; url: string } => !!a.url);
  // 워커 스크린샷(내부 요청)에선 첨부를 전부 뺀다(이미지·파일 모두 게시글에 네이티브 부착 → 스샷 중복 제거).
  // 판정·사유는 visibleAttachments 주석 참조.
  const attachmentImgs = visibleAttachments(attachmentAll, { forScreenshot: isInternal });

  return (
    // 뷰포트보다 짧으면 상하 중앙 정렬, 길면 자연 스크롤(min-h-screen + justify-center = 넘쳐도 클립 안 됨).
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-6">
      <ParentReportCard
        report={{
          reportDate: report.report_date,
          teacherName: formatReportAuthorName(report.teacher_name, sendName, reportClass?.class_name),
          textbook: report.textbook,
          progress: report.progress,
          dailyTest: report.daily_test,
          checkTest: report.check_test,
          examInfo: report.exam_info,
          homeworkScore: report.homework_score,
          homeworkToday: report.homework_today,
          videoHomework: videoHomework.assigned,
          videoHomeworkDue: videoHomework.due,
          attitude: report.attitude,
          notes: report.notes,
          trendNote: report.trend_note,
          makeup: report.makeup === true, // 보강이면 제목에 접미사 — 반이 붙었으면 "(정규+보강)"(makeup-label.ts)
          hasClass: report.class_id != null,
          special: reportClass
            ? classKindMeta({ isSpecial: reportClass.is_special as boolean | null, className: reportClass.class_name as string }).kind === "special"
            : false,
        }}
        student={student ?? null}
        academyName={academyName}
        logoSrc={logoSrc}
        settings={rpt}
        attachments={attachmentImgs}
        trend={trend}
        // 영어 = 템플릿 모드(사용자 2026-09-10) — notes가 템플릿으로 조립된 글 그 자체라 항목 칸 대신 본문으로.
        // subject는 이미 위 SELECT에 있다 — 새 컬럼을 넣지 않는다(없는 컬럼 하나가 /r 전체를 죽인다, #95).
        templateMode={report.subject === "english"}
        jj={jj}
      />
    </div>
  );
}
