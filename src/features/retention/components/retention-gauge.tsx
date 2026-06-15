// 학원 건강 게이지 — 위험/관심/안정 구성 스택바(Daylight: danger/amber/primary).

const SEGS = [
  { key: "risk", label: "위험", cls: "bg-danger" },
  { key: "warn", label: "관심", cls: "bg-amber" },
  { key: "ok", label: "안정", cls: "bg-primary" },
] as const;

export function RetentionGauge({ risk, warn, ok }: { risk: number; warn: number; ok: number }) {
  const total = risk + warn + ok;
  const safe = total || 1;
  const values: Record<string, number> = { risk, warn, ok };
  return (
    <div className="bg-card border-line shadow-card rounded-2xl border p-5">
      <div className="flex items-baseline justify-between">
        <p className="micro">학원 건강</p>
        <span className="text-text-dim text-[11px]">
          재원생 <span className="text-foreground num font-bold">{total}</span>명
        </span>
      </div>
      <div className="bg-bg-soft mt-3 flex h-2.5 overflow-hidden rounded-full">
        {SEGS.filter((s) => values[s.key] > 0).map((s) => (
          <span key={s.key} className={`${s.cls} h-full`} style={{ width: `${(values[s.key] / safe) * 100}%` }} />
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
        {SEGS.map((s) => (
          <span key={s.key} className="text-text-dim flex items-center gap-1.5 text-[12px] font-medium">
            <i className={`${s.cls} size-2 rounded-sm`} />
            {s.label} <span className="text-foreground num font-bold">{values[s.key]}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
