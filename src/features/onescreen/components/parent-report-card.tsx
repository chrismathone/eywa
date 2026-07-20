import type { ReactNode } from "react";
import type { ReportSettings } from "@/features/owner/settings-types";
import { EyIcon } from "@/components/icons/eywa-icons";
import { hasTrend, type TrendPoint } from "../report-trend";
import { isImageAttachment } from "../attachment-utils";
import { ReportTrendGraph } from "./report-trend-graph";

// 학부모 수업 보고서 카드 — 공유 서버 컴포넌트(순수 프레젠테이션, 데이터는 props로만).
// /r/[token](공개 학부모 링크·ClassNote 워커 스샷 대상)과 /lesson_reports/[id]/print(강사 PDF 미리보기)가
// **같은 컴포넌트**를 렌더 → 발송물·미리보기 디자인 불일치를 구조적으로 제거.
// ⚠️ .max-w-md 컬럼을 반환(ClassNote 워커가 `.max-w-md`를 스크린샷). 바깥 래퍼는 각 호스트가 제공.

/** 라벨/값 한 줄 — 좌측 라벨 + 우측 값(모바일 친화). 값의 줄바꿈(진도 "1.…\n2.…") 보존. */
function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-line flex items-start justify-between gap-3 border-b py-3 last:border-b-0">
      <span className="text-text-faint shrink-0 text-[15px]">{label}</span>
      <span className="text-foreground text-right text-[15px] font-bold whitespace-pre-line">
        {value.replace(/\r\n?/g, "\n")}
      </span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="bg-card border-line shadow-card rounded-2xl border px-5 py-4">
      {/* 섹션 제목: 13px→26px(2배)·faint→dim(더 진한 회색) — 2026-07-10 원장 요청. */}
      <h2 className="text-text-dim mb-3 text-[26px] font-bold">{title}</h2>
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
    attitude: string | null;
    notes: string | null;
    trendNote: string | null; // 학습 추세(종합분석) — 0091a(showTrendNote 토글)
  };
  student: { name: string | null; school: string | null; grade: string | null } | null;
  academyName: string;
  logoSrc: string | null; // 이미 해석된 로고 URL(없으면 null)
  settings: ReportSettings; // 학원 운영 > 보고서 표시 토글
  attachments: { path: string; name: string; url: string }[]; // 이미 signed URL 해석된 첨부(실패분 제외)
  trend?: TrendPoint[]; // 성적 추이 그래프 점(fetchReportTrendRows→buildTrendPoints). 없으면 그래프 미표시.
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
}: ParentReportCardProps) {
  // "2026년 07월 10일" — 제목에 합쳐 쓰므로 0패딩 고정 포맷(원장 요청 표기). YYYY-MM-DD 문자열 분해라 TZ 무관.
  const [ry, rm, rd] = (report.reportDate ?? "").split("-");
  const reportDate = ry && rm && rd ? `${ry}년 ${rm}월 ${rd}일` : "";
  const schoolGrade = fmtSchoolGrade(student?.school, student?.grade);
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
    (rpt.showHomeworkToday && report.homeworkToday);
  const showEval =
    report.dailyTest ||
    report.checkTest ||
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
        {/* 제목에 보고일 합체("2026년 07월 10일 수업 보고서") — 별도 보고일 필드 제거(2026-07-10 원장 요청). */}
        <h1 className="text-foreground text-2xl font-bold tracking-[0.05em]">
          {[reportDate, rpt.title || "수업 보고서"].filter(Boolean).join(" ")}
        </h1>
      </header>

      <Section title="학생 정보">
        <Field label="이름" value={student?.name || "-"} />
        <Field label="학교 · 학년" value={schoolGrade} />
        <Field label="담임" value={report.teacherName || "-"} />
      </Section>

      {showToday ? (
        <Section title="오늘 수업">
          {rpt.showTextbook && report.textbook ? <Field label="교재" value={report.textbook} /> : null}
          {rpt.showProgress && report.progress ? <Field label="진도" value={report.progress} /> : null}
          {rpt.showHomeworkToday && report.homeworkToday ? (
            <Field label="오늘 과제" value={report.homeworkToday} />
          ) : null}
        </Section>
      ) : null}

      {/* 평가 — 시험점수(일일/확인/레거시 합본)·지난 과제(수행 상태)·수업 태도(2026-07-10 원장 요청 분리). */}
      {showEval ? (
        <Section title="평가">
          {report.dailyTest ? <Field label="일일테스트" value={report.dailyTest} /> : null}
          {report.checkTest ? <Field label="확인테스트" value={report.checkTest} /> : null}
          {legacyTest ? <Field label="시험점수" value={legacyTest} /> : null}
          {rpt.showHomework && report.homeworkScore ? (
            <Field label="지난 과제" value={report.homeworkScore} />
          ) : null}
          {rpt.showAttitude && report.attitude ? <Field label="수업 태도" value={report.attitude} /> : null}
        </Section>
      ) : null}

      {/* 학습 추이 그래프(시험·과제, 순수 SVG) — 지표별 유효점 2개 이상일 때만(위 showTrendGraph에서 판정).
          위치: '학부모 전달 내용' 위(2026-07-10 원장 요청 — 숫자 추이를 먼저, 서술은 아래).
          제목 "성적 추이"→"학습 추이"(2026-07-10 원장 요청, 라벨만). */}
      {showTrendGraph ? (
        <Section title="학습 추이">
          <ReportTrendGraph points={trend!} />
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

      {/* 학생 사진·파일 첨부 — .max-w-md 안이라 ClassNote 워커 스크린샷에도 포함. 학원 설정 토글로 on/off.
          이미지=인라인 / 문서·오디오=다운로드 링크(학부모가 /r 링크로 열어 받음. 스샷 안에선 링크가 클릭 불가). */}
      {rpt.showAttachments && attachments.length ? (
        <Section title="첨부">
          {attachments.some((a) => isImageAttachment(a.name || a.path)) ? (
            <div className="mb-2 grid grid-cols-2 gap-2">
              {attachments
                .filter((a) => isImageAttachment(a.name || a.path))
                .map((a) => (
                  // eslint-disable-next-line @next/next/no-img-element -- 공개/인쇄 페이지 첨부(signed URL, 최적화 불필요)
                  <img key={a.path} src={a.url} alt={a.name} className="max-h-72 w-full rounded-md object-contain" />
                ))}
            </div>
          ) : null}
          {attachments.some((a) => !isImageAttachment(a.name || a.path)) ? (
            <div className="space-y-1.5">
              {attachments
                .filter((a) => !isImageAttachment(a.name || a.path))
                .map((a) => (
                  <a
                    key={a.path}
                    href={a.url}
                    target="_blank"
                    rel="noreferrer"
                    download={a.name}
                    className="border-line bg-bg-soft hover:bg-line/30 flex items-center gap-2 rounded-md border px-3 py-2.5 no-underline"
                  >
                    <EyIcon name="fileDownload" size={20} className="text-primary shrink-0" />
                    <span className="text-foreground min-w-0 flex-1 truncate text-[14px] font-medium">{a.name}</span>
                    <span className="text-text-faint shrink-0 text-[11px]">받기</span>
                  </a>
                ))}
            </div>
          ) : null}
        </Section>
      ) : null}

      {rpt.showFooter ? (
        <footer className="text-text-faint mt-2 pb-4 text-center text-[12px]">
          {rpt.footerNote || [academyName, reportDate].filter(Boolean).join(" · ")}
        </footer>
      ) : null}
    </div>
  );
}
