import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTenantSettingsByTenantId } from "@/features/owner/server/queries";
import { resolveBrandingSrc } from "@/lib/storage/media-storage";

// 학생 PII 문서 — 검색엔진 색인 차단(링크 유출 시에도 인덱싱 방지).
export const metadata = { title: "수업 보고서", robots: { index: false, follow: false } };

/** 라벨/값 한 줄 — 좌측 라벨 + 우측 값(모바일 친화). 값의 줄바꿈(진도 "1.…\n2.…") 보존. */
function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-line flex items-start justify-between gap-3 border-b py-2.5 last:border-b-0">
      <span className="text-text-faint shrink-0 text-[13px]">{label}</span>
      <span className="text-foreground text-right text-[13px] font-semibold whitespace-pre-line">
        {value.replace(/\r\n?/g, "\n")}
      </span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="bg-card border-line shadow-card rounded-md border px-4 py-3">
      <h2 className="text-text-faint mb-2 text-[12px] font-semibold">{title}</h2>
      {children}
    </section>
  );
}

/** "달성초"(학교) + "초3"(학년) → "달성초3". 학교명 끝 글자(초/중/고)와 학년 앞 글자가 겹치면 중복 제거해 붙임. 불일치면 공백 조인. */
function fmtSchoolGrade(school?: string | null, grade?: string | null): string {
  if (!school) return grade || "-";
  if (!grade) return school;
  const lvl = school.slice(-1);
  if (["초", "중", "고"].includes(lvl) && grade.startsWith(lvl)) return `${school}${grade.slice(1)}`;
  return `${school} ${grade}`;
}

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
      "tenant_id, student_id, report_date, progress, exam_info, homework_score, teacher_name, notes, daily_test, check_test, attitude",
    )
    .eq("share_token", token)
    .maybeSingle();
  if (!report) notFound();

  const [{ data: student }, settings] = await Promise.all([
    admin.from("students").select("name, school, grade").eq("id", report.student_id).maybeSingle(),
    getTenantSettingsByTenantId(report.tenant_id as string),
  ]);

  const academyName = settings.profile.name || "인재원";
  const rpt = settings.report; // 보고서 표시 설정(학원 운영 > 보고서 탭): 로고/학원명/제목/필드 토글/바닥글
  // 로고 해석은 GCS signed URL 등 외부 의존 — 실패해도 페이지는 로고 없이 렌더(학부모 링크가 깨지지 않게).
  const logoSrc = settings.profile.logoUrl
    ? await resolveBrandingSrc(settings.profile.logoUrl, report.tenant_id as string).catch(() => null)
    : null;

  const reportDate = report.report_date
    ? new Date(`${report.report_date}T00:00:00`).toLocaleDateString("ko-KR", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : "-";
  const schoolGrade = fmtSchoolGrade(student?.school, student?.grade);

  // 레거시(edutrix 임포트): 일일/확인 분리값 없이 exam_info 합본만 있으면 "테스트" 한 줄로 폴백.
  const legacyTest =
    (rpt.showDailyTest || rpt.showCheckTest) && !report.daily_test && !report.check_test
      ? report.exam_info
      : null;
  const showToday =
    (rpt.showProgress && report.progress) ||
    (rpt.showDailyTest && report.daily_test) ||
    (rpt.showCheckTest && report.check_test) ||
    legacyTest ||
    (rpt.showHomework && report.homework_score) ||
    (rpt.showAttitude && report.attitude);

  return (
    // 뷰포트보다 짧으면 상하 중앙 정렬, 길면 자연 스크롤(min-h-screen + justify-center = 넘쳐도 클립 안 됨).
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-6">
      <div className="flex w-full max-w-md flex-col gap-3">
        <header className="flex flex-col items-center gap-2 pt-2 pb-1 text-center">
          {rpt.showLogo && logoSrc ? (
            // eslint-disable-next-line @next/next/no-img-element -- 공개 페이지 외부 로고(최적화 불필요)
            <img src={logoSrc} alt={academyName} className="h-10 w-auto object-contain" />
          ) : null}
          {rpt.showAcademyName ? <p className="text-text-dim text-[13px]">{academyName}</p> : null}
          <h1 className="text-foreground text-xl font-bold tracking-[0.1em]">{rpt.title || "수업 보고서"}</h1>
        </header>

        <Section title="학생 정보">
          <Field label="학생" value={student?.name || "-"} />
          <Field label="학교 · 학년" value={schoolGrade} />
          <Field label="보고일" value={reportDate} />
          <Field label="담당 강사" value={report.teacher_name || "-"} />
        </Section>

        {showToday ? (
          <Section title="오늘 수업">
            {rpt.showProgress && report.progress ? <Field label="진도" value={report.progress} /> : null}
            {rpt.showDailyTest && report.daily_test ? (
              <Field label="일일테스트" value={report.daily_test} />
            ) : null}
            {rpt.showCheckTest && report.check_test ? (
              <Field label="확인테스트" value={report.check_test} />
            ) : null}
            {legacyTest ? <Field label="테스트" value={legacyTest} /> : null}
            {rpt.showHomework && report.homework_score ? (
              <Field label="과제" value={report.homework_score} />
            ) : null}
            {rpt.showAttitude && report.attitude ? <Field label="수업 태도" value={report.attitude} /> : null}
          </Section>
        ) : null}

        {rpt.showParentNote ? (
          <Section title="학부모 전달 내용">
            <p className="text-foreground text-[14px] leading-relaxed whitespace-pre-wrap">
              {report.notes || "작성된 보고 내용이 없습니다."}
            </p>
          </Section>
        ) : null}

        {rpt.showFooter ? (
          <footer className="text-text-faint mt-2 pb-4 text-center text-[11px]">
            {rpt.footerNote || `${academyName} · ${reportDate}`}
          </footer>
        ) : null}
      </div>
    </div>
  );
}
