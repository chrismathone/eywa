import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTenantSettingsByTenantId } from "@/features/owner/server/queries";
import { resolveBrandingSrc, resolveTenantReadUrls } from "@/lib/storage/media-storage";
import { parseForwardedFor } from "@/features/attendance/kiosk/device-info";
import { isShareExpired } from "@/features/onescreen/share-expiry";
import { visibleAttachments } from "@/features/onescreen/attachment-utils";
import { fetchReportTrendRows, fetchSpecialClassIds } from "@/features/onescreen/server/score-history";
import { buildTrendPoints } from "@/features/onescreen/report-trend";
import { ParentReportCard } from "@/features/onescreen/components/parent-report-card";
import { ClosedReportScreen } from "./_closed";

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

  const { data: report } = await admin
    .from("lesson_reports")
    .select(
      "id, tenant_id, student_id, class_id, subject, report_date, revoked_at, textbook, progress, exam_info, homework_score, homework_today, teacher_name, notes, trend_note, daily_test, check_test, attitude, attachments, makeup",
    )
    .eq("share_token", token)
    .maybeSingle();
  if (!report) notFound();
  // 취소(강사가 열람 차단) → 취소화면. 만료(보고서일+90일 경과) → 만료화면. 둘 다 생 404 대신 친화 안내.
  if (report.revoked_at) return <ClosedReportScreen reason="revoked" />;
  if (isShareExpired(report.report_date as string)) return <ClosedReportScreen reason="expired" />;

  // 조회 로그(0086a, best-effort) — 부모 열람 1회 = 1행. 워커 스크린샷(x-eywa-internal secret 일치)은 제외해 과집계 방지.
  const hdrs = await headers();
  const internalSecret = process.env.CLASSNOTE_INTERNAL_SECRET;
  const isInternal = !!internalSecret && hdrs.get("x-eywa-internal") === internalSecret;
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
  const [{ data: student }, settings, trendRows] = await Promise.all([
    admin.from("students").select("name, school, grade").eq("id", report.student_id).maybeSingle(),
    getTenantSettingsByTenantId(report.tenant_id as string),
    // 성적 추이 이력 — admin(service_role)이라 tenantId 필터로 테넌트 격리 필수(#B6 규약). 실패해도 페이지 안 깨짐.
    fetchReportTrendRows(admin, report.student_id as string, report.subject as string | null, report.report_date as string, {
      tenantId: report.tenant_id as string,
      classId: report.class_id as string | null,
      specialClassIds,
    }).catch(() => []),
  ]);
  const trend = buildTrendPoints(trendRows, report.id as string);

  const academyName = settings.profile.name || "인재원";
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
          teacherName: report.teacher_name,
          textbook: report.textbook,
          progress: report.progress,
          dailyTest: report.daily_test,
          checkTest: report.check_test,
          examInfo: report.exam_info,
          homeworkScore: report.homework_score,
          homeworkToday: report.homework_today,
          attitude: report.attitude,
          notes: report.notes,
          trendNote: report.trend_note,
          makeup: report.makeup === true, // 보강이면 제목에 "(보강)" — 정규 보고서와 구분
        }}
        student={student ?? null}
        academyName={academyName}
        logoSrc={logoSrc}
        settings={rpt}
        attachments={attachmentImgs}
        trend={trend}
      />
    </div>
  );
}
