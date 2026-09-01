import Link from "next/link";
import type { LucideIcon } from "@/components/icons/eywa-icon-compat";
import { AlertTriangle, AlertCircle, ShieldCheck, TrendingDown } from "@/components/icons/eywa-icon-compat";
import { FilterSelect } from "@/components/filter-select";
import { SearchForm } from "@/components/search-form";
import { requireAccess } from "@/lib/auth/require-access";
import { effectiveTeacherId } from "@/lib/auth/view-mode";
import {
  getRetentionRoster,
  summarizeRoster,
  type RosterStudent,
} from "@/features/retention/server/queries";
import { RetentionTabs } from "@/features/retention/components/retention-tabs";
import { BoardList } from "@/features/retention/components/board-list";
import {
  TOOLBAR_CHIP,
  TOOLBAR_CHIP_OFF,
  TOOLBAR_CHIP_ON,
  TOOLBAR_SELECT,
} from "@/components/toolbar-controls";
import { Pagination } from "@/components/pagination";
import { formatWonShort } from "@/features/retention/format";

export const metadata = { title: "리텐션 보드 — eywa" };

const PAGE_SIZE = 50;

type LevelKey = "all" | "risk" | "warn" | "ok";
type SortKey = "risk" | "fee" | "name";

const LEVELS: { key: LevelKey; label: string }[] = [
  { key: "all", label: "전체" },
  { key: "risk", label: "위험" },
  { key: "warn", label: "관심" },
  { key: "ok", label: "안정" },
];
const SORTS = [
  { value: "risk", label: "위험도순" },
  { value: "fee", label: "수강료순" },
  { value: "name", label: "이름순" },
];

type SearchState = { level: LevelKey; teacher: string; sort: SortKey; q: string };

function buildHref(p: SearchState): string {
  const sp = new URLSearchParams();
  if (p.level !== "all") sp.set("level", p.level);
  if (p.teacher) sp.set("teacher", p.teacher);
  if (p.sort !== "risk") sp.set("sort", p.sort);
  if (p.q) sp.set("q", p.q);
  const s = sp.toString();
  return s ? `/retention/board?${s}` : "/retention/board";
}

export default async function RetentionBoardPage({
  searchParams,
}: {
  searchParams: Promise<{
    level?: LevelKey;
    teacher?: string;
    sort?: SortKey;
    q?: string;
    page?: string;
  }>;
}) {
  await requireAccess("retention");
  const tId = await effectiveTeacherId();
  const sp = await searchParams;
  const state: SearchState = {
    level: sp.level ?? "all",
    teacher: sp.teacher ?? "",
    sort: sp.sort ?? "risk",
    q: sp.q ?? "",
  };
  const page = Math.max(1, Number(sp.page) || 1);

  const roster = await getRetentionRoster(tId ? { teacherId: tId } : undefined);
  const stats = summarizeRoster(roster);
  const teacherNames = Array.from(
    new Set(roster.map((r) => r.teacherName).filter((n): n is string => !!n)),
  ).sort((a, b) => a.localeCompare(b, "ko"));

  let rows: RosterStudent[] = roster;
  if (state.level !== "all") rows = rows.filter((r) => r.risk.level === state.level);
  if (state.teacher) rows = rows.filter((r) => r.teacherName === state.teacher);
  if (state.q) {
    const term = state.q.toLowerCase();
    rows = rows.filter((r) => r.name.toLowerCase().includes(term));
  }
  if (state.sort === "fee") rows = [...rows].sort((a, b) => (b.monthlyFee ?? -1) - (a.monthlyFee ?? -1));
  else if (state.sort === "name") rows = [...rows].sort((a, b) => a.name.localeCompare(b.name, "ko"));

  // 통계·필터는 전체(rows) 기준, 목록만 50행으로 슬라이스(billing 메모리 페이지네이션 패턴).
  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const pageHref = (p: number) => {
    const params = new URLSearchParams();
    if (state.level !== "all") params.set("level", state.level);
    if (state.teacher) params.set("teacher", state.teacher);
    if (state.sort !== "risk") params.set("sort", state.sort);
    if (state.q) params.set("q", state.q);
    if (p > 1) params.set("page", String(p));
    const s = params.toString();
    return s ? `/retention/board?${s}` : "/retention/board";
  };

  return (
    <div className="space-y-4">
      <RetentionTabs />

      <section className="grid grid-cols-2 gap-3.5 sm:grid-cols-4">
        <Stat label="위험" value={stats.risk} icon={AlertTriangle} color="danger" />
        <Stat label="관심" value={stats.warn} icon={AlertCircle} color="amber" />
        <Stat label="안정" value={stats.ok} icon={ShieldCheck} color="primary" />
        <Stat label="매출 위험" value={formatWonShort(stats.revenueRisk)} icon={TrendingDown} color="rose" />
      </section>

      {/* ⚠️ 툴바엔 카드 껍데기를 두지 않는다(앱 전역 툴바 규약) — 컨트롤이 저마다 테두리를 갖고 있어
          줄은 그대로 읽히고, 아래 목록 카드와 선이 겹치지 않는다. */}
      <div className="space-y-3 px-1 py-1">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="micro mr-1">등급</span>
            {LEVELS.map((f) => (
              <Link
                key={f.key}
                href={buildHref({ ...state, level: f.key })}
                className={`${TOOLBAR_CHIP} ${state.level === f.key ? TOOLBAR_CHIP_ON : TOOLBAR_CHIP_OFF}`}
              >
                {f.label}
              </Link>
            ))}
          </div>
          <SearchForm placeholder="학생명" defaultValue={state.q} inputWidth="w-28" />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="micro mr-1">담당강사</span>
            <FilterSelect
              paramName="teacher"
              triggerClassName={TOOLBAR_SELECT}
              value={state.teacher || null}
              options={teacherNames.map((n) => ({ value: n, label: n }))}
              ariaLabel="담당강사 필터"
            />
          </div>
          <div className="flex items-center gap-1.5">
            <span className="micro mr-1">정렬</span>
            <FilterSelect
              paramName="sort"
              triggerClassName={TOOLBAR_SELECT}
              value={state.sort === "risk" ? null : state.sort}
              allLabel="위험도순"
              options={SORTS.filter((s) => s.value !== "risk")}
              ariaLabel="정렬"
            />
          </div>
          <span className="text-text-dim num ml-auto text-[11px]">
            {total}명{totalPages > 1 ? ` · ${page}/${totalPages}` : ""}
          </span>
        </div>
      </div>

      <section className="bg-card border-line shadow-card overflow-hidden rounded-2xl border">
        <BoardList rows={pageRows} />
      </section>
      <Pagination page={page} totalPages={totalPages} hrefForPage={pageHref} />
    </div>
  );
}

function Stat({
  label,
  value,
  icon: Icon,
  color,
}: {
  label: string;
  value: number | string;
  icon: LucideIcon;
  color: "primary" | "rose" | "amber" | "danger";
}) {
  const ICON_BG = {
    primary: "bg-primary-soft text-primary",
    rose: "bg-rose-soft text-rose",
    amber: "bg-amber-soft text-amber",
    danger: "bg-danger-soft text-danger",
  } as const;
  return (
    <div className="bg-card border-line shadow-card rounded-2xl border p-4">
      <header className="flex items-center justify-between">
        <p className="micro truncate">{label}</p>
        <span className={`flex size-[26px] shrink-0 items-center justify-center rounded-md ${ICON_BG[color]}`}>
          <Icon size={13} strokeWidth={1.8} />
        </span>
      </header>
      <p className="tabular text-foreground mt-2 text-[26px] leading-none">{value}</p>
    </div>
  );
}
