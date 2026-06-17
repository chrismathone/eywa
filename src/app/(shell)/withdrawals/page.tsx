import Link from "next/link";
import { WindowLink } from "@/components/workspace/window-link";
import { EyIcon } from "@/components/icons/eywa-icons";
import { Pill } from "@/components/atoms/pill";
import { Initial } from "@/components/atoms/initial";
import { EmptyState } from "@/components/empty-state";
import { FilterSelect } from "@/components/filter-select";
import { requireAccess } from "@/lib/auth/require-access";
import {
  getWithdrawnStudents,
  REASON_LABEL,
  type WithdrawalReason,
} from "@/features/withdrawals/server/queries";
import { Pagination } from "@/components/pagination";

export const metadata = { title: "퇴원관리 — eywa" };

const PAGE_SIZE = 50;

function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  const now = Date.now();
  return Math.max(0, Math.floor((now - then) / 86_400_000));
}

type RangeKey = "all" | "30d" | "90d" | "year";
type ReasonKey = "all" | WithdrawalReason | "unspecified";

const RANGE_FILTERS: { key: RangeKey; label: string }[] = [
  { key: "all", label: "전체" },
  { key: "30d", label: "최근 30일" },
  { key: "90d", label: "최근 90일" },
  { key: "year", label: "올해" },
];

function buildWdHref(p: { range: RangeKey; reason: ReasonKey; q: string }): string {
  const sp = new URLSearchParams();
  if (p.range !== "all") sp.set("range", p.range);
  if (p.reason !== "all") sp.set("reason", p.reason);
  if (p.q) sp.set("q", p.q);
  const s = sp.toString();
  return s ? `/withdrawals?${s}` : "/withdrawals";
}

export default async function WithdrawalsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: RangeKey; reason?: ReasonKey; q?: string; page?: string }>;
}) {
  await requireAccess("withdrawals");
  const sp = await searchParams;
  const range: RangeKey = (sp.range as RangeKey) ?? "all";
  const reason: ReasonKey = (sp.reason as ReasonKey) ?? "all";
  const q = sp.q ?? "";
  const page = Math.max(1, Number(sp.page) || 1);

  const all = await getWithdrawnStudents();
  let rows = all;
  if (q) {
    const term = q.toLowerCase();
    rows = rows.filter((r) => r.name.toLowerCase().includes(term));
  }
  if (range !== "all") {
    const days = range === "30d" ? 30 : range === "90d" ? 90 : 365;
    rows = rows.filter((r) => {
      const since = daysSince(r.withdrawnAt);
      return since !== null && since <= days;
    });
  }
  if (reason !== "all") {
    rows = rows.filter((r) => {
      const k = r.metadata?.reason ?? "unspecified";
      return k === reason;
    });
  }

  // 사유 통계 (필터 후 결과 기준)
  const reasonCounts = new Map<string, number>();
  for (const r of rows) {
    const key =
      (r.metadata?.reason
        ? REASON_LABEL[r.metadata.reason as WithdrawalReason]
        : r.withdrawalReason) ?? "미기재";
    reasonCounts.set(key, (reasonCounts.get(key) ?? 0) + 1);
  }
  const topReasons = Array.from(reasonCounts.entries()).sort((a, b) => b[1] - a[1]);
  const maxCount = topReasons[0]?.[1] ?? 1;

  // 최근 30일 (전체 기준)
  const recent = all.filter((r) => {
    const d = daysSince(r.withdrawnAt);
    return d !== null && d <= 30;
  }).length;

  const reasonChips: { key: ReasonKey; label: string }[] = [
    { key: "all" as ReasonKey, label: "전체" },
    ...(Object.entries(REASON_LABEL) as [WithdrawalReason, string][]).map(([k, label]) => ({
      key: k as ReasonKey,
      label,
    })),
    { key: "unspecified" as ReasonKey, label: "미기재" },
  ];

  const current = { range, reason, q };

  // 사유 분석·통계는 전체 필터 결과(rows) 기준 — 목록만 50행으로 슬라이스(billing 메모리 페이지네이션).
  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const pageHref = (p: number) => {
    const params = new URLSearchParams();
    if (range !== "all") params.set("range", range);
    if (reason !== "all") params.set("reason", reason);
    if (q) params.set("q", q);
    if (p > 1) params.set("page", String(p));
    const s = params.toString();
    return s ? `/withdrawals?${s}` : "/withdrawals";
  };

  return (
    <div className="space-y-4">
      {/* Stat strip */}
      <section className="grid grid-cols-2 gap-3.5 sm:grid-cols-4">
        <Stat label="전체 퇴원" value={all.length} icon="falling" color="rose" />
        <Stat label="최근 30일" value={recent} icon="pulse" color="danger" />
        <Stat label="주요 사유" value={topReasons.length} unit="가지" icon="branch" color="amber" />
        <Stat label="필터 결과" value={rows.length} unit="명" icon="rings" color="blue" />
      </section>

      {/* Filter bar */}
      <div className="bg-card border-line shadow-card space-y-3 rounded-md border px-4 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="micro mr-1">기간</span>
            {RANGE_FILTERS.map((f) => (
              <Link
                key={f.key}
                href={buildWdHref({ ...current, range: f.key })}
                className={`shrink-0 rounded-sm border px-2 py-0.5 text-xs transition ${
                  range === f.key
                    ? "border-foreground bg-foreground text-background font-medium"
                    : "border-line text-text-dim hover:text-foreground hover:bg-bg-soft"
                }`}
              >
                {f.label}
              </Link>
            ))}
          </div>
          <form action="/withdrawals" method="get" className="ml-auto flex items-center gap-2">
            {range !== "all" ? <input type="hidden" name="range" value={range} /> : null}
            {reason !== "all" ? <input type="hidden" name="reason" value={reason} /> : null}
            <div className="border-line bg-bg-soft text-text-dim flex items-center gap-2 rounded-sm border px-2.5 py-1.5">
              <EyIcon name="search" size={13} />
              <input
                type="search"
                name="q"
                defaultValue={q}
                placeholder="학생명"
                className="text-foreground placeholder:text-text-faint w-32 bg-transparent text-xs focus:outline-none"
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
        <div className="flex items-center gap-1.5">
          <span className="micro mr-1">사유</span>
          <FilterSelect
            paramName="reason"
            value={reason === "all" ? null : reason}
            options={reasonChips.filter((f) => f.key !== "all").map((f) => ({ value: f.key, label: f.label }))}
            ariaLabel="사유 필터"
          />
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={() => <EyIcon name="falling" size={32} />}
          title="퇴원 학생이 없습니다"
          description="퇴원 처리된 학생이 생기면 이곳에 표시됩니다."
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.4fr_1fr]">
          {/* 최근 퇴원 리스트 */}
          <section className="bg-card border-line shadow-card overflow-hidden rounded-2xl border">
            <header className="border-line flex items-baseline justify-between border-b px-5 py-4">
              <div>
                <p className="micro">최근 퇴원</p>
                <h2 className="text-foreground mt-1 text-[15px] font-bold">학생 명단</h2>
              </div>
              <p className="text-text-faint num text-[11px]">
                {total}명{totalPages > 1 ? ` · ${page}/${totalPages}` : ""}
              </p>
            </header>
            <ul className="divide-line divide-y">
              {pageRows.map((r) => {
                const ago = daysSince(r.withdrawnAt);
                return (
                  <li key={r.id} className="hover:bg-bg-soft/50 px-5 py-3.5 transition">
                    <WindowLink href={`/withdrawals/${r.id}`} title={r.name} className="flex items-center gap-3">
                      <Initial name={r.name} color="rose" size="md" />
                      <div className="min-w-0 flex-1">
                        <p className="text-foreground text-[13px] font-bold hover:underline">
                          {r.name}{" "}
                          <span className="text-text-dim text-[11px] font-normal">
                            {r.grade ?? "—"} · {r.school ?? "—"}
                          </span>
                        </p>
                        <p className="text-text-dim mt-0.5 text-[11px]">
                          {r.lastClassName ?? "수강 반 없음"}
                          {r.primaryTeacherName ? <> · {r.primaryTeacherName} 강사</> : null}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-foreground num text-[11px] font-semibold">
                          {r.withdrawnAt ?? "—"}
                        </p>
                        {ago !== null ? (
                          <p className="text-text-faint num text-[10px]">{ago}일 전</p>
                        ) : null}
                      </div>
                    </WindowLink>
                  </li>
                );
              })}
            </ul>
            {totalPages > 1 ? (
              <div className="border-line border-t px-5 py-3">
                <Pagination page={page} totalPages={totalPages} hrefForPage={pageHref} />
              </div>
            ) : null}
          </section>

          {/* 사유 분석 */}
          <section className="bg-card border-line shadow-card overflow-hidden rounded-2xl border">
            <header className="border-line border-b px-5 py-4">
              <p className="micro text-amber">사유 분석</p>
              <h2 className="text-foreground mt-1 text-[15px] font-bold">상위 퇴원 사유</h2>
            </header>
            <div className="space-y-3 p-5">
              {topReasons.map(([reason, count]) => {
                const pct = (count / maxCount) * 100;
                return (
                  <div key={reason}>
                    <div className="mb-1 flex items-baseline justify-between">
                      <span className="text-foreground text-[12px] font-semibold">{reason}</span>
                      <span className="text-text-dim num text-[11px]">
                        <span className="text-foreground font-bold">{count}</span>명 ·{" "}
                        {((count / rows.length) * 100).toFixed(0)}%
                      </span>
                    </div>
                    <div className="bg-bg-soft h-2 overflow-hidden rounded-full">
                      <span
                        className="bg-rose block h-full"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
            {/* 규칙 기반 자동 요약 (LLM 아님) — sparkle(AI 마커) 대신 pulse로 라이브 AI와 구분 */}
            <div className="border-line bg-amber-soft border-t px-5 py-4">
              <div className="flex items-start gap-2.5">
                <span className="bg-amber/15 text-amber flex size-7 shrink-0 items-center justify-center rounded-md">
                  <EyIcon name="pulse" size={13} />
                </span>
                <div>
                  <p className="text-amber font-mono text-[10px] font-bold tracking-wider uppercase">
                    자동 요약
                  </p>
                  <p className="text-foreground mt-0.5 text-[12px] leading-relaxed">
                    {topReasons[0]
                      ? `현재 가장 빈번한 퇴원 사유는 "${topReasons[0][0]}"입니다. 추세 모니터링과 사전 상담 강화를 고려해 보세요.`
                      : "퇴원 사유가 등록되면 인사이트가 표시됩니다."}
                  </p>
                </div>
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  unit,
  icon,
  color,
}: {
  label: string;
  value: number | string;
  unit?: string;
  icon: Parameters<typeof EyIcon>[0]["name"];
  color: "primary" | "rose" | "amber" | "danger" | "blue";
}) {
  const ICON_BG = {
    primary: "bg-primary-soft text-primary",
    rose: "bg-rose-soft text-rose",
    amber: "bg-amber-soft text-amber",
    danger: "bg-danger-soft text-danger",
    blue: "bg-blue-soft text-blue",
  } as const;
  return (
    <div className="bg-card border-line shadow-card rounded-2xl border p-4">
      <header className="flex items-center justify-between">
        <p className="micro truncate">{label}</p>
        <span className={`flex size-[26px] shrink-0 items-center justify-center rounded-md ${ICON_BG[color]}`}>
          <EyIcon name={icon} size={13} />
        </span>
      </header>
      <p className="mt-2 flex items-baseline gap-1">
        <span className="tabular text-foreground text-[28px] leading-none">{value}</span>
        {unit ? <span className="text-text-dim text-xs">{unit}</span> : null}
      </p>
    </div>
  );
}
