import Link from "next/link";
import { BookText, CheckCircle2 } from "lucide-react";
import { EyIcon } from "@/components/icons/eywa-icons";
import { Button } from "@/components/ui/button";
import { Pagination } from "@/components/pagination";
import { getCatalogPage, getCatalogStats } from "@/features/billing/server/catalog-queries";
import { CatalogTable } from "./catalog-table";

const GRADE_FILTERS = [
  { key: "all", label: "전체" },
  { key: "초", label: "초등" },
  { key: "중", label: "중등" },
  { key: "고", label: "고등" },
];
const ACTIVE_FILTERS = [
  { key: "all", label: "전체" },
  { key: "active", label: "사용" },
  { key: "inactive", label: "중지" },
];

type Sp = { q?: string; grade?: string; active?: string; page?: string };
const PAGE_SIZE = 50;

// 교재 단가표 — 교재 면(목록/교재단가표)과 수강료 계산기 면(…/교재 단가표) 두 곳에서 같은 컴포넌트로 쓴다.
// base = 현재 마운트 위치 파라미터(예: {tab:"textbooks",tsub:"catalog"} 또는 {tab:"calculator",csub:"catalog"}).
// 필터/검색/페이지 링크가 base를 보존해 해당 면 안에 머문다.
export async function CatalogPanel({ sp, base }: { sp: Sp; base: Record<string, string> }) {
  const q = sp.q ?? "";
  const grade = sp.grade ?? "all";
  const active = sp.active ?? "all";
  const page = Math.max(1, Number(sp.page) || 1);

  const [{ rows, total }, stats] = await Promise.all([
    getCatalogPage({ q, gradeLevel: grade, active }, page, PAGE_SIZE),
    getCatalogStats(),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const build = (patch: Partial<Sp>) => {
    const next = { q, grade, active, ...patch };
    const p = new URLSearchParams(base);
    if (next.grade && next.grade !== "all") p.set("grade", next.grade);
    if (next.active && next.active !== "all") p.set("active", next.active);
    if (next.q) p.set("q", next.q);
    if (patch.page && patch.page !== "1") p.set("page", String(patch.page));
    return `/billing?${p.toString()}`;
  };

  return (
    <div className="space-y-4">
      <section className="grid grid-cols-2 gap-3.5 sm:grid-cols-2">
        <Kpi label="등록 교재" value={`${stats.total}종`} icon={BookText} color="rose" />
        <Kpi label="사용 중" value={`${stats.active}종`} icon={CheckCircle2} color="primary" />
      </section>

      {/* 필터 바 */}
      <div className="bg-card border-line shadow-card flex flex-wrap items-center gap-3 rounded-md border px-4 py-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="micro mr-1">학년</span>
          {GRADE_FILTERS.map((f) => (
            <Chip key={f.key} href={build({ grade: f.key })} on={grade === f.key}>
              {f.label}
            </Chip>
          ))}
        </div>
        <span className="bg-line h-4 w-px" aria-hidden />
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="micro mr-1">상태</span>
          {ACTIVE_FILTERS.map((f) => (
            <Chip key={f.key} href={build({ active: f.key })} on={active === f.key}>
              {f.label}
            </Chip>
          ))}
        </div>
        <form action="/billing" method="get" className="ml-auto flex items-center gap-2">
          {Object.entries(base).map(([k, v]) => (
            <input key={k} type="hidden" name={k} value={v} />
          ))}
          {grade !== "all" ? <input type="hidden" name="grade" value={grade} /> : null}
          {active !== "all" ? <input type="hidden" name="active" value={active} /> : null}
          <div className="border-line bg-bg-soft text-text-dim flex items-center gap-2 rounded-sm border px-2.5 py-1.5">
            <EyIcon name="search" size={13} />
            <input
              type="search"
              name="q"
              defaultValue={q}
              placeholder="교재명·출판사"
              className="text-foreground placeholder:text-text-faint w-32 bg-transparent text-xs focus:outline-none"
            />
          </div>
          <Button type="submit" variant="outline" size="sm">
            검색
          </Button>
        </form>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-text-dim text-xs">
          교재 <span className="num text-foreground font-semibold">{total}</span>종
          {totalPages > 1 ? (
            <span className="ml-2">· {page}/{totalPages} 페이지</span>
          ) : null}
        </p>
      </div>

      <CatalogTable rows={rows} />
      {totalPages > 1 ? (
        <Pagination page={page} totalPages={totalPages} hrefForPage={(n) => build({ page: String(n) })} />
      ) : null}
    </div>
  );
}

function Chip({ href, on, children }: { href: string; on: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={`shrink-0 rounded-sm border px-2 py-0.5 text-xs transition ${
        on
          ? "border-foreground bg-foreground text-background font-medium"
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
  icon: typeof BookText;
  color: "rose" | "primary";
}) {
  const ICON_BG = {
    rose: "bg-rose-soft text-rose",
    primary: "bg-primary-soft text-primary",
  } as const;
  return (
    <article className="bg-card border-line shadow-card rounded-md border p-4">
      <header className="flex items-center justify-between">
        <p className="micro">{label}</p>
        <span className={`flex size-[26px] items-center justify-center rounded-sm ${ICON_BG[color]}`}>
          <Icon size={14} strokeWidth={2} />
        </span>
      </header>
      <p className="tabular text-foreground num mt-2 text-[22px] leading-none">{value}</p>
    </article>
  );
}
