import { Pill } from "@/components/atoms/pill";
import type { IjwExamResult } from "../contract";
import { WEAK_NOTE, examHeadline, examPosRows, scoreBand, wrongRows, type AvgCompare, type ExamHeadline } from "../sheet-model";
import { JjScoreBand } from "./jj-score-band";
import { BarList, EmptyNote, SheetFrame, SheetSection, WordTable } from "./jj-sheet-parts";
import type { JjSheetLayout } from "./jj-study-sheet";

/**
 * 인재원 **시험 결과지** — aywa식 재설계(사용자 2026-09-11).
 *
 * 정보 구조는 인재원 원본(renderExam)과 같다: 응시 정보(시험명·구분·제출·걸린 시간) → 점수 /100 · 정답 N/M ·
 * 반 평균·전체 평균 ±차 → 점수 위치(0~100, 평균 세로선) → 품사별 → 다시 봐야 할 단어(문제 | 정답 | 학생 답).
 * 🔑 평균이 없으면(비교할 응시자 없음) 숫자를 지어내지 않는다. 걸린 시간 3시간 초과는 "—".
 * 🔑 '반 평균'은 인재원 반 기준이다(인재원이 계산해 준 값 그대로).
 *
 * - `layout="card"` — 학부모 카드(그날 응시마다 한 장). 틀린 단어는 12개까지 + "외 N개".
 * - `layout="wide"` — 응시 결과 창. 틀 폭이 넓으면 두 단 · 틀린 단어 전부.
 * ⚠️ 훅·"use client" 없이 순수 프레젠테이션(jj-study-sheet.tsx와 같은 규약).
 */
const COMPARE_TONE: Record<AvgCompare["tone"], string> = {
  positive: "text-green",
  critical: "text-danger",
  neutral: "text-text-dim",
};

function ExamScore({ head }: { head: ExamHeadline }) {
  return (
    <div className="grid gap-3 @md:grid-cols-[auto_minmax(0,1fr)] @md:items-center">
      <div className="px-1">
        <p className="text-text-dim text-xs font-medium">점수</p>
        <p className="mt-1 flex items-baseline gap-1.5">
          <span className={`num text-5xl leading-none font-bold ${head.tone === "critical" ? "text-danger" : "text-foreground"}`}>
            {head.score}
          </span>
          <span className="text-text-dim text-lg font-bold">/ 100</span>
        </p>
        <p className="text-foreground mt-1.5 text-sm font-medium">{head.correctLine}</p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {head.compares.map((c) => (
          <div key={c.label} className="bg-bg-soft min-w-0 rounded-xl px-3 py-2.5">
            <p className="text-text-dim text-xs font-medium">{c.label}</p>
            <p className="num text-foreground text-xl leading-tight font-bold">{c.value}</p>
            <p className={`text-xs font-bold ${COMPARE_TONE[c.tone]}`}>{c.note}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export function JjExamSheet({ exam, layout = "card" }: { exam: IjwExamResult; layout?: JjSheetLayout }) {
  const wide = layout === "wide";
  const head = examHeadline(exam);
  const band = scoreBand(head.score, exam.classAvg, exam.overallAvg);
  const pos = examPosRows(exam, wide ? 8 : 6);
  const wrong = wrongRows(exam, wide ? undefined : 12);
  return (
    <SheetFrame
      kind="exam"
      layout={layout}
      eyebrow="시험 결과지"
      title={exam.deck.name || "시험"}
      meta={`${head.submitted} 제출 · 걸린 시간 ${head.elapsed}`}
      aside={<Pill>{head.typeLabel}</Pill>}
    >
      <div className="grid gap-5 @2xl:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] @2xl:items-center">
        <ExamScore head={head} />
        <SheetSection title="점수 위치" note="0 – 100점 · 평균과 비교">
          <JjScoreBand band={band} score={head.score} />
        </SheetSection>
      </div>

      <div className="grid gap-5 @2xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <SheetSection title="품사별 점수" note={WEAK_NOTE}>
          {pos.length ? (
            <BarList rows={pos} heads={["품사", "맞힘 / 문항"]} />
          ) : (
            <EmptyNote>품사를 가를 수 있는 문항이 없습니다.</EmptyNote>
          )}
        </SheetSection>
        <SheetSection title="다시 봐야 할 단어" note={wrong.total ? `틀린 문항 ${wrong.total}개` : undefined}>
          {wrong.total ? (
            <WordTable
              heads={["문제", "정답", "학생 답"]}
              more={wrong.rest}
              rows={wrong.rows.map((w) => ({
                key: w.key,
                no: w.no,
                prompt: w.prompt,
                answer: w.answer,
                last: w.typed ? <span className="text-danger">{w.typed}</span> : <span className="text-text-dim text-xs">(답 없음)</span>,
              }))}
            />
          ) : (
            <EmptyNote>{exam.total ? "틀린 문항이 없습니다 — 모두 맞혔습니다." : "채점된 문항이 없습니다."}</EmptyNote>
          )}
        </SheetSection>
      </div>
    </SheetFrame>
  );
}
