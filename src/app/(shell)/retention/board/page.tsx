import Link from "next/link";
import { EyIcon } from "@/components/icons/eywa-icons";
import { FilterSelect } from "@/components/filter-select";
import { requireAccess } from "@/lib/auth/require-access";
import {
  getRetentionRoster,
  summarizeRoster,
  type RosterStudent,
} from "@/features/retention/server/queries";
import { RetentionTabs } from "@/features/retention/components/retention-tabs";
import { BoardList } from "@/features/retention/components/board-list";
import { formatWonShort } from "@/features/retention/format";

export const metadata = { title: "리텐션 보드 — eywa" };

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
  searchParams: Promise<{ level?: LevelKey; teacher?: string; sort?: SortKey; q?: string }>;
}) {
  const user = await requireAccess("retention");
  const sp = await searchParams;
  const state: SearchState = {
    level: sp.level ?? "all",
    teacher: sp.teacher ?? "",
    sort: sp.sort ?? "risk",
    q: sp.q ?? "",
  };

  const roster = await getRetentionRoster(
    user.systemRole === "teacher" ? { teacherId: user.id } : undefined,
  );
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
  if (state.sort === "fee") rows = [...rows].sort((a, b) => b.monthlyFee - a.monthlyFee);
  else if (state.sort === "name") rows = [...rows].sort((a, b) => a.name.localeCompare(b.name, "ko"));

  return (
    <div className="space-y-4">
      <RetentionTabs />

      <section className="grid grid-cols-2 gap-3.5 sm:grid-cols-4">
        <Stat label="위험" value={stats.risk} icon="falling" color="danger" />
        <Stat label="관심" value={stats.warn} icon="pulse" color="amber" />
        <Stat label="안정" value={stats.ok} icon="roots" color="primary" />
        <Stat label="매출 위험" value={formatWonShort(stats.revenueRisk)} icon="pollen" color="rose" />
      </section>

      <div className="bg-card border-line shadow-card space-y-3 rounded-md border px-4 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="micro mr-1">등급</span>
            {LEVELS.map((f) => (
              <Link
                key={f.key}
                href={buildHref({ ...state, level: f.key })}
                className={`shrink-0 rounded-sm border px-2 py-0.5 text-xs transition ${
                  state.level === f.key
                    ? "border-foreground bg-foreground text-background font-medium"
                    : "border-line text-text-dim hover:text-foreground hover:bg-bg-soft"
                }`}
              >
                {f.label}
              </Link>
            ))}
          </div>
          <form action="/retention/board" method="get" className="ml-auto flex items-center gap-2">
            {state.level !== "all" ? <input type="hidden" name="level" value={state.level} /> : null}
            {state.teacher ? <input type="hidden" name="teacher" value={state.teacher} /> : null}
            {state.sort !== "risk" ? <input type="hidden" name="sort" value={state.sort} /> : null}
            <div className="border-line bg-bg-soft text-text-dim flex items-center gap-2 rounded-sm border px-2.5 py-1.5">
              <EyIcon name="search" size={13} />
              <input
                type="search"
                name="q"
                defaultValue={state.q}
                placeholder="학생명"
                className="text-foreground placeholder:text-text-faint w-28 bg-transparent text-xs focus:outline-none"
              />
            </div>
            <button
              type="submit"
              className="border-line bg-card hover:bg-bg-soft rounded-sm border px-3 py-1.5 text-xs"
            >
              검색
            </button>
          </form>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="micro mr-1">담당강사</span>
            <FilterSelect
              paramName="teacher"
              value={state.teacher || null}
              options={teacherNames.map((n) => ({ value: n, label: n }))}
              ariaLabel="담당강사 필터"
            />
          </div>
          <div className="flex items-center gap-1.5">
            <span className="micro mr-1">정렬</span>
            <FilterSelect
              paramName="sort"
              value={state.sort === "risk" ? null : state.sort}
              allLabel="위험도순"
              options={SORTS.filter((s) => s.value !== "risk")}
              ariaLabel="정렬"
            />
          </div>
          <span className="text-text-dim num ml-auto text-[11px]">{rows.length}명</span>
        </div>
      </div>

      <section className="bg-card border-line shadow-card overflow-hidden rounded-2xl border">
        <BoardList rows={rows} />
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  icon,
  color,
}: {
  label: string;
  value: number | string;
  icon: Parameters<typeof EyIcon>[0]["name"];
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
          <EyIcon name={icon} size={13} />
        </span>
      </header>
      <p className="tabular text-foreground mt-2 text-[26px] leading-none">{value}</p>
    </div>
  );
}
