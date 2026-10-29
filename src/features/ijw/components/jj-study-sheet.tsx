import type { IjwStudy } from "../contract";
import {
  WEAK_NOTE,
  dailyChart,
  periodLabel,
  studyDeckRows,
  studyExamRows,
  studyKpis,
  studyPosRows,
  weakRows,
} from "../sheet-model";
import { JjDailyChart } from "./jj-daily-chart";
import { BarList, EmptyNote, SheetFrame, SheetSection, WordTable } from "./jj-sheet-parts";
import { StudyExamList, StudyHero, StudyKpiTiles } from "./jj-study-parts";

/**
 * 인재원 **학습 분석지** — aywa식 재설계(사용자 2026-09-11 *"anki 한장짜리 학습분석지 … 재디자인 설계해서 aywa식"*).
 *
 * 정보 구조는 인재원 원본(renderStudy)과 같다: 종합 정답률 → 핵심 지표 네 칸(학습 시간·학습한 날·새로 익힌 단어·
 * 장기기억 단어) → 일별 학습량(평균선·최고치) → 단어장별·품사별 → 자주 틀리는 단어 · 기간 중 시험.
 * 그림은 aywa 문법(팔레트 v4·BigStat 톤·소프트 패널)이고, A4 한 장이 아니라 **폰에서 읽는 세로 카드**다.
 *
 * - `layout="card"` — 학부모 카드(/r·PDF·ClassNote 캡처, 512px 열). 목록을 짧게 접는다(단어장·품사 5줄, 틀린 단어 5, 시험 3).
 * - `layout="wide"` — 학생 상세 성적 탭. 틀 폭(@container)이 넓으면 두 단 · 점수 추이 선 · 목록을 길게.
 * ⚠️ 훅·"use client" 없이 순수 프레젠테이션 — 서버 카드와 원스크린 미리보기(클라이언트)가 같이 그린다.
 */
export type JjSheetLayout = "card" | "wide";

export function JjStudySheet({ study, layout = "card" }: { study: IjwStudy; layout?: JjSheetLayout }) {
  const wide = layout === "wide";
  const k = studyKpis(study);
  const chart = dailyChart(study.daily, study.totals.activeDays, wide ? 10 : 6);
  const decks = studyDeckRows(study, wide ? 7 : 5);
  const pos = studyPosRows(study, wide ? 7 : 5);
  const weak = weakRows(study, wide ? 10 : 5);
  const exams = studyExamRows(study, wide ? 5 : 3);
  const deckCount = study.byDeck.filter((d) => d.answers > 0).length;
  return (
    <SheetFrame
      kind="study"
      layout={layout}
      eyebrow="학습 분석지"
      title="학습기록 정밀분석"
      aside={<span className="num text-foreground text-sm font-bold whitespace-nowrap">{periodLabel(study.from, study.to)}</span>}
    >
      <div className="grid gap-3 @3xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] @3xl:items-stretch">
        <StudyHero k={k} />
        <StudyKpiTiles k={k} />
      </div>

      <SheetSection title="일별 학습량" note={chart.note}>
        <JjDailyChart chart={chart} tall={wide} />
      </SheetSection>

      <div className="grid gap-5 @2xl:grid-cols-2">
        <SheetSection title="단어장별 정답률" note={deckCount ? `${deckCount}개 단어장` : undefined}>
          {decks.length ? (
            <BarList rows={decks} heads={["단어장", "정답 / 푼 수"]} />
          ) : (
            <EmptyNote>기간 중 푼 단어장이 없습니다.</EmptyNote>
          )}
        </SheetSection>
        <SheetSection title="품사별 정답률" note={WEAK_NOTE}>
          {pos.length ? (
            <BarList rows={pos} heads={["품사", "정답 / 푼 수"]} />
          ) : (
            <EmptyNote>품사를 가를 수 있는 기록이 없습니다.</EmptyNote>
          )}
        </SheetSection>
      </div>

      <div className="grid gap-5 @2xl:grid-cols-2">
        <SheetSection title="자주 틀리는 단어" note={weak.length ? "많이 틀린 순" : undefined}>
          {weak.length ? (
            <WordTable
              heads={["문제", "정답", "틀림 / 푼 수"]}
              rows={weak.map((w) => ({
                key: w.key,
                no: w.no,
                prompt: w.prompt,
                answer: w.answer,
                last: <span className="num text-text-dim text-xs whitespace-nowrap">{w.note}</span>,
              }))}
            />
          ) : (
            <EmptyNote>{k.hasAnswers ? "기간 중 자주 틀린 단어가 없습니다." : "기간 중 학습 기록이 없습니다."}</EmptyNote>
          )}
        </SheetSection>
        <SheetSection title="기간 중 시험" note={study.exams.length ? `${study.exams.length}회` : undefined}>
          <StudyExamList data={exams} trend={wide} />
        </SheetSection>
      </div>
    </SheetFrame>
  );
}
