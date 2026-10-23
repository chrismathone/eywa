import type { ReactNode } from "react";
import type { ReportSettings } from "@/features/owner/settings-types";
import type { JjReportSnapshot } from "@/features/ijw/snapshot";
import { parentStudentName } from "@/features/report-templates/student-name";
import { hasTrend, type TrendPoint } from "../report-trend";
import { isImageAttachment, pickInlineAttachments } from "../attachment-utils";
import { isSkipStatusProgress } from "../progress-status";
import { collapseProgressRanges } from "../progress-range";
import { reportTitleText } from "../report-title";
import { videoHomeworkDueLabel } from "../video-homework-label";
import { parsePilotNotes } from "../pilot-notes";
import { PilotNotesBody } from "./pilot-notes-body";
import { ReportTrendGraph } from "./report-trend-graph";
import { EMPTY_NOTES, FileLink, TemplateBody, type CardAttachment } from "./report-template-body";

// 학부모 수업 보고서 카드 — 공유 서버 컴포넌트(순수 프레젠테이션, 데이터는 props로만).
// /r/[token](공개 학부모 링크·ClassNote 워커 스샷 대상)과 /lesson_reports/[id]/print(강사 PDF 미리보기)가
// **같은 컴포넌트**를 렌더 → 발송물·미리보기 디자인 불일치를 구조적으로 제거.
// ⚠️ .max-w-md 컬럼을 반환(ClassNote 워커가 `.max-w-md`를 스크린샷). 바깥 래퍼는 각 호스트가 제공.
// 영어(템플릿 모드) 본문은 report-template-body.tsx — 그림 자리·첨부 자리 규칙도 거기 있다.

/** 라벨/값 한 줄 — 좌측 라벨 + 우측 값(모바일 친화). 값의 줄바꿈(진도 "1.…\n2.…") 보존. */
function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-line flex items-start justify-between gap-3 border-b py-3 last:border-b-0">
      <span className="text-text-faint shrink-0 text-base">{label}</span>
      <span className="text-foreground text-right text-base font-bold whitespace-pre-line">
        {value.replace(/\r\n?/g, "\n")}
      </span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="bg-card border-line shadow-card rounded-2xl border px-5 py-4">
      {/* 섹션 제목: 13px→26px(2배)·faint→dim(더 진한 회색) — 2026-07-10 원장 요청. */}
      <h2 className="text-text-dim mb-3 text-3xl font-bold">{title}</h2>
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
    homeworkToday: string | null; // 오늘 과제(숙제 내용) — 0096a(showHomeworkToday 토글)
    videoHomework?: boolean | null;
    /** 영상 숙제 마감(저장값 — '다음 수업' 날짜, video-homework/due.ts). 없으면 수업일 + 7일. */
    videoHomeworkDue?: string | null;
    /** '다음 수업'을 골랐다(저장 전 미리보기 — 날짜를 아직 모른다). 안 주면 저장값으로 가른다. */
    videoHomeworkNext?: boolean;
    attitude: string | null;
    notes: string | null;
    trendNote: string | null; // 학습 추세(종합분석) — 0091a(showTrendNote 토글)
    makeup?: boolean; // 보강(수업외 추가수업) — 제목에 "(보강)" 표시해 정규 보고서와 구분(2026-07-24 원장).
    /**
     * 이 보고서가 **반에 속하는가**(class_id IS NOT NULL). 보강 표시와 함께 "(보강)"과 "(정규+보강)"을
     * 가른다 — 판정 규칙·근거는 [makeup-label.ts](../makeup-label.ts). 넘기지 않으면 "(보강)"로 본다.
     */
    hasClass?: boolean;
    /** 특강 반 보고서 — 제목 앞에 "[특강]"(원장 2026-09-30, report-title.ts). 판정은 호출부가 `classKindMeta`로. */
    special?: boolean;
    /** 과목 이름 — 제목 "수학 보고서"(원장 2026-10-16 · `subjectReportLabel`로 학원 설정에서 푼 값). 없으면 기본 제목. */
    subjectLabel?: string | null;
  };
  student: { name: string | null; school: string | null; grade: string | null } | null;
  academyName: string;
  logoSrc: string | null; // 이미 해석된 로고 URL(없으면 null)
  settings: ReportSettings; // 학원 운영 > 보고서 표시 토글
  attachments: CardAttachment[]; // 이미 signed URL 해석된 첨부(실패분 제외)
  trend?: TrendPoint[]; // 성적 추이 그래프 점(fetchReportTrendRows→buildTrendPoints). 없으면 그래프 미표시.
  /**
   * 템플릿 모드(영어) — `notes`가 템플릿으로 조립된 글 그 자체라 항목 칸 대신 그 글을 본문으로 그린다.
   * 호스트가 `subject === "english"`로 켠다(/r·인쇄·원스크린 미리보기). 기본 false = 수학 카드 그대로.
   */
  templateMode?: boolean;
  /**
   * 영어 보고서의 인재원 동결본(0261a) — 템플릿 글의 그림 자리 줄에 그린다. 호스트가 따로 읽어 넘긴다
   * (/r·인쇄 = 보고서에 묶인 저장본, 원스크린 미리보기 = 화면이 받아 둔 하루치). 없으면 그림 자리를 비운다.
   */
  jj?: JjReportSnapshot | null;
};

/** 학부모 보고서 카드(max-w-md 컬럼) — /r·/print 공용. 표시 항목은 전부 settings 토글 준수. */
export function ParentReportCard({
  report,
  student,
  academyName,
  logoSrc,
  settings: rpt,
  attachments,
  trend,
  templateMode = false,
  jj = null,
}: ParentReportCardProps) {
  // "2026년 07월 10일" — 제목에 합쳐 쓰므로 0패딩 고정 포맷(원장 요청 표기). YYYY-MM-DD 문자열 분해라 TZ 무관.
  const [ry, rm, rd] = (report.reportDate ?? "").split("-");
  const reportDate = ry && rm && rd ? `${ry}년 ${rm}월 ${rd}일` : "";
  const parentStudent = student ? { ...student, name: parentStudentName(student.name ?? "") } : null;
  const schoolGrade = fmtSchoolGrade(student?.school, student?.grade);
  const videoDue = videoHomeworkDueLabel(report.reportDate, report.videoHomework, report.videoHomeworkDue, report.videoHomeworkNext);
  // 성적 추이 그래프 표시 여부 — 토글 ON + 시험 또는 과제 중 하나라도 유효점 2개 이상(빈 카드 방지).
  const showTrendGraph =
    rpt.showTrendGraph && !!trend && (hasTrend(trend, "exam") || hasTrend(trend, "homework"));

  // 시험점수 표시 = **데이터 기준**(showDailyTest/showCheckTest 토글로 소급 숨기지 않음). 이미 값이 있는
  // (=발송된) 보고서는 학원설정에서 테스트를 꺼도 그대로 보여야 한다(발송분 예외). 새 보고서는 토글이
  // 꺼지면 원스크린 입력칸이 사라져 값이 안 생기므로 자연히 미표시 → 결과적으로 "새 보고서만 숨김".
  // 레거시(edutrix 임포트): 일일/확인 분리값 없이 exam_info 합본만 있으면 "시험점수" 한 줄로 폴백.
  const legacyTest = !report.dailyTest && !report.checkTest ? report.examInfo : null;
  // 섹션 2분할(2026-07-10 원장): '오늘 수업'=교재·진도·오늘 과제 / '평가'=시험점수·지난 과제·수업 태도.
  const showToday =
    (rpt.showTextbook && report.textbook) ||
    (rpt.showProgress && report.progress) ||
    (rpt.showHomeworkToday && report.homeworkToday) || videoDue;
  const showEval =
    report.dailyTest ||
    report.checkTest ||
    legacyTest ||
    (rpt.showHomework && report.homeworkScore) ||
    (rpt.showAttitude && report.attitude);
  // 영어 글 속 첨부 자리(`[첨부: 이름]`) — 그 자리에 그린 첨부는 아래 '첨부' 칸에서 뺀다(같은 사진이 두 번 나가지 않게).
  // 🔑 학원설정이 첨부 표시를 끄면 글 속 자리도 비운다(아래 칸과 같은 토글 — 미리보기가 발송물과 갈리지 않게).
  const inline: ReadonlyMap<string, CardAttachment> =
    templateMode && rpt.showAttachments ? pickInlineAttachments(report.notes, attachments) : new Map();
  const inlinePaths = new Set([...inline.values()].map((a) => a.path));
  const restAttachments = inlinePaths.size ? attachments.filter((a) => !inlinePaths.has(a.path)) : attachments;
  // 항목별 글(`■ 제목` — 수학 보고서 시범)이면 표·항목 블록으로 그린다(원장 2026-10-23 시안 B). 아니면 예전처럼 글 그대로.
  const pilotSections = templateMode ? null : parsePilotNotes(report.notes);

  return (
    // ⚠️ report-capture = ClassNote 워커 스크린샷 대상 클래스(classnote-core.mjs가 이 선택자로 캡처).
    // max-w-lg로 넓혀 ClassNote·학부모·PDF에서 큼직하게 보이도록(사용자 요청). 폭 변경 시 워커 선택자 동기 필수.
    <div className="report-capture flex w-full max-w-lg flex-col gap-4">
      <header className="flex flex-col items-center gap-2.5 pt-2 pb-1 text-center">
        {rpt.showLogo && logoSrc ? (
          // eslint-disable-next-line @next/next/no-img-element -- 공개/인쇄 페이지 외부 로고(최적화 불필요)
          <img src={logoSrc} alt={academyName} className="h-14 w-auto object-contain" />
        ) : null}
        {rpt.showAcademyName ? <p className="text-text-dim text-base">{academyName}</p> : null}
        {/* 제목에 보고일 합체("2026년 07월 10일 수업 보고서") — 별도 보고일 필드 제거(2026-07-10 원장 요청).
            보강이면 접미사를 덧붙여 같은 날 정규 보고서와 학부모가 구분(2026-07-24 원장).
            정규 수업까지 한 날의 보강은 "(정규+보강)"으로 합쳐 **한 번만** 나간다(2026-08-05 원장, makeup-label.ts). */}
        <h1 className="text-foreground text-2xl font-bold tracking-[0.05em]">
          {[reportDate, reportTitleText(rpt.title, report)].filter(Boolean).join(" ")}
        </h1>
      </header>

      <Section title="학생 정보">
        <Field label="이름" value={parentStudent?.name || "-"} />
        <Field label="학교 · 학년" value={schoolGrade} />
        <Field label="담임" value={report.teacherName || "-"} />
      </Section>

      {/* 템플릿 모드(영어) — 조립된 글이 곧 본문이다. 아래 '오늘 수업'·'평가'·학습 추이·'학부모 전달 내용'·
          학습 추세는 **전부 건너뛴다**: 같이 그리면 같은 진도·숙제가 글 안과 칸에 두 번 나간다.
          🔴 'showParentNote' 토글을 보지 않는다 — 수학에선 여러 칸 중 하나지만 여기선 글이 곧 보고서라,
             끄면 학생 정보만 남은 빈 카드가 학부모에게 나간다. 머리·학생 정보·첨부·바닥글은 수학과 같다. */}
      {templateMode ? <TemplateBody text={report.notes} jj={jj} inline={inline} student={parentStudent} /> : null}
      {templateMode && videoDue ? <section className="bg-card border-line rounded-2xl border px-5"><Field label="영상 숙제" value={videoDue} /></section> : null}

      {!templateMode && showToday ? (
        <Section title="오늘 수업">
          {rpt.showTextbook && report.textbook ? <Field label="교재" value={report.textbook} /> : null}
          {/* 진도가 중단된 날(시험 등)은 나간 차시가 없다 — '진도' 라벨로 내보내면 학부모에게 거짓이라 라벨만 바꾼다.
              다중 차시는 **같은 중단원 안에서 연속인 것만** 물결 범위로 접어 보여준다(원장 2026-08-05 — 9차시를
              나간 날 카드가 9줄로 부풀었다). 접기는 표시 전용 = 저장값은 차시 그대로다(progress-range.ts). */}
          {rpt.showProgress && report.progress ? (
            <Field
              label={isSkipStatusProgress(report.progress) ? "수업" : "진도"}
              value={collapseProgressRanges(report.progress)}
            />
          ) : null}
          {rpt.showHomeworkToday && report.homeworkToday ? (
            <Field label="오늘 과제" value={report.homeworkToday} />
          ) : null}
          {videoDue ? <Field label="영상 숙제" value={videoDue} /> : null}
        </Section>
      ) : null}

      {/* 평가 — 시험점수(일일/확인/레거시 합본)·지난 과제(수행 상태)·수업 태도(2026-07-10 원장 요청 분리). */}
      {!templateMode && showEval ? (
        <Section title="평가">
          {report.dailyTest ? <Field label="일일테스트" value={report.dailyTest} /> : null}
          {report.checkTest ? <Field label="확인테스트" value={report.checkTest} /> : null}
          {legacyTest ? <Field label="시험점수" value={legacyTest} /> : null}
          {/* 값이 퍼센트(90%)라 라벨도 '수행률' — "지난 과제 90%"만 있으면 점수로 읽힌다(2026-08-03 사고). */}
          {rpt.showHomework && report.homeworkScore ? (
            <Field label="지난 과제 수행률" value={report.homeworkScore} />
          ) : null}
          {rpt.showAttitude && report.attitude ? <Field label="수업 태도" value={report.attitude} /> : null}
        </Section>
      ) : null}

      {/* 학습 추이 그래프(시험·과제, 순수 SVG) — 지표별 유효점 2개 이상일 때만(위 showTrendGraph에서 판정).
          위치: '학부모 전달 내용' 위(2026-07-10 원장 요청 — 숫자 추이를 먼저, 서술은 아래).
          제목 "성적 추이"→"학습 추이"(2026-07-10 원장 요청, 라벨만). */}
      {!templateMode && showTrendGraph ? (
        <Section title="학습 추이">
          <ReportTrendGraph points={trend!} />
        </Section>
      ) : null}

      {!templateMode && rpt.showParentNote ? (
        <Section title="학부모 전달 내용">
          {pilotSections ? (
            <PilotNotesBody sections={pilotSections} />
          ) : (
            <p className="text-foreground text-base leading-relaxed whitespace-pre-wrap">
              {report.notes || EMPTY_NOTES}
            </p>
          )}
        </Section>
      ) : null}

      {/* 학습 추세(종합분석) — 0091a. 내용 있을 때만 노출(빈 회차엔 섹션 자체를 숨김). */}
      {!templateMode && rpt.showTrendNote && report.trendNote ? (
        <Section title="학습 추세">
          <p className="text-foreground text-base leading-relaxed whitespace-pre-wrap">{report.trendNote}</p>
        </Section>
      ) : null}

      {/* 학생 사진·파일 첨부 — .max-w-md 안이라 ClassNote 워커 스크린샷에도 포함. 학원 설정 토글로 on/off.
          이미지=인라인 / 문서·오디오=다운로드 링크(학부모가 /r 링크로 열어 받음. 스샷 안에선 링크가 클릭 불가).
          영어 글 속 자리에 이미 그린 첨부는 여기서 뺀다(위 restAttachments). */}
      {rpt.showAttachments && restAttachments.length ? (
        <Section title="첨부">
          {restAttachments.some((a) => isImageAttachment(a.name || a.path)) ? (
            // 이미지는 1열로 **크게** 세로 쌓기 — 스샷 1장에 보고서 본문 → 교재가 세로로 완결되게(2026-07-22 원장 방향).
            // ClassNote가 attached_images를 가로로 나열해 세로가 안 되는 문제를 스샷 내 세로 배치로 우회.
            <div className="mb-2 space-y-2">
              {restAttachments
                .filter((a) => isImageAttachment(a.name || a.path))
                .map((a) => (
                  // eslint-disable-next-line @next/next/no-img-element -- 공개/인쇄 페이지 첨부(signed URL, 최적화 불필요)
                  <img key={a.path} src={a.url} alt={a.name} className="w-full rounded-md object-contain" />
                ))}
            </div>
          ) : null}
          {restAttachments.some((a) => !isImageAttachment(a.name || a.path)) ? (
            <div className="space-y-1.5">
              {restAttachments
                .filter((a) => !isImageAttachment(a.name || a.path))
                .map((a) => (
                  <FileLink key={a.path} att={a} />
                ))}
            </div>
          ) : null}
        </Section>
      ) : null}

      {rpt.showFooter ? (
        <footer className="text-text-faint mt-2 pb-4 text-center text-xs">
          {rpt.footerNote || [academyName, reportDate].filter(Boolean).join(" · ")}
        </footer>
      ) : null}
    </div>
  );
}
