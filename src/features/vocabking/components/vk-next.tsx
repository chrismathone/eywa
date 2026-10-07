import type { VocabkingReport } from "../model";
import { fmtStudy } from "../format";

/**
 * 보카킹 리포트 **⑤ 다음 학습 방향 + 학습 습관**. 순수 프레젠테이션.
 * 학습 습관은 시안에 없던 블록이다 — 인재원이 최근 30학습일 기록을 주므로 데이터가 있는 칸이라 넣었다(원장 2026-10-07 "다 넣어서").
 */
const STEP_TONES = ["bg-blue-soft text-blue", "bg-green-soft text-green", "bg-purple-soft text-purple", "bg-amber-soft text-amber"];

export function VkNext({ report }: { report: VocabkingReport }) {
  const h = report.habits;
  const peak = h ? Math.max(1, ...h.daily.map((d) => d.answers)) : 1;
  return (
    <>
      {report.nextSteps.length ? (
        <section className="flex flex-col gap-3">
          <h2 className="border-foreground text-foreground border-b-2 pb-2 text-lg font-bold">⑤ 다음 학습 방향</h2>
          <ol className="grid gap-3 @md:grid-cols-2 @3xl:grid-cols-4">
            {report.nextSteps.map((s, i) => (
              <li key={s.title} className={`flex flex-col gap-1.5 rounded-2xl p-4 ${STEP_TONES[i % STEP_TONES.length]}`}>
                <p className="text-sm font-bold">
                  {i + 1}. {s.title}
                </p>
                <p className="text-foreground text-sm leading-relaxed">{s.body}</p>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
      {h ? (
        <section className="border-line flex flex-col gap-3 rounded-2xl border p-5">
          <h2 className="text-foreground text-lg font-bold">학습 습관 · 최근 {h.days}일</h2>
          <div className="grid grid-cols-2 gap-2 @md:grid-cols-4">
            {[
              { label: "학습한 날", value: `${h.activeDays}일` },
              { label: "학습 시간", value: fmtStudy(h.studyMs) },
              { label: "새로 익힌 단어", value: `${h.newWords}개` },
              { label: "학습 정답률", value: `${Math.round(h.accuracy * 100)}%` },
            ].map((x) => (
              <div key={x.label} className="bg-bg-soft rounded-xl px-3 py-2.5">
                <p className="text-text-dim text-xs font-medium">{x.label}</p>
                <p className="num text-foreground text-xl font-bold">{x.value}</p>
              </div>
            ))}
          </div>
          <div className="flex h-16 items-end gap-0.5" role="img" aria-label={`최근 ${h.days}일 날짜별 푼 문제 수`}>
            {h.daily.map((d) => (
              <span
                key={d.day}
                title={`${d.day} · ${d.answers}문제`}
                className={`block flex-1 rounded-t ${d.answers > 0 ? "bg-primary" : "bg-bg-soft"}`}
                style={{ height: `${d.answers > 0 ? Math.max(8, Math.round((d.answers / peak) * 100)) : 6}%` }}
              />
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}
