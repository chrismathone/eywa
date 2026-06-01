import { buildReport } from "@/features/onescreen/report";
import { subjectTone, toneSolidClass, toneTextClass } from "@/features/onescreen/data";
import { Pill } from "@/components/atoms/pill";
import { DeltaChip } from "@/features/onescreen/components/delta-chip";
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
      <span className="text-foreground text-[13px] font-bold">{kicker}</span>
      <span className="text-text-faint text-[11px]">{sub}</span>
    </div>
  );
  if (test.score == null) {
    return (
      <div className="border-line rounded-md border px-3 py-2.5">
        {header}
        <p className="text-text-faint mt-1.5 text-[12px]">아직 점수가 입력되지 않았어요.</p>
      </div>
    );
  }
  const p = pctOf(test.score, test.max);
  const tone = perfTone(p);
  return (
    <div className="border-line rounded-md border px-3 py-2.5">
      {header}
      <div className="mt-1.5 flex items-baseline gap-1.5">
        <span className={`tabular text-[22px] font-extrabold ${PERF_TEXT[tone]}`}>{test.score}</span>
        <span className="text-text-faint tabular text-[13px]">/ {test.max}</span>
        <DeltaChip score={test.score} prev={test.prevScore} />
        <span className="text-text-dim tabular ml-auto text-[12px] font-semibold">{p}%</span>
      </div>
      <div className="bg-bg-soft mt-2 h-2 overflow-hidden rounded-pill">
        <div className={`h-full rounded-pill ${PERF_BG[tone]}`} style={{ width: `${p}%` }} />
      </div>
    </div>
  );
}

/** 학생 데일리 리포트 — 그날 진도·테스트·선생님 한마디(읽기 전용). */
export function DailyReportView({ base, session }: { base: OneScreenStudent; session: Session }) {
  const view = sessionToStudent(base, session);
  const isLatest = session.date === "6/1";
  const headDate = isLatest ? TODAY : `2026년 ${dateKo(session.date)}`;
  const note = view.reportSent ? buildReport(view) : "";

  return (
    <div className="space-y-4">
      {/* 헤더 (ink 다크) */}
      <header className="bg-ink text-background relative overflow-hidden rounded-xl px-5 py-5">
        <span className="absolute top-4 right-4 rounded-[4px] bg-white/15 px-2 py-0.5 text-[11px] font-bold">
          {view.attendance}
        </span>
        <p className="font-mono text-[11px] opacity-70">
          {headDate} · {isLatest ? "오늘" : "지난"} 데일리 리포트
        </p>
        <h1 className="mt-1 text-[21px] font-extrabold">오늘의 학습 리포트</h1>
        <p className="mt-1 text-[13px] opacity-80">
          {base.name} · {base.grade} {base.tag}
        </p>
      </header>

      {/* 오늘 배운 내용 */}
      <section className="bg-card border-line shadow-card rounded-xl border p-5">
        <h2 className="text-foreground text-[15px] font-bold">오늘 배운 내용</h2>
        <div className="mt-3 space-y-2.5">
          {view.subjects.map((su, i) => {
            const { tone } = subjectTone(su.name);
            return (
              <div key={i} className="flex items-start gap-3">
                <span className={`mt-0.5 h-9 w-1 rounded-pill ${toneSolidClass(tone)}`} aria-hidden />
                <div>
                  <p className={`text-[14px] font-bold ${toneTextClass(tone)}`}>{su.name}</p>
                  <p className="mt-0.5 flex items-center gap-1.5 text-[12.5px]">
                    <span className="text-text-faint">{su.prev}</span>
                    <span className={toneTextClass(tone)}>→</span>
                    <span className="text-foreground font-semibold">{su.today}</span>
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* 오늘의 테스트 */}
      <section className="bg-card border-line shadow-card rounded-xl border p-5">
        <h2 className="text-foreground text-[15px] font-bold">오늘의 테스트</h2>
        <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          <TestBlock kicker="일일테스트" sub="이전 진도 복습" test={view.tests.daily} />
          <TestBlock kicker="확인테스트" sub="오늘 진도" test={view.tests.check} />
        </div>
      </section>

      {/* 선생님 한마디 */}
      <section className="bg-card border-line shadow-card rounded-xl border p-5">
        <h2 className="text-foreground text-[15px] font-bold">선생님 한마디</h2>
        {note ? (
          <p className="text-foreground mt-2 text-[14px] leading-relaxed whitespace-pre-wrap">{note}</p>
        ) : (
          <p className="text-text-faint mt-2 text-[13px]">
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
