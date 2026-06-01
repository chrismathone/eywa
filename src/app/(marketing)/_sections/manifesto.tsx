import { EyIcon } from "@/components/icons/eywa-icons";
import { MANIFESTO_PROMISES } from "@/data/marketing";

const ICON_BY_COLOR = {
  primary: "roots",
  gold: "wave",
  blue: "check",
  purple: "rings",
  rose: "sparkle",
} as const;

export function ManifestoSection() {
  return (
    <section className="bg-background px-16 py-[140px]">
      <div className="mx-auto max-w-[1280px]">
        {/* Header */}
        <div className="max-w-2xl">
          <p className="text-primary font-mono text-[11px] font-bold tracking-wider uppercase">
            02 — 약속
          </p>
          <h2
            className="text-foreground mt-4"
            style={{ fontSize: 56, fontWeight: 800, letterSpacing: "-1.8px", lineHeight: 1.05 }}
          >
            EYWA의 핵심가치는
            <br />
            <span
              style={{
                backgroundImage:
                  "linear-gradient(transparent 62%, var(--gold-soft) 62%, var(--gold-soft) 92%, transparent 92%)",
              }}
            >
              학원의 성장
            </span>
            입니다.
          </h2>
          <p className="text-text-dim mt-6 text-[16px]">
            기술이 아닌 학원을 위한 도구. EYWA가 매일 지키는 다섯 가지 약속입니다.
          </p>
        </div>

        {/* 5 promise 카드 — 벤토 그리드 */}
        <div className="mt-14 grid grid-cols-1 gap-4 md:grid-cols-6">
          {MANIFESTO_PROMISES.map((p, idx) => {
            const COLOR_BG = {
              primary: "bg-primary",
              gold: "bg-gold",
              blue: "bg-blue",
              purple: "bg-purple",
              rose: "bg-rose",
            };
            const COLOR_SOFT = {
              primary: "bg-primary-soft text-primary",
              gold: "bg-gold-soft text-gold",
              blue: "bg-blue-soft text-blue",
              purple: "bg-purple-soft text-purple",
              rose: "bg-rose-soft text-rose",
            };
            return (
              <article
                key={p.no}
                className="bg-card border-line relative overflow-hidden rounded-xl border p-8"
                style={{ gridColumn: `span ${p.span}` }}
              >
                <span
                  className={`pointer-events-none absolute -top-20 -right-20 size-[240px] rounded-full opacity-[0.10] ${COLOR_BG[p.color]}`}
                  aria-hidden="true"
                />
                <header className="relative flex items-center justify-between">
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[10px] font-bold uppercase ${COLOR_SOFT[p.color]}`}
                  >
                    <span className={`size-1.5 rounded-full ${COLOR_BG[p.color]}`} />
                    Promise
                  </span>
                  <span
                    className={`flex size-10 items-center justify-center rounded-xl ${COLOR_SOFT[p.color]}`}
                  >
                    <EyIcon name={ICON_BY_COLOR[p.color]} size={18} />
                  </span>
                </header>
                <h3
                  className="text-foreground relative mt-5"
                  style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-0.5px", lineHeight: 1.3 }}
                >
                  {p.title}
                </h3>
                <p
                  className="text-text-dim relative mt-3 whitespace-pre-line"
                  style={{ fontSize: 14, lineHeight: 1.7 }}
                >
                  {p.body}
                </p>
                <footer className="border-line relative mt-6 flex items-center justify-between border-t pt-4">
                  <span className="text-text-faint font-mono text-[10px] uppercase">
                    {p.no} / {String(MANIFESTO_PROMISES.length).padStart(2, "0")}
                  </span>
                  <span className={`h-px w-6 ${COLOR_BG[p.color]}`} />
                </footer>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
