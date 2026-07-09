import type { ReactNode } from "react";
import type { ReportSettings } from "@/features/owner/settings-types";

// 학부모 수업 보고서 카드 — 공유 서버 컴포넌트(순수 프레젠테이션, 데이터는 props로만).
// /r/[token](공개 학부모 링크·ClassNote 워커 스샷 대상)과 /lesson_reports/[id]/print(강사 PDF 미리보기)가
// **같은 컴포넌트**를 렌더 → 발송물·미리보기 디자인 불일치를 구조적으로 제거.
// ⚠️ .max-w-md 컬럼을 반환(ClassNote 워커가 `.max-w-md`를 스크린샷). 바깥 래퍼는 각 호스트가 제공.

/** 라벨/값 한 줄 — 좌측 라벨 + 우측 값(모바일 친화). 값의 줄바꿈(진도 "1.…\n2.…") 보존. */
function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-line flex items-start justify-between gap-3 border-b py-3 last:border-b-0">
      <span className="text-text-faint shrink-0 text-[15px]">{label}</span>
      <span className="text-foreground text-right text-[15px] font-semibold whitespace-pre-line">
        {value.replace(/\r\n?/g, "\n")}
      </span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="bg-card border-line shadow-card rounded-lg border px-5 py-4">
      <h2 className="text-text-faint mb-2.5 text-[13px] font-semibold">{title}</h2>
      {children}
    </section>
  );
}

/** "달성초"(학교) + "초3"(학년) → "달성초3". 학교명 끝 글자(초/중/고)와 학년 앞 글자가 겹치면 중복 제거해 붙임. 불일치면 공백 조인. */
export function fmtSchoolGrade(school?: string | null, grade?: string | null): string {
  if (!school) return grade || "-";
  if (!grade) return school;
  const lvl = school.slice(-1);
  if (["초", "중", "고"].includes(lvl) && grade.startsWith(lvl)) return `${school}${grade.slice(1)}`;
  return `${school} ${grade}`;
}

export type ParentReportCardProps = {
  report: {
    reportDate: string | null; // YYYY-MM-DD (원시). 표시는 여기서 ko-KR 포맷.
    teacherName: string | null;
    textbook: string | null; // 교재명 — 0089a(showTextbook 토글)
    progress: string | null;
    dailyTest: string | null;
    checkTest: string | null;
    examInfo: string | null; // 레거시 합본(일일/확인 분리값 없을 때 폴백)
    homeworkScore: string | null;
    attitude: string | null;
    notes: string | null;
    trendNote: string | null; // 학습 추세(종합분석) — 0091a(showTrendNote 토글)
  };
  student: { name: string | null; school: string | null; grade: string | null } | null;
  academyName: string;
  logoSrc: string | null; // 이미 해석된 로고 URL(없으면 null)
  settings: ReportSettings; // 학원 운영 > 보고서 표시 토글
  attachments: { path: string; name: string; url: string }[]; // 이미 signed URL 해석된 첨부(실패분 제외)
};

/** 학부모 보고서 카드(max-w-md 컬럼) — /r·/print 공용. 표시 항목은 전부 settings 토글 준수. */
export function ParentReportCard({
  report,
  student,
  academyName,
  logoSrc,
  settings: rpt,
  attachments,
}: ParentReportCardProps) {
  const reportDate = report.reportDate
    ? new Date(`${report.reportDate}T00:00:00`).toLocaleDateString("ko-KR", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : "-";
  const schoolGrade = fmtSchoolGrade(student?.school, student?.grade);

  // 레거시(edutrix 임포트): 일일/확인 분리값 없이 exam_info 합본만 있으면 "테스트" 한 줄로 폴백.
  const legacyTest =
    (rpt.showDailyTest || rpt.showCheckTest) && !report.dailyTest && !report.checkTest
      ? report.examInfo
      : null;
  const showToday =
    (rpt.showTextbook && report.textbook) ||
    (rpt.showProgress && report.progress) ||
    (rpt.showDailyTest && report.dailyTest) ||
    (rpt.showCheckTest && report.checkTest) ||
    legacyTest ||
    (rpt.showHomework && report.homeworkScore) ||
    (rpt.showAttitude && report.attitude);

  return (
    // ⚠️ report-capture = ClassNote 워커 스크린샷 대상 클래스(classnote-core.mjs가 이 선택자로 캡처).
    // max-w-lg로 넓혀 ClassNote·학부모·PDF에서 큼직하게 보이도록(사용자 요청). 폭 변경 시 워커 선택자 동기 필수.
    <div className="report-capture flex w-full max-w-lg flex-col gap-4">
      <header className="flex flex-col items-center gap-2.5 pt-2 pb-1 text-center">
        {rpt.showLogo && logoSrc ? (
          // eslint-disable-next-line @next/next/no-img-element -- 공개/인쇄 페이지 외부 로고(최적화 불필요)
          <img src={logoSrc} alt={academyName} className="h-14 w-auto object-contain" />
        ) : null}
        {rpt.showAcademyName ? <p className="text-text-dim text-[15px]">{academyName}</p> : null}
        <h1 className="text-foreground text-2xl font-bold tracking-[0.1em]">{rpt.title || "수업 보고서"}</h1>
      </header>

      <Section title="학생 정보">
        <Field label="학생" value={student?.name || "-"} />
        <Field label="학교 · 학년" value={schoolGrade} />
        <Field label="보고일" value={reportDate} />
        <Field label="담당 강사" value={report.teacherName || "-"} />
      </Section>

      {showToday ? (
        <Section title="오늘 수업">
          {rpt.showTextbook && report.textbook ? <Field label="교재" value={report.textbook} /> : null}
          {rpt.showProgress && report.progress ? <Field label="진도" value={report.progress} /> : null}
          {rpt.showDailyTest && report.dailyTest ? <Field label="일일테스트" value={report.dailyTest} /> : null}
          {rpt.showCheckTest && report.checkTest ? <Field label="확인테스트" value={report.checkTest} /> : null}
          {legacyTest ? <Field label="테스트" value={legacyTest} /> : null}
          {rpt.showHomework && report.homeworkScore ? (
            <Field label="과제" value={report.homeworkScore} />
          ) : null}
          {rpt.showAttitude && report.attitude ? <Field label="수업 태도" value={report.attitude} /> : null}
        </Section>
      ) : null}

      {rpt.showParentNote ? (
        <Section title="학부모 전달 내용">
          <p className="text-foreground text-[16px] leading-relaxed whitespace-pre-wrap">
            {report.notes || "작성된 보고 내용이 없습니다."}
          </p>
        </Section>
      ) : null}

      {/* 학습 추세(종합분석) — 0091a. 내용 있을 때만 노출(빈 회차엔 섹션 자체를 숨김). */}
      {rpt.showTrendNote && report.trendNote ? (
        <Section title="학습 추세">
          <p className="text-foreground text-[16px] leading-relaxed whitespace-pre-wrap">{report.trendNote}</p>
        </Section>
      ) : null}

      {/* 학생 사진 첨부(P2b) — .max-w-md 안이라 ClassNote 워커 스크린샷에도 포함. 학원 설정 토글로 on/off. */}
      {rpt.showAttachments && attachments.length ? (
        <Section title="첨부">
          <div className="grid grid-cols-2 gap-2">
            {attachments.map((a) => (
              // eslint-disable-next-line @next/next/no-img-element -- 공개/인쇄 페이지 첨부(signed URL, 최적화 불필요)
              <img key={a.path} src={a.url} alt={a.name} className="max-h-72 w-full rounded-md object-contain" />
            ))}
          </div>
        </Section>
      ) : null}

      {rpt.showFooter ? (
        <footer className="text-text-faint mt-2 pb-4 text-center text-[12px]">
          {rpt.footerNote || `${academyName} · ${reportDate}`}
        </footer>
      ) : null}
    </div>
  );
}
