import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canAccessTenant } from "@/lib/auth/perm-matrix";
import { getTeacherScope } from "@/lib/auth/teacher-scope";
import { createClient } from "@/lib/supabase/server";
import { resolveBrandingSrc, resolveTenantReadUrls } from "@/lib/storage/media-storage";
import { getTenantSettings } from "@/features/owner/server/queries";
import { ParentReportCard } from "@/features/onescreen/components/parent-report-card";
import { PrintActions } from "@/app/(print)/enrollment/[id]/print/print-actions";

export const metadata = { title: "수업 보고서 — eywa" };

/**
 * 수업 보고서(lesson_reports) 강사 PDF 미리보기 — 원스크린 "PDF" 버튼이 여는 인쇄 문서.
 * ⚠️ 렌더는 학부모 공개 링크(/r/[token])·ClassNote 게시 이미지와 **동일한 `ParentReportCard`**를 쓴다
 * (강사 미리보기 = 실제 발송물 디자인). 차이는 (1) 인증 라우트(조회 로그 없음 → 열람수 오염 없음)
 * (2) PrintActions(인쇄/닫기). 데이터·표시 토글(settings.report)은 /r과 같은 소스.
 *
 * 접근(교재요청서 print 패턴): 로그인 + **students 메뉴 접근**(none=student 등 차단, override 반영) +
 * **강사는 본인 담당 학생 보고서만**(getTeacherScope — intra-tenant PII 스코프).
 */
export default async function LessonReportPrintPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) notFound();
  // 학생 정보(이름·학교·진도·강사 코멘트)가 담긴 문서 — students 접근 none 역할(학생 계정 등)은 차단.
  if (!(await canAccessTenant(user.systemRole, "students"))) notFound();
  const { id } = await params;
  // 플로팅 창(iframe)이면 proxy가 x-embed 주입 → 닫기 버튼 숨김(창 X로 닫음).
  const embedded = (await headers()).get("x-embed") === "1";

  const supabase = await createClient();
  // RLS가 테넌트 격리 — 같은 테넌트 보고서만 조회된다.
  const { data: report } = await supabase
    .from("lesson_reports")
    .select(
      "id, student_id, report_date, textbook, progress, exam_info, homework_score, teacher_name, notes, daily_test, check_test, attitude, attachments",
    )
    .eq("id", id)
    .single();
  if (!report) notFound();
  // 강사는 본인 담당 학생 보고서만(비담당 학생 PII 차단). 사무실 역할은 전체 허용.
  if (user.systemRole === "teacher") {
    const { studentIds } = await getTeacherScope(user.id);
    if (!report.student_id || !studentIds.includes(report.student_id)) notFound();
  }

  const [{ data: student }, settings] = await Promise.all([
    supabase.from("students").select("name, school, grade").eq("id", report.student_id).single(),
    getTenantSettings(),
  ]);

  const academyName = settings.profile.name || "인재원";
  const rpt = settings.report; // 보고서 표시 설정(학원 운영 > 보고서 탭) — /r과 동일 소스
  // 로고 해석은 GCS signed URL 등 외부 의존 — 실패해도 문서는 로고 없이 렌더.
  const logoSrc = settings.profile.logoUrl
    ? await resolveBrandingSrc(settings.profile.logoUrl, user.tenantId).catch(() => null)
    : null;

  // 학생 사진 첨부(P2b) — path별 signed URL(실패 생략). 표시 토글 off면 해석도 건너뜀.
  const attachments = (report.attachments as { path: string; name: string }[] | null) ?? [];
  const attachmentUrls: Record<string, string> =
    rpt.showAttachments && attachments.length
      ? await resolveTenantReadUrls(
          attachments.map((a) => a.path),
          "report_attachment",
          user.tenantId,
        ).catch(() => ({}))
      : {};
  const attachmentImgs = attachments
    .map((a) => ({ ...a, url: attachmentUrls[a.path] }))
    .filter((a): a is { path: string; name: string; url: string } => !!a.url);

  return (
    // ⚠️ (print) 레이아웃은 bg-white(공문서 기본)라 여기서 bg-bg-soft로 덮어 /r(share 레이아웃)·ClassNote
    // 스샷과 같은 크림 배경 위에 카드가 앉게 한다(디자인 동일). 종이 인쇄는 print:bg-white(잉크 절약).
    <div className="bg-bg-soft text-foreground flex min-h-screen flex-col items-center px-4 py-6 print:bg-white print:py-0">
      <div className="w-full max-w-md">
        <PrintActions embedded={embedded} />
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
            attitude: report.attitude,
            notes: report.notes,
          }}
          student={student ?? null}
          academyName={academyName}
          logoSrc={logoSrc}
          settings={rpt}
          attachments={attachmentImgs}
        />
      </div>
    </div>
  );
}
