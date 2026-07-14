import Link from "next/link";
import {
  EYWA_ICON_CATALOG,
  EYWA_ICON_SIZES,
  EyIcon,
  type EywaIconFamily,
} from "@/components/icons/eywa-icons";
import { requireAccess } from "@/lib/auth/require-access";

export const metadata = { title: "아이콘 시스템 — eywa" };

const FAMILY_ORDER: EywaIconFamily[] = ["product", "interface"];

const FAMILY_META: Record<
  EywaIconFamily,
  { label: string; description: string; index: string }
> = {
  product: {
    label: "Product",
    description: "학원 운영에서 실제로 만나는 업무 객체",
    index: "A",
  },
  interface: {
    label: "Interface",
    description: "학습 없이 바로 이해되는 보편 조작",
    index: "B",
  },
};

const SIZE_ENTRIES = Object.entries(EYWA_ICON_SIZES) as [
  keyof typeof EYWA_ICON_SIZES,
  number,
][];

export default async function IconSystemPage() {
  await requireAccess("help");

  return (
    <div className="mx-auto w-full max-w-7xl space-y-10 pb-12">
      <section className="border-line bg-card shadow-card overflow-hidden rounded-2xl border">
        <div className="grid lg:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
          <div className="flex flex-col justify-between gap-12 p-6 sm:p-9 lg:p-12">
            <div>
              <Link
                href="/help"
                className="text-text-faint hover:text-primary inline-flex items-center gap-1.5 font-mono text-[10px] font-bold tracking-[0.14em] uppercase transition-colors"
              >
                <EyIcon name="arrowRight" size={11} className="rotate-180" />
                도움말로 돌아가기
              </Link>
              <p className="text-primary mt-10 font-mono text-[11px] font-bold tracking-[0.16em] uppercase">
                Eywa icon system · v2
              </p>
              <h1 className="text-foreground mt-3 max-w-2xl text-[clamp(2rem,5vw,4.4rem)] leading-[1.05] font-extrabold tracking-[-0.045em]">
                형태는 통일하고,
                <br />
                기능은 바로 읽힙니다.
              </h1>
              <p className="text-text-dim mt-5 max-w-xl text-[14px] leading-[1.75] sm:text-[15px]">
                학원 운영의 익숙한 사물과 보편 조작을 한 문법으로 그립니다. 누구나 같은 기능을 같은 모양으로
                알아볼 수 있게 만든 Eywa의 자체 아이콘입니다.
              </p>
            </div>

            <dl className="border-line grid grid-cols-3 border-t pt-5">
              <div>
                <dt className="text-text-faint font-mono text-[9px] tracking-wider uppercase">Glyphs</dt>
                <dd className="text-foreground mt-1 text-xl font-extrabold tabular-nums">
                  {EYWA_ICON_CATALOG.length}
                </dd>
              </div>
              <div className="border-line border-l pl-4 sm:pl-6">
                <dt className="text-text-faint font-mono text-[9px] tracking-wider uppercase">Grid</dt>
                <dd className="text-foreground mt-1 text-xl font-extrabold tabular-nums">24</dd>
              </div>
              <div className="border-line border-l pl-4 sm:pl-6">
                <dt className="text-text-faint font-mono text-[9px] tracking-wider uppercase">Stroke</dt>
                <dd className="text-foreground mt-1 text-xl font-extrabold tabular-nums">1.6</dd>
              </div>
            </dl>
          </div>

          <div
            className="border-line bg-bg-soft relative min-h-[330px] overflow-hidden border-t lg:min-h-full lg:border-t-0 lg:border-l"
            style={{
              backgroundImage:
                "linear-gradient(to right, var(--line) 1px, transparent 1px), linear-gradient(to bottom, var(--line) 1px, transparent 1px)",
              backgroundSize: "24px 24px",
            }}
          >
            <span className="text-text-faint absolute top-4 left-4 font-mono text-[9px] tracking-wider uppercase">
              24 × 24 master grid
            </span>
            <span className="text-text-faint absolute right-4 bottom-4 font-mono text-[9px] tracking-wider uppercase">
              currentColor / round
            </span>
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-primary/10 absolute">
                <EyIcon name="columns2" size={250} strokeWidth={0.8} />
              </span>
              <span className="bg-card text-primary shadow-modal relative flex size-40 items-center justify-center rounded-full border border-primary/15 sm:size-48">
                <EyIcon name="layoutGrid" size={94} strokeWidth={1.35} />
              </span>
            </div>
          </div>
        </div>
      </section>

      <section aria-labelledby="geometry-title">
        <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="micro">Core geometry</p>
            <h2 id="geometry-title" className="text-foreground mt-1 text-xl font-extrabold">
              하나의 뼈대, 다섯 가지 크기
            </h2>
          </div>
          <p className="text-text-faint max-w-md text-right text-[11px] leading-relaxed">
            16px 이하는 선을 1.8로 보정하고, 그보다 큰 크기는 1.6을 유지합니다.
          </p>
        </header>

        <div className="border-line bg-card shadow-card grid grid-cols-2 overflow-hidden rounded-2xl border sm:grid-cols-5">
          {SIZE_ENTRIES.map(([token, size], index) => (
            <div
              key={token}
              className={`flex min-h-36 flex-col items-center justify-center gap-4 p-5 last:max-sm:col-span-2 ${
                index > 0 ? "border-line sm:border-l" : ""
              } ${index % 2 === 1 ? "max-sm:border-l" : ""} ${index > 1 ? "max-sm:border-t" : ""}`}
            >
              <span className="text-primary flex h-12 items-center justify-center">
                <EyIcon name="calendar" size={size} strokeWidth={size <= 16 ? 1.8 : 1.6} />
              </span>
              <span className="text-center">
                <span className="text-foreground block font-mono text-[11px] font-bold">{token}</span>
                <span className="text-text-faint mt-0.5 block font-mono text-[9px]">{size}px</span>
              </span>
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="catalog-title">
        <header className="mb-5">
          <p className="micro">Complete catalog</p>
          <h2 id="catalog-title" className="text-foreground mt-1 text-xl font-extrabold">
            전체 아이콘
          </h2>
        </header>

        <div className="space-y-8">
          {FAMILY_ORDER.map((family) => {
            const meta = FAMILY_META[family];
            const icons = EYWA_ICON_CATALOG.filter((icon) => icon.family === family);
            return (
              <section
                key={family}
                aria-labelledby={`family-${family}`}
                className="[contain-intrinsic-size:auto_720px] [content-visibility:auto]"
              >
                <div className="border-line mb-3 flex items-end gap-3 border-b pb-2.5">
                  <span className="text-primary font-mono text-[11px] font-bold">{meta.index}</span>
                  <div>
                    <h3 id={`family-${family}`} className="text-foreground text-[14px] font-extrabold">
                      {meta.label}
                    </h3>
                    <p className="text-text-faint mt-0.5 text-[10px]">{meta.description}</p>
                  </div>
                  <span className="text-text-faint ml-auto font-mono text-[10px] tabular-nums">{icons.length}</span>
                </div>

                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {icons.map((icon) => (
                    <article
                      key={icon.name}
                      className="border-line bg-card hover:border-primary/25 hover:shadow-card-hover group flex min-h-28 items-center gap-4 rounded-xl border p-4 transition-[border-color,box-shadow]"
                    >
                      <span className="bg-primary-softer text-primary group-hover:bg-primary-soft flex size-12 shrink-0 items-center justify-center rounded-lg transition-colors">
                        <EyIcon name={icon.name} size={24} />
                      </span>
                      <span className="min-w-0">
                        <span className="text-foreground block text-[13px] font-bold">{icon.label}</span>
                        <code className="text-primary mt-0.5 block font-mono text-[10px]">{icon.name}</code>
                        <span className="text-text-faint mt-1.5 block text-[10px] leading-relaxed">{icon.meaning}</span>
                      </span>
                    </article>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="bg-ink text-white rounded-2xl p-6 sm:p-8">
          <p className="font-mono text-[10px] font-bold tracking-[0.14em] text-[#e9c876] uppercase">Usage</p>
          <h2 className="mt-2 text-xl font-extrabold">하나의 의미에는 하나의 모양</h2>
          <ul className="mt-6 space-y-4 text-[12px] leading-relaxed text-white/75">
            <li className="flex gap-3">
              <EyIcon name="check" size={15} className="mt-0.5 shrink-0 text-[#e9c876]" />
              메뉴 아이콘은 반드시 MENU_ICON을 통해 배정합니다.
            </li>
            <li className="flex gap-3">
              <EyIcon name="check" size={15} className="mt-0.5 shrink-0 text-[#e9c876]" />
              텍스트가 의미를 설명하면 아이콘은 장식으로 숨깁니다.
            </li>
            <li className="flex gap-3">
              <EyIcon name="check" size={15} className="mt-0.5 shrink-0 text-[#e9c876]" />
              AI 기능은 sparkle과 gold 계열을 함께 사용합니다.
            </li>
          </ul>
        </div>

        <div className="border-line bg-card shadow-card rounded-2xl border p-6 sm:p-8">
          <p className="micro">Code</p>
          <h2 className="text-foreground mt-1 text-xl font-extrabold">한 컴포넌트로 사용합니다</h2>
          <pre className="bg-bg-soft text-foreground mt-6 overflow-x-auto rounded-lg p-4 font-mono text-[11px] leading-6">
            <code>{`<EyIcon name="calendar" size={20} />

<button aria-label="알림 열기">
  <EyIcon name="bell" size={16} strokeWidth={1.8} />
</button>`}</code>
          </pre>
          <p className="text-text-faint mt-4 text-[11px] leading-relaxed">
            전체 제작 규칙과 신규 아이콘 검수 절차는 <code className="font-mono">docs/icon-system.md</code>에서 관리합니다.
          </p>
        </div>
      </section>
    </div>
  );
}
