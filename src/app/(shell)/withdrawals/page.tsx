import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import {
  UserMinus,
  CalendarClock,
  ListChecks,
  Filter,
  AlertCircle,
  UserX,
} from "lucide-react";
import { WindowLink } from "@/components/workspace/window-link";
import { SearchForm } from "@/components/search-form";
import { Pill } from "@/components/atoms/pill";
import { EmptyState } from "@/components/empty-state";
import { FilterSelect } from "@/components/filter-select";
import { requireAccess } from "@/lib/auth/require-access";
import { relativeDayKo } from "@/lib/relative-time";
import {
  getWithdrawnStudents,
  getSubjectEndedStudents,
  REASON_LABEL,
  type WithdrawalReason,
  type SubjectEndedRow,
} from "@/features/withdrawals/server/queries";
import { Pagination } from "@/components/pagination";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { WithdrawalTrendChart, type WithdrawalMonthPoint } from "./_components/trend-chart";

export const metadata = { title: "퇴원관리 — eywa" };

const PAGE_SIZE = 50;

/** 퇴원 후 경과 일수(필터용 수치 — 표시는 relativeDayKo). withdrawn_at는 date 컬럼. */
function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
}

/** 퇴원 후 상담 시도 여부 — 3개 추적 플래그 중 하나라도 true면 "상담함"(재등록 평가용). */
function isConsulted(r: { metadata: { consultation?: { adminCalledParent: boolean; teacherCalledParent: boolean; talkedWithStudent: boolean } } | null }): boolean {
  const c = r.metadata?.consultation;
  return !!c && (c.adminCalledParent || c.teacherCalledParent || c.talkedWithStudent);
}

/** 최근 12개월 퇴원 추이(전체 기준) — 모듈 함수라 RSC 본문 아님(new Date 허용, #11). */
function monthlyWithdrawals(rows: { withdrawnAt: string | null }[]): WithdrawalMonthPoint[] {
  const now = new Date();
  const months: { key: string; point: WithdrawalMonthPoint }[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    months.push({ key, point: { label: `${d.getMonth() + 1}월`, count: 0 } });
  }
  const idx = new Map(months.map((m, i) => [m.key, i]));
  for (const r of rows) {
    if (!r.withdrawnAt) continue;
    const i = idx.get(r.withdrawnAt.slice(0, 7));
    if (i != null) months[i]!.point.count++;
  }
  return months.map((m) => m.point);
}

/** 과목별 퇴원 분포(전체 기준) 상위 N. 라벨은 학원설정(operations.subjects)에서 — labelOf 주입. */
function subjectBreakdown(
  rows: { lastClassSubject: string | null }[],
  labelOf: (key: string) => string,
  topN = 6,
): { label: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const s = r.lastClassSubject ?? "미상";
    counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([s, count]) => ({ label: s === "미상" ? "미상" : labelOf(s), count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, topN);
}

type RangeKey = "all" | "30d" | "90d" | "year";
type ReasonKey = "all" | WithdrawalReason | "unspecified";
type ConsultKey = "all" | "pending" | "done";

const RANGE_FILTERS: { key: RangeKey; label: string }[] = [
  { key: "all", label: "전체" },
  { key: "30d", label: "최근 30일" },
  { key: "90d", label: "최근 90일" },
  { key: "year", label: "올해" },
];

const CONSULT_FILTERS: { key: ConsultKey; label: string }[] = [
  { key: "all", label: "전체" },
  { key: "pending", label: "상담 미완료" },
  { key: "done", label: "상담 완료" },
];

type WdHrefParams = { range: RangeKey; reason: ReasonKey; q: string; subject: string; consult: ConsultKey };

function buildWdHref(p: WdHrefParams): string {
  const sp = new URLSearchParams();
  if (p.range !== "all") sp.set("range", p.range);
  if (p.reason !== "all") sp.set("reason", p.reason);
  if (p.subject !== "all") sp.set("subject", p.subject);
  if (p.consult !== "all") sp.set("consult", p.consult);
  if (p.q) sp.set("q", p.q);
  const s = sp.toString();
  return s ? `/withdrawals?${s}` : "/withdrawals";
}

export default async function WithdrawalsPage({
  searchParams,
}: {
  searchParams: Promise<{
    type?: string;
    range?: RangeKey;
    reason?: ReasonKey;
    q?: string;
    subject?: string;
    consult?: ConsultKey;
    page?: string;
  }>;
}) {
  await requireAccess("withdrawals");
  const sp = await searchParams;
  const viewType: "withdrawn" | "subject-ended" =
    sp.type === "subject-ended" ? "subject-ended" : "withdrawn";
  const range: RangeKey = (sp.range as RangeKey) ?? "all";
  const reason: ReasonKey = (sp.reason as ReasonKey) ?? "all";
  const subject = sp.subject ?? "all";
  const consult: ConsultKey = (sp.consult as ConsultKey) ?? "all";
  const q = sp.q ?? "";
  const page = Math.max(1, Number(sp.page) || 1);

  const [all, settings] = await Promise.all([getWithdrawnStudents(), getTenantSettings()]);
  // 과목 라벨은 학원설정(operations.subjects) 단일 소스 — 하드코딩 금지.
  const subjectMaps = buildSubjectMaps(settings.operations.subjects);
  // 수강종료 집계는 재원 전수 + enrollment 조회라 무거워, 해당 탭일 때만 계산.
  const subjectEnded = viewType === "subject-ended" ? await getSubjectEndedStudents() : [];
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
  if (subject !== "all") {
    rows = rows.filter((r) => r.lastClassSubject === subject);
  }
  if (consult !== "all") {
    rows = rows.filter((r) => (consult === "done" ? isConsulted(r) : !isConsulted(r)));
  }

  // 상담 미완료 worklist 집계(전체 기준) — 재등록 평가용 사후상담 추적.
  const consultPending = all.filter((r) => !isConsulted(r)).length;
  const consultRate = all.length ? Math.round(((all.length - consultPending) / all.length) * 100) : 0;

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

  // 통계(전체 기준) — 월별 추이 + 과목별 분포
  const trend = monthlyWithdrawals(all);
  const subjects = subjectBreakdown(all, subjectMaps.labelOf);
  const subjMax = subjects[0]?.count ?? 1;

  const reasonChips: { key: ReasonKey; label: string }[] = [
    { key: "all" as ReasonKey, label: "전체" },
    ...(Object.entries(REASON_LABEL) as [WithdrawalReason, string][]).map(([k, label]) => ({
      key: k as ReasonKey,
      label,
    })),
    { key: "unspecified" as ReasonKey, label: "미기재" },
  ];

  const current: WdHrefParams = { range, reason, q, subject, consult };
  const filterActive = range !== "all" || reason !== "all" || subject !== "all" || consult !== "all" || !!q;

  // 사유 분석·통계는 전체 필터 결과(rows) 기준 — 목록만 50행으로 슬라이스(billing 메모리 페이지네이션).
  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const pageHref = (p: number) => {
    const base = buildWdHref(current);
    if (p <= 1) return base;
    return base === "/withdrawals" ? `/withdrawals?page=${p}` : `${base}&page=${p}`;
  };

  return (
    <div className="space-y-4">
      {/* 유형 토글 — 퇴원(완전) / 수강종료(과목 이탈) */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="micro mr-1">유형</span>
        <Link
          href="/withdrawals"
          className={`shrink-0 rounded-sm border px-2.5 py-0.5 text-xs transition ${
            viewType === "withdrawn"
              ? "border-foreground bg-foreground text-background font-medium"
              : "border-line text-text-dim hover:text-foreground hover:bg-bg-soft"
          }`}
        >
          퇴원 <span className="num">({all.length})</span>
        </Link>
        <Link
          href="/withdrawals?type=subject-ended"
          className={`shrink-0 rounded-sm border px-2.5 py-0.5 text-xs transition ${
            viewType === "subject-ended"
              ? "border-amber bg-amber text-white font-medium"
              : "border-line text-text-dim hover:text-foreground hover:bg-bg-soft"
          }`}
        >
          수강종료{viewType === "subject-ended" ? <span className="num"> ({subjectEnded.length})</span> : null}
        </Link>
      </div>

      {viewType === "subject-ended" ? (
        <SubjectEndedView rows={subjectEnded} labelOf={subjectMaps.labelOf} />
      ) : (
        <>
      {/* Stat strip */}
      <section className="grid grid-cols-2 gap-3.5 sm:grid-cols-4">
        <Stat label="전체 퇴원" value={all.length} icon={UserMinus} color="rose" />
        <Stat label="최근 30일" value={recent} icon={CalendarClock} color="danger" />
        <Stat label="상담 미완료" value={consultPending} unit={`· ${consultRate}% 완료`} icon={ListChecks} color="amber" />
        <Stat label="필터 결과" value={rows.length} unit="명" icon={Filter} color="blue" />
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
          <SearchForm placeholder="학생명" defaultValue={q} resetParams={["type"]} />
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="flex items-center gap-1.5">
            <span className="micro mr-1">사유</span>
            <FilterSelect
              paramName="reason"
              value={reason === "all" ? null : reason}
              options={reasonChips.filter((f) => f.key !== "all").map((f) => ({ value: f.key, label: f.label }))}
              ariaLabel="사유 필터"
            />
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="micro mr-1">과목</span>
            {subjectMaps.filters.map((f) => (
              <Link
                key={f.value}
                href={buildWdHref({ ...current, subject: f.value })}
                className={`shrink-0 rounded-sm border px-2 py-0.5 text-xs transition ${
                  subject === f.value
                    ? "border-foreground bg-foreground text-background font-medium"
                    : "border-line text-text-dim hover:text-foreground hover:bg-bg-soft"
                }`}
              >
                {f.label}
              </Link>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="micro mr-1">상담</span>
            {CONSULT_FILTERS.map((f) => (
              <Link
                key={f.key}
                href={buildWdHref({ ...current, consult: f.key })}
                className={`shrink-0 rounded-sm border px-2 py-0.5 text-xs transition ${
                  consult === f.key
                    ? "border-amber bg-amber text-white font-medium"
                    : "border-line text-text-dim hover:text-foreground hover:bg-bg-soft"
                }`}
              >
                {f.label}
              </Link>
            ))}
          </div>
          {filterActive ? (
            <Link href="/withdrawals" className="text-text-faint hover:text-foreground text-xs underline">
              필터 초기화
            </Link>
          ) : null}
        </div>
      </div>

      {/* 통계(전체 기준) — 월별 추이 + 과목별 분포 */}
      {all.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.6fr_1fr]">
          <section className="bg-card border-line shadow-card rounded-2xl border p-5">
            <header className="mb-2 flex items-baseline justify-between">
              <h2 className="text-foreground text-[15px] font-bold">월별 퇴원 추이</h2>
              <span className="text-text-faint text-[11px]">최근 12개월 · 전체 {all.length}명</span>
            </header>
            <WithdrawalTrendChart data={trend} />
          </section>
          <section className="bg-card border-line shadow-card rounded-2xl border p-5">
            <header className="mb-3">
              <h2 className="text-foreground text-[15px] font-bold">과목별 분포</h2>
              <span className="text-text-faint text-[11px]">전체 기준</span>
            </header>
            <div className="space-y-3">
              {subjects.map((s) => (
                <div key={s.label}>
                  <div className="mb-1 flex items-baseline justify-between">
                    <span className="text-foreground text-[12px] font-semibold">{s.label}</span>
                    <span className="text-text-dim num text-[11px]">
                      <span className="text-foreground font-bold">{s.count}</span>명
                    </span>
                  </div>
                  <div className="bg-bg-soft h-2 overflow-hidden rounded-full">
                    <span className="bg-rose block h-full" style={{ width: `${(s.count / subjMax) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      ) : null}

      {rows.length === 0 ? (
        <EmptyState
          image="withdrawals"
          icon={() => <UserX size={32} strokeWidth={1.5} />}
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
                const ago = relativeDayKo(r.withdrawnAt);
                return (
                  <li key={r.id} className="hover:bg-bg-soft/50 px-5 py-3.5 transition">
                    <WindowLink href={`/withdrawals/${r.id}`} title={r.name} className="flex items-center gap-3">
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
                        {ago ? (
                          <p className="text-text-faint num text-[10px]">{ago}</p>
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
                  <AlertCircle size={13} strokeWidth={2} />
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
        </>
      )}
    </div>
  );
}

function SubjectEndedView({
  rows,
  labelOf,
}: {
  rows: SubjectEndedRow[];
  labelOf: (key: string) => string;
}) {
  if (rows.length === 0) {
    return (
      <EmptyState
        image="withdrawals"
        icon={() => <UserX size={32} strokeWidth={1.5} />}
        title="수강종료 학생이 없습니다"
        description="재원 중이지만 특정 과목을 모두 끊은 학생이 생기면 여기에 표시됩니다."
      />
    );
  }
  return (
    <section className="bg-card border-line shadow-card overflow-hidden rounded-2xl border">
      <header className="border-line flex items-baseline justify-between border-b px-5 py-4">
        <div>
          <p className="micro text-amber">과목 이탈 신호</p>
          <h2 className="text-foreground mt-1 text-[15px] font-bold">수강종료 학생</h2>
        </div>
        <p className="text-text-faint num text-[11px]">{rows.length}명</p>
      </header>
      <ul className="divide-line divide-y">
        {rows.map((r) => (
          <li key={r.id} className="hover:bg-bg-soft/50 px-5 py-3.5 transition">
            <WindowLink href={`/students/${r.id}`} title={r.name} className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-foreground text-[13px] font-bold hover:underline">
                  {r.name}{" "}
                  <span className="text-text-dim text-[11px] font-normal">
                    {r.grade ?? "—"} · {r.school ?? "—"}
                  </span>
                  {r.status === "on_hold" ? (
                    <span className="text-text-faint ml-1 text-[11px]">(휴원)</span>
                  ) : null}
                </p>
                <div className="mt-1.5 flex flex-wrap items-center gap-1">
                  <span className="text-text-faint mr-0.5 text-[10px]">종료</span>
                  {r.endedSubjects.map((s) => (
                    <Pill key={s} color="amber">
                      {labelOf(s)}
                    </Pill>
                  ))}
                  {r.activeSubjects.length > 0 ? (
                    <>
                      <span className="text-text-faint ml-1.5 mr-0.5 text-[10px]">수강중</span>
                      {r.activeSubjects.map((s) => (
                        <Pill key={s} color="primary" soft>
                          {labelOf(s)}
                        </Pill>
                      ))}
                    </>
                  ) : null}
                </div>
              </div>
              <div className="shrink-0 text-right">
                {r.primaryTeacherName ? (
                  <p className="text-text-dim text-[11px]">{r.primaryTeacherName} 강사</p>
                ) : null}
                {r.lastEndedAt ? (
                  <p className="text-text-faint num text-[10px]">{r.lastEndedAt} 종료</p>
                ) : null}
              </div>
            </WindowLink>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Stat({
  label,
  value,
  unit,
  icon: Icon,
  color,
}: {
  label: string;
  value: number | string;
  unit?: string;
  icon: LucideIcon;
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
          <Icon size={13} strokeWidth={2} />
        </span>
      </header>
      <p className="mt-2 flex items-baseline gap-1">
        <span className="tabular text-foreground text-[28px] leading-none">{value}</span>
        {unit ? <span className="text-text-dim text-xs">{unit}</span> : null}
      </p>
    </div>
  );
}
