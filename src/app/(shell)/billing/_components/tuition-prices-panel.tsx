import Link from "next/link";
import { Coins, CheckCircle2 } from "@/components/icons/eywa-icon-compat";
import { Pagination } from "@/components/pagination";
import { SearchForm } from "@/components/search-form";
import {
  getTuitionCatalogPage,
  getTuitionCatalogStats,
  TUITION_CATEGORIES,
} from "@/features/billing/server/tuition-catalog-queries";
import { PMODE_UNSET, PRICING_MODES } from "@/features/billing/tuition-catalog";
import { TuitionPricesTable } from "./tuition-prices-table";

const CATEGORY_FILTERS = [{ key: "all", label: "전체" }, ...TUITION_CATEGORIES.map((c) => ({ key: c, label: c }))];
// 🔴 '미지정'이 필터에 없으면 **아직 안 고른 항목을 화면에서 골라낼 방법이 아예 없다**(전체·회당·월·할인
//    어디에도 안 잡힌다). 남은 것을 세고 고르는 게 이 화면의 실제 용무라 마지막 칸으로 넣는다.
const PMODE_FILTERS = [
  { key: "all", label: "전체" },
  ...PRICING_MODES.map((m) => ({ key: m.value, label: m.label })),
  { key: PMODE_UNSET, label: "미지정" },
];
const ACTIVE_FILTERS = [
  { key: "all", label: "전체" },
  { key: "active", label: "사용" },
  { key: "inactive", label: "중지" },
];

type Sp = { q?: string; cat?: string; cpmode?: string; cactive?: string; cpage?: string };
const PAGE_SIZE = 50;

// 수강료 단가표 면(계산기 서브탭). 교재 단가표(catalog-panel) 패턴 미러 — 단, billing 면이 tab=calculator라
// 필터/페이지 파라미터를 cat/cactive/cpage로 네임스페이스(상위 face/하위 sub 파라미터 충돌 방지).
export async function TuitionPricesPanel({ sp }: { sp: Sp }) {
  const q = sp.q ?? "";
  const category = sp.cat ?? "all";
  const pmode = sp.cpmode ?? "all";
  const active = sp.cactive ?? "all";
  const page = Math.max(1, Number(sp.cpage) || 1);

  const [{ rows, total }, stats] = await Promise.all([
    getTuitionCatalogPage({ q, category, pmode, active }, page, PAGE_SIZE),
    getTuitionCatalogStats(),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const build = (patch: Partial<Sp>) => {
    const next = { q, cat: category, cpmode: pmode, cactive: active, ...patch };
    const p = new URLSearchParams({ tab: "calculator", csub: "prices" });
    if (next.cat && next.cat !== "all") p.set("cat", next.cat);
    if (next.cpmode && next.cpmode !== "all") p.set("cpmode", next.cpmode);
    if (next.cactive && next.cactive !== "all") p.set("cactive", next.cactive);
    if (next.q) p.set("q", next.q);
    if (patch.cpage && patch.cpage !== "1") p.set("cpage", String(patch.cpage));
    return `/billing?${p.toString()}`;
  };

  return (
    <div className="space-y-4">
      <section className="grid grid-cols-2 gap-3.5">
        <Kpi label="등록 단가" value={`${stats.total}개`} icon={Coins} color="primary" />
        <Kpi label="사용 중" value={`${stats.active}개`} icon={CheckCircle2} color="primary" />
      </section>

      {/* 🔴 아직 단가 종류를 안 고른 항목 — **숫자가 보여야 이 일이 끝난다.** 종류가 없으면 계산기가
          안전하게 월 고정으로 넣는데, 회당 수업이 그렇게 들어가면 한 달치가 한 회차 금액으로 줄고,
          반대로 월정액을 회당으로 바꾸면 EiE 27만원 × N회가 된다(원장 2026-08-07). 바로 걸러 볼 수 있게
          링크를 건다. 남은 게 0이면 배너 자체가 사라진다(끝난 일을 계속 재촉하지 않는다). */}
      {stats.unset > 0 ? (
        <Link
          href={build({ cpmode: PMODE_UNSET, cactive: "active", cpage: "1" })}
          className="border-amber/40 bg-amber-soft text-amber flex flex-wrap items-center gap-x-1.5 rounded-2xl border px-4 py-2.5 text-[12.5px] transition hover:brightness-95"
        >
          <span className="font-bold">
            단가 종류를 안 고른 항목이 <span className="num">{stats.unset}</span>개 있습니다
          </span>
          <span className="text-amber/80">
            — 계산기가 이 항목을 <b>월 고정</b>으로 넣습니다. 회당 수업이면 금액이 한 회차분으로 줄어드니
            눌러서 골라 주세요.
          </span>
        </Link>
      ) : null}

      {/* 필터 바 */}
      <div className="bg-card border-line shadow-card flex flex-wrap items-center gap-3 rounded-2xl border px-4 py-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="micro mr-1">분류</span>
          {CATEGORY_FILTERS.map((f) => (
            <Chip key={f.key} href={build({ cat: f.key })} on={category === f.key}>
              {f.label}
            </Chip>
          ))}
        </div>
        <span className="bg-line h-4 w-px" aria-hidden />
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="micro mr-1">단가 종류</span>
          {PMODE_FILTERS.map((f) => (
            <Chip key={f.key} href={build({ cpmode: f.key })} on={pmode === f.key}>
              {f.label}
            </Chip>
          ))}
        </div>
        <span className="bg-line h-4 w-px" aria-hidden />
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="micro mr-1">상태</span>
          {ACTIVE_FILTERS.map((f) => (
            <Chip key={f.key} href={build({ cactive: f.key })} on={active === f.key}>
              {f.label}
            </Chip>
          ))}
        </div>
        <SearchForm placeholder="항목명·분류" defaultValue={q} resetParams={["cpage"]} />
      </div>

      {/* 건수 줄과 '항목 추가' 버튼이 각자 한 행씩 쓰고 있었다(원장 2026-08-07) → 표 툴바 한 행으로 합친다. */}
      <TuitionPricesTable
        rows={rows}
        summary={
          <p className="text-text-dim text-xs">
            단가 <span className="num text-foreground font-bold">{total}</span>개
            {totalPages > 1 ? <span className="ml-2">· {page}/{totalPages} 페이지</span> : null}
          </p>
        }
      />
      {totalPages > 1 ? (
        <Pagination page={page} totalPages={totalPages} hrefForPage={(n) => build({ cpage: String(n) })} />
      ) : null}
    </div>
  );
}

function Chip({ href, on, children }: { href: string; on: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={`shrink-0 rounded-full border px-2 py-0.5 text-xs transition ${
        on
          ? "border-primary bg-primary text-primary-foreground font-medium"
          : "border-line text-text-dim hover:text-foreground hover:bg-bg-soft"
      }`}
    >
      {children}
    </Link>
  );
}

function Kpi({
  label,
  value,
  icon: Icon,
  color,
}: {
  label: string;
  value: string;
  icon: typeof Coins;
  color: "primary";
}) {
  const ICON_BG = { primary: "bg-primary-soft text-primary" } as const;
  return (
    <article className="bg-card border-line shadow-card rounded-2xl border p-4">
      <header className="flex items-center justify-between">
        <p className="micro">{label}</p>
        <span className={`flex size-[26px] items-center justify-center rounded-sm ${ICON_BG[color]}`}>
          <Icon size={14} strokeWidth={1.8} />
        </span>
      </header>
      <p className="tabular text-foreground num mt-2 text-[22px] leading-none">{value}</p>
    </article>
  );
}
