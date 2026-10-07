import type { VocabkingReport } from "../model";
import { SPELLING_LABEL } from "../spelling";

/**
 * 보카킹 리포트 **④ 어휘 강점 / 보완 포인트**. 순수 프레젠테이션.
 * 🔑 '취약' 대신 '보완 포인트'(원장 정리안 — 학부모에게 다음 단계로 읽히게). 유형은 정답과 쓴 답으로만 판정한 것이다(spelling.ts).
 */
export function VkAdvice({ report }: { report: VocabkingReport }) {
  const m = report.mistakes;
  const hasMistakes = m.spellingTotal + m.meaning > 0;
  return (
    <section className="grid gap-4 @lg:grid-cols-2">
      <div className="border-line flex flex-col gap-3 rounded-2xl border p-5">
        <h2 className="text-foreground text-lg font-bold">④ 어휘 강점</h2>
        <ul className="flex flex-col gap-2 text-sm">
          {report.strengths.map((s) => (
            <li key={s} className="flex items-start gap-2">
              <span className="bg-green-soft text-green mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-xs font-bold">강점</span>
              <span className="text-foreground">{s}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="border-line flex flex-col gap-3 rounded-2xl border p-5">
        <h2 className="text-foreground text-lg font-bold">④ 어휘 보완 포인트</h2>
        {hasMistakes ? (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-bg-soft">
                <th className="border-line border-b px-3 py-2 text-left font-bold">유형</th>
                <th className="border-line border-b px-3 py-2 text-right font-bold">틀린 문제</th>
              </tr>
            </thead>
            <tbody>
              {m.spelling.map((s) => (
                <tr key={s.kind}>
                  <td className="border-line border-b px-3 py-2">철자 · {s.label}</td>
                  <td className="num border-line border-b px-3 py-2 text-right font-bold">{s.count}</td>
                </tr>
              ))}
              {m.longWords > 0 ? (
                <tr>
                  <td className="border-line border-b px-3 py-2">그중 긴 단어(9글자 이상)</td>
                  <td className="num border-line border-b px-3 py-2 text-right font-bold">{m.longWords}</td>
                </tr>
              ) : null}
              {m.meaning > 0 ? (
                <tr>
                  <td className="px-3 py-2">뜻 혼동</td>
                  <td className="num px-3 py-2 text-right font-bold">{m.meaning}</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        ) : (
          <p className="text-text-dim text-sm">이번 시험에서 틀린 문제가 없습니다.</p>
        )}
        {m.spellingExamples.length ? (
          <div className="flex flex-col gap-1 text-sm">
            <p className="text-text-dim text-xs font-bold">철자 다시 보기</p>
            {m.spellingExamples.map((w, i) => (
              <p key={`${w.answer}-${i}`} className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-text-dim">{w.prompt}</span>
                <s className="text-danger">{w.typed || "(빈칸)"}</s>
                <span>→</span>
                <b className="text-foreground">{w.answer}</b>
                <span className="text-text-faint text-xs">{SPELLING_LABEL[w.kind]}</span>
              </p>
            ))}
          </div>
        ) : null}
        {report.weakWords.length ? (
          <div className="flex flex-col gap-1 text-sm">
            <p className="text-text-dim text-xs font-bold">평소 학습에서 자주 틀린 단어</p>
            <p className="text-foreground">
              {report.weakWords.map((w) => `${w.answer}(${w.answers}번 중 ${w.wrongs}번)`).join(" · ")}
            </p>
          </div>
        ) : null}
      </div>
    </section>
  );
}
