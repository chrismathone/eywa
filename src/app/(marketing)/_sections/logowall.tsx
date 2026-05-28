import { ACADEMY_TILES, LIVE_COUNTERS } from "@/data/marketing";

export function LogoWallSection() {
  return (
    <section className="bg-bg-soft border-line relative overflow-hidden border-y py-[120px]">
      {/* 배경 장식 */}
      <span
        className="bg-primary-soft pointer-events-none absolute top-0 left-0 size-[520px] rounded-full blur-3xl"
        aria-hidden="true"
      />
      <span
        className="bg-gold-soft pointer-events-none absolute top-0 right-0 size-[540px] rounded-full blur-3xl"
        style={{ opacity: 0.8 }}
        aria-hidden="true"
      />

      <div className="relative mx-auto max-w-[1280px] px-16">
        {/* 헤더 */}
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <p className="text-primary font-mono text-[11px] font-bold tracking-[2px] uppercase">
              ─ LIVE NETWORK
            </p>
            <h2
              className="text-foreground mt-3"
              style={{ fontSize: 44, fontWeight: 800, letterSpacing: "-1.4px", lineHeight: 1.1 }}
            >
              지금 이 순간에도
              <br />
              전국{" "}
              <span
                style={{
                  backgroundImage:
                    "linear-gradient(transparent 62%, var(--gold-soft) 62%, var(--gold-soft) 92%, transparent 92%)",
                }}
              >
                47개 학원이
              </span>{" "}
              EYWA를 쓰고 있어요.
            </h2>
          </div>
          <div className="border-line bg-card text-primary inline-flex items-center gap-2 rounded-full border px-3.5 py-2">
            <span className="bg-primary size-2 animate-pulse rounded-full" />
            <span className="font-mono text-[11px] font-bold tracking-wider uppercase">
              Supabase Realtime · 2026.05.27 14:32
            </span>
          </div>
        </div>

        {/* 라이브 카운터 4개 */}
        <div className="mt-12 grid grid-cols-2 gap-4 lg:grid-cols-4">
          {LIVE_COUNTERS.map((c) => {
            const COLOR_GLOW = {
              primary: "bg-primary/10",
              blue: "bg-blue/10",
              purple: "bg-purple/10",
              gold: "bg-gold/10",
            };
            const COLOR_PILL = {
              primary: "bg-primary-soft text-primary",
              blue: "bg-blue-soft text-blue",
              purple: "bg-purple-soft text-purple",
              gold: "bg-gold-soft text-gold",
            };
            const DOT = {
              primary: "bg-primary",
              blue: "bg-blue",
              purple: "bg-purple",
              gold: "bg-gold",
            };
            return (
              <article
                key={c.label}
                className="bg-card border-line shadow-card-hover relative overflow-hidden rounded-2xl border p-6"
              >
                <span
                  className={`pointer-events-none absolute -top-8 -right-8 size-[110px] rounded-full blur-xl ${COLOR_GLOW[c.color]}`}
                  aria-hidden="true"
                />
                <div className="relative flex items-center justify-between">
                  <p className="micro">{c.label}</p>
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 font-mono text-[9px] font-bold ${COLOR_PILL[c.color]}`}
                  >
                    <span className={`size-1.5 rounded-full ${DOT[c.color]}`} />
                    LIVE
                  </span>
                </div>
                <p
                  className="tabular text-foreground num relative mt-3"
                  style={{ fontSize: 44, letterSpacing: "-1.6px", lineHeight: 1 }}
                >
                  {c.value}
                </p>
                <p className="text-text-dim relative mt-2 text-[12px]">{c.sub}</p>
              </article>
            );
          })}
        </div>

        {/* 학원 모자이크 */}
        <div className="mt-14">
          <p className="text-text-dim flex items-center gap-2 font-mono text-[11px] font-bold tracking-wider uppercase">
            <span className="bg-gold size-2 rounded-full" />
            함께 만들어가는 학원들 · 10/47
          </p>
          <div className="mt-4 grid grid-cols-6 gap-2.5 lg:grid-cols-12">
            {ACADEMY_TILES.map((tile) => (
              <article
                key={tile.name}
                className={`flex h-[116px] flex-col justify-between rounded-2xl p-[18px] ${
                  tile.accent
                    ? "border-0 text-white"
                    : "bg-card border-line border"
                }`}
                style={{
                  gridColumn: `span ${tile.span}`,
                  ...(tile.accent
                    ? {
                        background: "linear-gradient(135deg, #1a5f3c 0%, #2a7a52 100%)",
                        boxShadow: "0 14px 32px rgba(26, 95, 60, 0.20)",
                      }
                    : {}),
                }}
              >
                <div>
                  <p
                    className={`text-[15px] font-extrabold tracking-tight ${tile.accent ? "text-white" : "text-foreground"}`}
                  >
                    {tile.name}
                  </p>
                  <p
                    className={`mt-1 text-[11px] ${tile.accent ? "text-white/70" : "text-text-dim"}`}
                  >
                    {tile.loc}
                  </p>
                </div>
                <div className="flex items-baseline justify-between">
                  <p
                    className={`tabular text-[22px] font-extrabold ${tile.accent ? "text-white" : "text-primary"}`}
                  >
                    {tile.students}
                    <span
                      className={`ml-0.5 font-mono text-[10px] font-normal ${tile.accent ? "text-white/70" : "text-text-dim"}`}
                    >
                      학생
                    </span>
                  </p>
                  <span
                    className={`font-mono text-[9px] font-bold uppercase ${tile.accent ? "text-white/80" : "text-primary"}`}
                  >
                    ACTIVE
                  </span>
                </div>
              </article>
            ))}
          </div>
        </div>

        {/* Status bar */}
        <div className="border-line bg-card mt-10 flex items-center justify-between rounded-xl border px-5 py-3.5">
          <p className="text-text-dim font-mono text-[12px]">
            {"// 전국 47개 학원 · 12,800+ 학생 · 220+ 강사"}
          </p>
          <p className="font-mono text-[12px]">
            <span className="text-primary font-bold">uptime 99.97%</span>
            <span className="text-text-dim ml-2">SLA 99.9%</span>
          </p>
        </div>
      </div>
    </section>
  );
}
