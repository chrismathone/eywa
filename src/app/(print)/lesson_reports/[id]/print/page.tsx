import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canAccessTenant } from "@/lib/auth/perm-matrix";
import { getTeacherScope } from "@/lib/auth/teacher-scope";
import { createClient } from "@/lib/supabase/server";
import { resolveBrandingSrc } from "@/lib/storage/media-storage";
import { getTenantSettings } from "@/features/owner/server/queries";
import { PrintActions } from "@/app/(print)/enrollment/[id]/print/print-actions";

export const metadata = { title: "수업 보고서 — eywa" };

/** 라벨/값 한 줄(좌측 음영 라벨 + 우측 값). 모듈 레벨 선언(render 중 컴포넌트 생성 금지). */
function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex">
      <div className="w-28 shrink-0 border border-black/20 bg-black/[0.04] px-3 py-2 text-[12px] font-semibold">
        {label}
      </div>
      <div className="flex-1 border border-l-0 border-black/20 px-3 py-2 text-[12px]">{value}</div>
    </div>
  );
}

/**
 * 수업 보고서(lesson_reports) A4 인쇄 문서 — 강사 원스크린 "PDF" 버튼이 여는 플로팅 인쇄 창.
 * 접근(교재요청서 print 패턴, 2026-07-02 게이트 보강): 로그인 + **students 메뉴 접근**(none=student 등 차단,
 * override 반영) + **강사는 본인 담당 학생 보고서만**(getTeacherScope — intra-tenant PII 스코프).
 * 원스크린 메뉴키(teacher 전용, master=none)로는 원장 열람이 막혀 students 메뉴를 게이트로 쓴다.
 * 레퍼런스 = (print)/enrollment/[id]/print/page.tsx (print-portrait + PrintActions embedded).
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
    .select("id, student_id, report_date, progress, exam_info, homework_score, teacher_name, notes")
    .eq("id", id)
    .single();
  if (!report) notFound();
  // 강사는 본인 담당 학생 보고서만(비담당 학생 PII 차단). 사무실 역할은 전체 허용.
  if (user.systemRole === "teacher") {
    const { studentIds } = await getTeacherScope(user.id);
    if (!report.student_id || !studentIds.includes(report.student_id)) notFound();
  }

  const [{ data: student }, settings] = await Promise.all([
    supabase
      .from("students")
      .select("name, school, grade")
      .eq("id", report.student_id)
      .single(),
    getTenantSettings(),
  ]);

  const profile = settings.profile;
  const academyName = profile.name || "인재원";
  const printHeader = settings.notifications.printHeader || "eywa · 인재원 학원관리";
  // 학원 로고 — GCS 비공개 path면 signed URL로 resolve(외부 URL은 그대로).
  const logoSrc = await resolveBrandingSrc(profile.logoUrl, user.tenantId);

  const reportDate = report.report_date
    ? new Date(`${report.report_date}T00:00:00`).toLocaleDateString("ko-KR", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : "-";
  const schoolGrade = [student?.school, student?.grade].filter(Boolean).join(" ") || "-";

  return (
    <div className="print-portrait mx-auto max-w-[210mm] bg-white px-12 py-10 text-black print:p-0">
      <PrintActions embedded={embedded} />

      <header className="border-b-2 border-black/80 pb-4">
        {logoSrc ? (
          // eslint-disable-next-line @next/next/no-img-element -- 인쇄물 외부 이미지(최적화 불필요)
          <img src={logoSrc} alt={academyName} className="mb-3 h-12 w-auto object-contain" />
        ) : null}
        <div className="flex items-center justify-between">
          <p className="font-mono text-[11px] tracking-[0.25em] uppercase">{printHeader}</p>
          <p className="text-[12px] text-black/60">{academyName}</p>
        </div>
        <h1 className="mt-2 text-2xl font-black tracking-[0.2em]">수업 보고서</h1>
      </header>

      <section className="mt-6 space-y-px">
        <Field label="학생" value={student?.name || "-"} />
        <Field label="학교 · 학년" value={schoolGrade} />
        <Field label="보고일" value={reportDate} />
        <Field label="담당 강사" value={report.teacher_name || "-"} />
        {report.progress ? <Field label="오늘 진도" value={report.progress} /> : null}
        {report.exam_info ? <Field label="테스트" value={report.exam_info} /> : null}
        {report.homework_score ? <Field label="과제" value={report.homework_score} /> : null}
      </section>

      <section className="mt-6">
        <h2 className="mb-2 text-[13px] font-bold">학부모 보고 내용</h2>
        <div className="min-h-[160px] rounded-sm border border-black/20 px-4 py-3 text-[13px] leading-relaxed whitespace-pre-wrap">
          {report.notes || "작성된 보고 내용이 없습니다."}
        </div>
      </section>

      <footer className="mt-10 border-t border-black/20 pt-3 text-[10px] text-black/50">
        {academyName} · {reportDate} 발행
      </footer>
    </div>
  );
}
