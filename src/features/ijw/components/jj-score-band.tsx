import type { ScoreBand } from "../sheet-model";
import { Meter } from "./jj-sheet-parts";

const MARK: Record<"ink" | "muted", string> = { ink: "bg-foreground", muted: "bg-neutral-fill" };
const TICKS = [0, 20, 40, 60, 80, 100];

/**
 * 점수 위치 — 0~100 막대를 점수만큼 채우고, 반 평균(잉크)·전체 평균(회색)을 세로선으로 얹는다.
 * 원본의 등급 띠 자리지만 판정 이름은 없다(숫자와 평균만). 평균 이름표는 막대 위에서 겹치지 않게 아래 범례로 뺐다.
 */
export function JjScoreBand({ band, score }: { band: ScoreBand; score: number }) {
  const align = band.align === "start" ? "" : band.align === "end" ? "-translate-x-full" : "-translate-x-1/2";
  return (
    <div className="flex flex-col gap-1.5" role="img" aria-label={`0~100점 중 ${score}점${band.markers.map((m) => ` · ${m.label}`).join("")}`}>
      <div className="relative pt-8">
        <span
          className={`num text-foreground absolute top-0 text-sm font-bold whitespace-nowrap ${align}`}
          style={{ left: `${band.pct}%` }}
        >
          이 학생 {score}점
        </span>
        <span
          className="border-t-foreground absolute top-5 h-0 w-0 -translate-x-1/2 border-x-[6px] border-t-[7px] border-x-transparent"
          style={{ left: `${band.pct}%` }}
          aria-hidden
        />
        <div className="relative">
          <Meter pct={band.pct} tone={band.tone} size="lg" />
          {band.markers.map((m) => (
            <span
              key={m.key}
              className={`ring-card absolute -top-1.5 -bottom-1.5 w-[3px] -translate-x-1/2 rounded-full ring-2 ${MARK[m.tone]}`}
              style={{ left: `${m.pct}%` }}
              aria-hidden
            />
          ))}
        </div>
      </div>
      <div className="relative h-5" aria-hidden>
        {TICKS.map((v) => (
          <span
            key={v}
            className={`num text-text-dim absolute text-xs ${v === 0 ? "" : v === 100 ? "-translate-x-full" : "-translate-x-1/2"}`}
            style={{ left: `${v}%` }}
          >
            {v}
          </span>
        ))}
      </div>
      {band.markers.length ? (
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {band.markers.map((m) => (
            <span key={m.key} className="text-foreground inline-flex items-center gap-1.5 text-xs font-medium">
              <span className={`h-3 w-[3px] rounded-full ${MARK[m.tone]}`} aria-hidden />
              {m.label}
            </span>
          ))}
        </div>
      ) : (
        <p className="text-text-dim text-xs">아직 비교할 응시자가 없습니다.</p>
      )}
    </div>
  );
}
