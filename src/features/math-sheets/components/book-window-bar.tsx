"use client";

import { useMathTextbooks } from "./math-textbook-context";
import { windowName } from "./plan-card-sections";
import { shortBook } from "./roadmap-goal";
import overview from "./learning-overview.module.css";
import local from "./book-window.module.css";

/** 계획 대비 판정 — 목표 레일과 같은 너그러움(±1차시 = 계획대로, goal-rail.ts). */
function stateOf(done: number, planned: number): { text: string; tone: "on" | "behind" | "ahead" } {
  const gap = done - planned;
  if (Math.abs(gap) <= 1) return { text: "계획대로", tone: "on" };
  return gap > 0 ? { text: `${gap}차시 빠름`, tone: "ahead" } : { text: `${-gap}차시 느림`, tone: "behind" };
}

const short = (date: string) => date.slice(5).replace("-", ".");
const volume = (title: string) => title.match(/(\d+)권/)?.[1] ?? "";

type CellState = "done" | "late" | "todo";

/**
 * 교재 3개월 진행표 — 주문일+7일부터 3개월 안에 주문한 권 ~ 그 학기 마지막 권을 끝내는 계획과 지금 위치(원장 2026-10-19).
 *
 * 🔑 **차시 한 칸 = 한 칸**으로 그린다(원장 *"디자인이나 가시성이 너무 별로"* — 레일 복제판은 짧고 원이 겹쳤다).
 *    차시는 셀 수 있는 단위라 칸이 그대로 읽힌다: 파랑 = 클래스노트로 나간 보고서 기준 나간 차시 ·
 *    빨강 = 오늘까지 계획인데 아직 못 나간 차시 · 회색 = 남은 차시. 권마다 묶고 아래에 권 이름.
 * 색은 진도 레일과 같은 두 색(`--mcs-actual` 파랑 · `--mcs-goal` 빨강)을 쓴다.
 * 계산은 서버(`bookWindow`)가 끝내고 여기는 그리기만 한다. 주문 기록이 없는 학생은 아무것도 안 그린다.
 */
export function BookWindowBar({ studentId, embedded = false }: { studentId: string; embedded?: boolean }) {
  const ctx = useMathTextbooks();
  const w = ctx?.windows[studentId];
  if (!w || w.total === 0) return null;
  const first = w.books[0]!.title;
  // 이름·묶음 라벨은 카드와 같은 함수 — 창이 학기를 넘으면(중2-2 4권 + 중3-1 1권) '4~1권'이 되지 않게.
  const name = windowName(w);
  const series = first.replace(/\s*\d+권$/, "");

  const done = w.done ?? 0;
  const notStarted = w.referenceDate < w.startDate;
  const ended = w.referenceDate > w.endDate;
  const planned = notStarted ? 0 : w.planned;
  const state = notStarted
    // 창이 열리기 전인데 이미 그 권을 나가고 있으면(책이 일찍 왔다) 그 사실을 같이 말한다 — '시작'만 적으면 5/8과 모순으로 읽힌다.
    ? { text: done > 0 ? `${short(w.startDate)} 시작 전 · 먼저 진행 중` : `${short(w.startDate)} 시작`, tone: undefined }
    : w.done === null
      ? { text: "진도 확인 필요", tone: undefined }
      : ended
        ? w.done >= w.total
          ? { text: "기간 내 완료", tone: "on" as const }
          : { text: `기간 종료 · ${w.total - w.done}차시 남음`, tone: "behind" as const }
        : stateOf(w.done, planned);

  // 권마다 칸을 묶는다 — 칸 번호(누적) = 앞 권들의 차시 + 이 권 안 번호.
  const groups = w.books.map((b, bi) => {
    const offset = w.books.slice(0, bi).reduce((n, x) => n + x.lessons, 0);
    return {
      id: b.id,
      label: b.title.startsWith(series) ? `${volume(b.title)}권` : shortBook(b.key, b.title),
      cells: Array.from({ length: b.lessons }, (_, i): { no: number; state: CellState } => {
        const at = offset + i + 1;
        return { no: i + 1, state: at <= done ? "done" : at <= planned ? "late" : "todo" };
      }),
    };
  });

  return (
    <section className={local.panel} data-embedded={embedded || undefined} aria-label={`교재 3개월 진행 · ${name}`}>
      <div className={local.head}>
        <span className={local.tag}>교재 3개월</span>
        <strong className={local.name}>{name}</strong>
        <span className={local.period}>
          {short(w.startDate)} – {short(w.endDate)}
        </span>
        <span className={local.figures}>
          <b>{w.done ?? "—"}</b>/{w.total}차시{!notStarted && !ended ? ` · 3개월 계획 ${planned}` : ""}
        </span>
        <span className={overview.status} data-tone={state.tone}>
          {state.text}
        </span>
      </div>
      <div className={local.groups}>
        {groups.map((g) => (
          <div key={g.id} className={local.group} style={{ flexGrow: g.cells.length }}>
            <div className={local.cells}>
              {g.cells.map((c) => (
                <span key={c.no} className={local.cell} data-state={c.state} title={`${g.label} ${c.no}차시`} />
              ))}
            </div>
            <span className={local.volume}>{g.label}</span>
          </div>
        ))}
      </div>
      <p className={local.now}>
        <span className={local.nowTag}>현재</span>
        {w.position ? (
          <>
            {volume(w.position.title)}권 {w.position.lessonNo}차시 · {w.position.unit}
            <span className={local.source}>{short(w.position.date)} 발송 보고서</span>
          </>
        ) : (
          "발송된 보고서에서 진도를 아직 못 찾았습니다"
        )}
      </p>
    </section>
  );
}
