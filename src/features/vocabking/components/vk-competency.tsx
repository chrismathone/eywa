import type { RateRow, VocabkingReport } from "../model";
import { fmtDuration } from "../format";

/**
 * 보카킹 리포트 **② 어휘 역량별 평가 + ③ 어휘 세부 평가 결과**. 순수 프레젠테이션.
 * 🔴 축은 데이터가 있는 것만(어휘 정답률 · 의미 이해=객관식 · 철자 정확도=주관식) — 문맥 이해·축별 학년 평균은 데이터가 없어 뺐다
 *    (원장 2026-10-07 *"데이터 없음 빼고"*). 평균선은 **전체 정답률 한 축**에만 있는 값(인재원 전체 평균)으로 긋는다.
 */
const pct = (r: number) => `${Math.round(r * 100)}%`;

/** 3축 그래프 — 위(정답률)·오른쪽 아래·왼쪽 아래. 축이 3개 미만이면 막대만 그린다(삼각형이 안 된다). */
function Radar({ rows }: { rows: RateRow[] }) {
  const R = 100;
  const angle = (i: number) => (-90 + i * 120) * (Math.PI / 180);
  const pt = (i: number, r: number) => `${(Math.cos(angle(i)) * r).toFixed(1)},${(Math.sin(angle(i)) * r).toFixed(1)}`;
  const ring = (f: number) => rows.map((_, i) => pt(i, R * f)).join(" ");
  const label = (i: number) => ({ x: Math.cos(angle(i)) * (R + 26), y: Math.sin(angle(i)) * (R + 26) });
  return (
    <svg viewBox="-180 -140 360 270" className="w-full max-w-80" role="img" aria-label={rows.map((r) => `${r.label} ${pct(r.rate)}`).join(", ")}>
      {[0.25, 0.5, 0.75, 1].map((f) => (
        <polygon key={f} points={ring(f)} fill="none" className="stroke-line" strokeWidth={1} />
      ))}
      {rows.map((_, i) => (
        <line key={i} x1={0} y1={0} x2={Number(pt(i, R).split(",")[0])} y2={Number(pt(i, R).split(",")[1])} className="stroke-line" />
      ))}
      <polygon points={rows.map((r, i) => pt(i, R * r.rate)).join(" ")} className="fill-primary/15 stroke-primary" strokeWidth={2.5} />
      {rows.map((r, i) => {
        const [x, y] = pt(i, R * r.rate).split(",").map(Number);
        return <circle key={r.key} cx={x} cy={y} r={4} className="fill-primary" />;
      })}
      {rows.map((r, i) => {
        const l = label(i);
        return (
          <text key={r.key} x={l.x} y={l.y} textAnchor="middle" className="fill-foreground text-xs font-bold">
            <tspan x={l.x} dy="-0.2em">{r.label}</tspan>
            <tspan x={l.x} dy="1.2em" className="fill-primary">{pct(r.rate)}</tspan>
          </text>
        );
      })}
    </svg>
  );
}

function DetailRow({ label, sub, value, bar, avg }: { label: string; sub?: string; value: string; bar?: number; avg?: number | null }) {
  return (
    // 좁은 폭(폰·학부모 카드) = 이름·값 한 줄 + 아래에 막대/설명 전체 폭 · 넓은 틀(@3xl, JJ실 창) = 이름 | 막대 | 값 세 칸.
    // 🔴 세 칸을 폰에서 그대로 두면 가운데 설명이 한두 글자씩 세로로 쌓였다(실화면 확인 2026-10-07).
    <div className="border-line grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 border-b py-2.5 last:border-b-0 @3xl:grid-cols-[8rem_minmax(0,1fr)_7rem]">
      <span className="text-foreground col-start-1 row-start-1 text-sm font-bold">{label}</span>
      {bar !== undefined ? (
        <span className="bg-bg-soft relative col-span-2 row-start-2 block h-2.5 rounded-full @3xl:col-span-1 @3xl:col-start-2 @3xl:row-start-1">
          <span className="bg-primary block h-2.5 rounded-full" style={{ width: `${Math.round(bar * 100)}%` }} />
          {avg != null ? (
            <span className="bg-neutral-fill absolute -top-1 block h-4.5 w-0.5" style={{ left: `${avg}%` }} title={`전체 평균 ${avg}점`} />
          ) : null}
        </span>
      ) : (
        <span className="text-text-dim col-span-2 row-start-2 text-xs @3xl:col-span-1 @3xl:col-start-2 @3xl:row-start-1">{sub}</span>
      )}
      <span className="num text-primary col-start-2 row-start-1 text-right text-base font-bold @3xl:col-start-3">{value}</span>
    </div>
  );
}

export function VkCompetency({ report }: { report: VocabkingReport }) {
  const rows = report.competency;
  const overallAvg = report.position.comparisons.find((c) => c.key === "overall")?.avg ?? null;
  const d = report.details;
  return (
    <section className="flex flex-col gap-3">
      <h2 className="border-foreground text-foreground border-b-2 pb-2 text-lg font-bold">② 어휘 역량별 평가 · ③ 어휘 세부 평가 결과</h2>
      <div className="grid items-center gap-4 @lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
        <div className="flex justify-center">{rows.length >= 3 ? <Radar rows={rows} /> : null}</div>
        <div>
          {rows.map((r) => (
            <DetailRow
              key={r.key}
              label={r.label}
              value={pct(r.rate)}
              bar={r.rate}
              avg={r.key === "total" ? overallAvg : null}
            />
          ))}
          {d.longTermWords !== null ? <DetailRow label="장기 기억 단어" sub="오래 기억하고 있는 단어 수(최근 30일 학습 기준)" value={`${d.longTermWords}개`} /> : null}
          {d.seenWords !== null ? <DetailRow label="학습한 단어" sub="지금까지 학습에서 만난 단어 수" value={`${d.seenWords}개`} /> : null}
          <DetailRow
            label="소요 시간"
            sub={d.peerAvgElapsedMs !== null ? `응시자 평균 ${fmtDuration(d.peerAvgElapsedMs)}` : "이번 시험을 푸는 데 걸린 시간"}
            value={fmtDuration(d.elapsedMs)}
          />
          {overallAvg !== null ? <p className="text-text-faint pt-1 text-xs">회색 세로선 = 전체 평균</p> : null}
        </div>
      </div>
    </section>
  );
}
