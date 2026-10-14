import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canAccessTenant } from "@/lib/auth/perm-matrix";
import { canViewStudentDetail } from "@/features/students/server/read-scope";
import { createClient } from "@/lib/supabase/server";
import { resolveBrandingSrc, resolveTenantReadUrls } from "@/lib/storage/media-storage";
import { getTenantSettings } from "@/features/owner/server/queries";
import { fetchReportTrendRows, fetchSpecialClassIds } from "@/features/onescreen/server/score-history";
import { resolveReportAuthorSettings } from "@/features/onescreen/server/report-author-name";
import { formatReportAuthorName } from "@/features/onescreen/report-author-name";
import { buildTrendPoints } from "@/features/onescreen/report-trend";
import { ParentReportCard } from "@/features/onescreen/components/parent-report-card";
import { reportVideoHomework } from "@/features/onescreen/server/report-video-homework";
import { classKindMeta } from "@/features/classes/list-filters";
import { loadReportJjSnapshot } from "@/features/ijw/server/report-snapshot";
import { PrintActions } from "@/app/(print)/enrollment/[id]/print/print-actions";
import { NEUTRAL_ACADEMY_NAME } from "@/features/owner/defaults";

export const metadata = { title: "수업 보고서 — 에이와" };

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
      "id, student_id, class_id, subject, report_date, textbook, progress, exam_info, homework_score, homework_today, teacher_name, notes, trend_note, daily_test, check_test, attitude, attachments, makeup",
    )
    .eq("id", id)
    .single();
  if (!report) notFound();
  // 강사는 본인 담당 학생 보고서만(비담당 학생 PII 차단). 사무실 역할은 전체 허용.
  // 🔴 판정은 **원생 상세와 같은 함수**(`canViewStudentDetail` — 담임 ∪ 교시 담당 ∪ 임시 위임, 종료 60일 이내)다
  //    (2026-09-18, 원생 상세 '진도' 탭에 이 문서 바로가기를 달면서). 종전 `getTeacherScope`는 **담임 반·재원 중**만
  //    봐서, 진도 탭에서 그 보고서가 보이는 교시 담당 강사(영어는 대부분)가 바로가기를 누르면 404였다([[#77]] —
  //    한 레코드의 표면은 같은 게이트를 지나야 한다). 새 판정은 종전의 **상위 집합**이라 막히던 사람만 풀린다.
  //    ⚠️ 학생이 빈 보고서는 종전 규칙 그대로(강사만 막는다) — 사무실 화면의 동작을 바꾸지 않는다.
  if (
    report.student_id
      ? !(await canViewStudentDetail(report.student_id))
      : user.systemRole === "teacher"
  )
    notFound();

  const [{ data: student }, settings, trendRows, sendName, jj, reportClass, videoHomework] = await Promise.all([
    supabase.from("students").select("name, school, grade").eq("id", report.student_id).single(),
    getTenantSettings(),
    // 성적 추이 이력 — RLS 클라이언트라 테넌트 격리 자동(tenantId 불요). 실패해도 문서 안 깨짐.
    // 정규/특강 분리(2026-07-23) — 그래프도 추세 문장과 같은 표본을 봐야 한다. RLS 클라이언트라 tenant 자동.
    fetchSpecialClassIds(supabase)
      .then((specialClassIds) =>
        fetchReportTrendRows(
          supabase,
          report.student_id as string,
          report.subject as string | null,
          report.report_date as string,
          { classId: report.class_id as string | null, specialClassIds },
        ),
      )
      .catch(() => []),
    // 발송용 이름(0217a) — /r·ClassNote 이미지와 같은 표기(강사 미리보기 = 실제 발송물). fail-soft.
    resolveReportAuthorSettings(user.tenantId, report.teacher_name as string | null),
    // 영어 보고서의 인재원 그림 재료(0261a) — /r과 같은 저장본을 **따로** 읽는다(SELECT 불변, #95). 실패 = 그림 자리만 빈다.
    report.subject === "english" ? loadReportJjSnapshot(user.tenantId, report.id as string) : Promise.resolve(null),
    // 제목 "[특강]"(원장 2026-09-30) — /r과 같은 판정(수업목록 '구분'). RLS 클라이언트라 tenant 자동.
    report.class_id
      ? supabase
          .from("classes")
          .select("is_special, class_name")
          .eq("id", report.class_id as string)
          .maybeSingle()
          .then(({ data }) => data, () => null)
      : Promise.resolve(null),
    reportVideoHomework(supabase, user.tenantId, report.id as string),
  ]);
  const trend = buildTrendPoints(trendRows, report.id as string);

  const academyName = settings.profile.name || NEUTRAL_ACADEMY_NAME;
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
            teacherName: formatReportAuthorName(report.teacher_name, sendName, reportClass?.class_name),
            textbook: report.textbook,
            progress: report.progress,
            dailyTest: report.daily_test,
            checkTest: report.check_test,
            examInfo: report.exam_info,
            homeworkScore: report.homework_score,
            homeworkToday: report.homework_today,
            videoHomework,
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
          // 영어 = 템플릿 모드 — /r과 같은 판정(강사 미리보기 = 실제 발송물). subject는 이미 SELECT에 있다(#95).
          templateMode={report.subject === "english"}
          jj={jj}
        />
      </div>
    </div>
  );
}
