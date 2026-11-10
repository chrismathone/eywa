import { buildReport } from "@/features/onescreen/report";
import { SUBJECT_SOLID, SUBJECT_TEXT, subjectColorOfRow, type SubjectMaps } from "@/features/owner/subjects";
import { Pill } from "@/components/atoms/pill";
import { DeltaChip } from "@/features/onescreen/components/delta-chip";
import { EyIcon } from "@/components/icons/aywa-icons";
import type { OneScreenStudent, TestScore } from "@/features/onescreen/types";
import { dateKo, pctOf, sessionToStudent, type Session } from "../history";

const TODAY = "2026년 6월 1일 (월)";

function perfTone(p: number): "primary" | "amber" | "danger" {
  return p >= 80 ? "primary" : p >= 60 ? "amber" : "danger";
}
const PERF_TEXT = { primary: "text-primary", amber: "text-amber", danger: "text-danger" } as const;
const PERF_BG = { primary: "bg-primary", amber: "bg-amber", danger: "bg-danger" } as const;

function TestBlock({ kicker, sub, test }: { kicker: string; sub: string; test: TestScore }) {
  const header = (
    <div className="flex items-center justify-between">
      <span className="text-foreground text-sm font-bold">{kicker}</span>
      <span className="text-text-faint text-xs">{sub}</span>
    </div>
  );
  if (test.score == null) {
    return (
      <div className="border-line rounded-md border px-3 py-2.5">
        {header}
        <p className="text-text-faint mt-1.5 text-xs">아직 점수가 입력되지 않았어요.</p>
      </div>
    );
  }
  const p = pctOf(test.score, test.max);
  const tone = perfTone(p);
  return (
    <div className="border-line rounded-md border px-3 py-2.5">
      {header}
      <div className="mt-1.5 flex items-baseline gap-1.5">
        <span className={`tabular text-2xl font-bold ${PERF_TEXT[tone]}`}>{test.score}</span>
        <span className="text-text-faint tabular text-sm">/ {test.max}</span>
        <DeltaChip score={test.score} prev={test.prevScore} />
        <span className="text-text-dim tabular ml-auto text-xs font-bold">{p}%</span>
      </div>
      <div className="bg-bg-soft mt-2 h-2 overflow-hidden rounded-pill">
        <div className={`h-full rounded-pill ${PERF_BG[tone]}`} style={{ width: `${p}%` }} />
      </div>
    </div>
  );
}

/** 학생 데일리 리포트 — 그날 진도·테스트·선생님 한마디(읽기 전용). */
/** @param subjectMaps 과목 색 = 학원설정(운영 enum 하드코딩 금지) — 서버 페이지가 buildSubjectMaps로 만들어 넘긴다. */
export function DailyReportView({ base, session, subjectMaps }: { base: OneScreenStudent; session: Session; subjectMaps: SubjectMaps }) {
  const view = sessionToStudent(base, session);
  const isLatest = session.date === "6/1";
  const isAbsent = view.attendance === "결석";
  const headDate = isLatest ? TODAY : `2026년 ${dateKo(session.date)}`;
  // 결석일은 정상 출석 보고서(buildReport: "테스트 결과를 받았습니다"…)를 만들면 배지(결석)와 모순.
  const note = isAbsent ? "" : view.reportSent ? buildReport(view) : "";

  return (
    <div className="space-y-4">
      {/* 헤더 (ink 다크) */}
      <header className="bg-ink text-background relative overflow-hidden rounded-2xl px-5 py-5">
        <span className="absolute top-4 right-4 rounded-full bg-white/15 px-2 py-0.5 text-xs font-bold">
          {view.attendance}
        </span>
        <p className="font-mono text-xs opacity-70">
          {headDate} · {isLatest ? "오늘" : "지난"} 데일리 리포트
        </p>
        <h1 className="mt-1 text-2xl font-bold">오늘의 학습 리포트</h1>
        <p className="mt-1 text-sm opacity-80">
          {base.name} · {base.grade} {base.tag}
        </p>
      </header>

      {/* 오늘 배운 내용 */}
      <section className="bg-card border-line shadow-card rounded-2xl border p-5">
        <h2 className="text-foreground text-base font-bold">오늘 배운 내용</h2>
        <div className="mt-3 space-y-2.5">
          {view.subjects.map((su, i) => {
            const tone = subjectColorOfRow(subjectMaps, su);
            return (
              <div key={i} className="flex items-start gap-3">
                <span className={`mt-0.5 h-9 w-1 rounded-pill ${SUBJECT_SOLID[tone]}`} aria-hidden />
                <div>
                  <p className={`text-sm font-bold ${SUBJECT_TEXT[tone]}`}>{su.name}</p>
                  <p className="mt-0.5 flex items-center gap-1.5 text-xs">
                    <span className="text-text-faint">{su.prev}</span>
                    <EyIcon name="arrowRight" size={13} className={SUBJECT_TEXT[tone]} />
                    <span className="text-foreground font-bold">{su.today}</span>
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* 오늘의 테스트 */}
      <section className="bg-card border-line shadow-card rounded-2xl border p-5">
        <h2 className="text-foreground text-base font-bold">오늘의 테스트</h2>
        {isAbsent ? (
          <p className="text-text-faint mt-2 text-sm">결석한 날이라 테스트를 진행하지 않았어요.</p>
        ) : (
          <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <TestBlock kicker="일일테스트" sub="이전 진도 복습" test={view.tests.daily} />
            <TestBlock kicker="확인테스트" sub="오늘 진도" test={view.tests.check} />
          </div>
        )}
      </section>

      {/* 선생님 한마디 */}
      <section className="bg-card border-line shadow-card rounded-2xl border p-5">
        <h2 className="text-foreground text-base font-bold">선생님 한마디</h2>
        {isAbsent ? (
          <p className="text-text-faint mt-2 text-sm">
            이 날은 결석했어요. 다음 수업에서 만나요!
          </p>
        ) : note ? (
          <p className="text-foreground mt-2 text-sm leading-relaxed whitespace-pre-wrap">{note}</p>
        ) : (
          <p className="text-text-faint mt-2 text-sm">
            아직 선생님이 작성 중이에요. 잠시만 기다려 주세요.
          </p>
        )}
        <div className="mt-3 flex flex-wrap gap-1.5">
          <Pill color="neutral">수업 태도 · {view.attitude ?? "—"}</Pill>
          <Pill color="neutral">과제 · {view.homework}</Pill>
        </div>
      </section>
    </div>
  );
}
