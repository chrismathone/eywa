import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import {
  MessagesSquare,
  CalendarClock,
  BellRing,
  AlarmClock,
} from "lucide-react";
import { WindowLink } from "@/components/workspace/window-link";
import { EyIcon } from "@/components/icons/eywa-icons";
import { Pill, type PillColor } from "@/components/atoms/pill";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { requireAccess } from "@/lib/auth/require-access";
import { ConsultationTabs } from "./_components/consultation-tabs";
import {
  followUpUrgency,
  getStudentConsultationCounts,
  getStudentConsultationsPage,
  type FollowUpUrgency,
  type StudentConsultationCategory,
} from "@/features/consultations/server/queries";
import { Pagination } from "@/components/pagination";
import { NewConsultationTrigger } from "./_components/new-consultation-trigger";
import { ConsultationDeleteButton } from "./_components/consultation-delete-button";

export const metadata = { title: "학생상담 — eywa" };

const CATEGORY_META: Record<StudentConsultationCategory, { label: string; color: PillColor }> = {
  general: { label: "일반", color: "neutral" },
  academic: { label: "학습", color: "primary" },
  emotional: { label: "정서", color: "rose" },
  career: { label: "진로", color: "blue" },
  social: { label: "교우", color: "gold" },
  other: { label: "기타", color: "neutral" },
};

const URGENCY_META: Record<FollowUpUrgency, { label: string; color: PillColor } | null> = {
  done: { label: "완료", color: "primary" },
  overdue: { label: "지연", color: "danger" },
  today: { label: "오늘", color: "danger" },
  soon: { label: "3일 내", color: "amber" },
  later: { label: "예정", color: "blue" },
  none: null,
};

function relativeTime(iso: string): string {
  const diff = Math.max(0, Date.now() - new Date(iso).getTime());
  const days = Math.floor(diff / 86_400_000);
  if (days === 0) return "오늘";
  if (days === 1) return "어제";
  if (days < 7) return `${days}일 전`;
  return new Date(iso).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" });
}

type RangeKey = "all" | "7d" | "30d";
type CategoryKey = "all" | StudentConsultationCategory;
type UrgencyKey = "all" | "overdue" | "today" | "soon" | "later" | "done";

const RANGE_FILTERS: { key: RangeKey; label: string }[] = [
  { key: "all", label: "전체" },
  { key: "7d", label: "최근 7일" },
  { key: "30d", label: "최근 30일" },
];

const CATEGORY_FILTERS: { key: CategoryKey; label: string }[] = [
  { key: "all", label: "전체" },
  { key: "academic", label: "학습" },
  { key: "emotional", label: "정서" },
  { key: "career", label: "진로" },
  { key: "social", label: "교우" },
  { key: "general", label: "일반" },
  { key: "other", label: "기타" },
];

const URGENCY_FILTERS: { key: UrgencyKey; label: string }[] = [
  { key: "all", label: "전체" },
  { key: "overdue", label: "지연" },
  { key: "today", label: "오늘" },
  { key: "soon", label: "3일 내" },
  { key: "later", label: "예정" },
  { key: "done", label: "완료" },
];

function buildHref(p: { range: RangeKey; cat: CategoryKey; urg: UrgencyKey; q: string }): string {
  const sp = new URLSearchParams();
  if (p.range !== "all") sp.set("range", p.range);
  if (p.cat !== "all") sp.set("cat", p.cat);
  if (p.urg !== "all") sp.set("urg", p.urg);
  if (p.q) sp.set("q", p.q);
  const s = sp.toString();
  return s ? `/consultations?${s}` : "/consultations";
}

export default async function ConsultationsPage({
  searchParams,
}: {
  searchParams: Promise<{
    range?: RangeKey;
    cat?: CategoryKey;
    urg?: UrgencyKey;
    q?: string;
    page?: string;
  }>;
}) {
  await requireAccess("consultations");
  const sp = await searchParams;
  const range: RangeKey = (sp.range as RangeKey) ?? "all";
  const cat: CategoryKey = (sp.cat as CategoryKey) ?? "all";
  const urg: UrgencyKey = (sp.urg as UrgencyKey) ?? "all";
  const q = sp.q ?? "";
  const PAGE_SIZE = 50;
  const page = Math.max(1, Number(sp.page) || 1);

  const [{ rows: items, total }, counts] = await Promise.all([
    getStudentConsultationsPage({ q, range, cat, urg }, page, PAGE_SIZE),
    getStudentConsultationCounts(),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const { total: totalAll, lastWeek, pendingFollowUps, overdueFollowUps } = counts;

  const current = { range, cat, urg, q };

  // 현재 필터 보존 + page만 변경 (필터 chip은 buildHref라 page 자동 리셋)
  const pageHref = (p: number) => {
    const params = new URLSearchParams();
    if (range !== "all") params.set("range", range);
    if (cat !== "all") params.set("cat", cat);
    if (urg !== "all") params.set("urg", urg);
    if (q) params.set("q", q);
    if (p > 1) params.set("page", String(p));
    const s = params.toString();
    return s ? `/consultations?${s}` : "/consultations";
  };

  return (
    <div className="space-y-4">
      <ConsultationTabs active="student" />
      {/* Stat strip */}
      <section className="grid grid-cols-2 gap-3.5 sm:grid-cols-4">
        <Stat label="전체 상담" value={totalAll} icon={MessagesSquare} color="primary" />
        <Stat label="최근 7일" value={lastWeek} icon={CalendarClock} color="blue" />
        <Stat label="진행 중 후속" value={pendingFollowUps} icon={BellRing} color="gold" />
        <Stat label="지연 후속" value={overdueFollowUps} icon={AlarmClock} color="danger" />
      </section>

      {/* Filter bar */}
      <div className="bg-card border-line shadow-card space-y-3 rounded-md border px-4 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="micro mr-1">기간</span>
            {RANGE_FILTERS.map((f) => (
              <Link
                key={f.key}
                href={buildHref({ ...current, range: f.key })}
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
          <span className="bg-line h-4 w-px" aria-hidden />
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="micro mr-1">카테고리</span>
            {CATEGORY_FILTERS.map((f) => (
              <Link
                key={f.key}
                href={buildHref({ ...current, cat: f.key })}
                className={`shrink-0 rounded-sm border px-2 py-0.5 text-xs transition ${
                  cat === f.key
                    ? "border-primary bg-primary text-primary-foreground font-medium"
                    : "border-line text-text-dim hover:text-foreground hover:bg-bg-soft"
                }`}
              >
                {f.label}
              </Link>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="micro mr-1">후속</span>
            {URGENCY_FILTERS.map((f) => (
              <Link
                key={f.key}
                href={buildHref({ ...current, urg: f.key })}
                className={`shrink-0 rounded-sm border px-2 py-0.5 text-xs transition ${
                  urg === f.key
                    ? "border-foreground bg-foreground text-background font-medium"
                    : "border-line text-text-dim hover:text-foreground hover:bg-bg-soft"
                }`}
              >
                {f.label}
              </Link>
            ))}
          </div>
          <form action="/consultations" method="get" className="ml-auto flex items-center gap-2">
            {range !== "all" ? <input type="hidden" name="range" value={range} /> : null}
            {cat !== "all" ? <input type="hidden" name="cat" value={cat} /> : null}
            {urg !== "all" ? <input type="hidden" name="urg" value={urg} /> : null}
            <div className="border-line bg-bg-soft text-text-dim flex items-center gap-2 rounded-sm border px-2.5 py-1.5">
              <EyIcon name="search" size={13} />
              <input
                type="search"
                name="q"
                defaultValue={q}
                placeholder="학생명·요약"
                className="text-foreground placeholder:text-text-faint w-32 bg-transparent text-xs focus:outline-none"
              />
            </div>
            <Button type="submit" variant="outline" size="sm">
              검색
            </Button>
          </form>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <p className="micro">
          결과 <span className="text-foreground font-bold">{total}</span>건
          {totalPages > 1 ? (
            <span className="text-text-dim ml-2">
              {page}/{totalPages} 페이지
            </span>
          ) : null}
        </p>
        <div className="flex items-center gap-2">
          <WindowLink
            href="/consultations/stats"
            title="상담 통계"
            className="border-line text-text-dim hover:text-foreground hover:bg-bg-soft inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition"
          >
            <MessagesSquare size={13} strokeWidth={2} />
            통계 보기
          </WindowLink>
          <NewConsultationTrigger />
        </div>
      </div>

      {total === 0 ? (
        <EmptyState icon={() => <MessagesSquare size={32} strokeWidth={1.5} />} title="기록된 상담이 없습니다" />
      ) : (
        <>
        <ul className="space-y-2.5">
          {items.map((c) => {
            const urgency = URGENCY_META[followUpUrgency(c.followUpDate, c.followUpDone)];
            const cat = c.category ? CATEGORY_META[c.category] : null;
            const isUrgent =
              urgency &&
              (urgency.color === "danger" || urgency.color === "amber");
            return (
              <li
                key={c.id}
                className={`group shadow-card relative overflow-hidden rounded-2xl border p-5 transition hover:shadow-modal ${
                  isUrgent
                    ? "border-danger/30 bg-danger-soft hover:border-danger/50"
                    : "border-line bg-card hover:border-primary/40"
                }`}
              >
                {/* 카드 전체 클릭 → 상담 수정(stretched link). 내부 학생 이름 링크는 z-10로 위에 둠. */}
                <WindowLink
                  href={`/consultations/${c.id}/edit`}
                  title="상담 수정"
                  ariaLabel={`${c.studentName} 상담 수정`}
                  className="absolute inset-0 z-0"
                />
                <header className="relative flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <WindowLink
                          href={`/students/${c.studentId}`}
                          title={c.studentName}
                          className="text-foreground relative z-10 text-[15px] font-bold hover:underline"
                        >
                          {c.studentName}
                        </WindowLink>
                        {c.studentGrade ? (
                          <span className="text-text-dim text-xs">{c.studentGrade}</span>
                        ) : null}
                        {cat ? <Pill color={cat.color}>{cat.label}</Pill> : null}
                        {urgency ? <Pill color={urgency.color}>{urgency.label}</Pill> : null}
                      </div>
                      <p className="text-text-dim mt-0.5 text-[11px]">
                        {c.subject ? <span>{c.subject} · </span> : null}
                        {c.counselorName ? <span>{c.counselorName} 상담</span> : null}
                      </p>
                    </div>
                  </div>
                  <div className="text-text-dim relative z-10 flex items-center gap-3 text-xs">
                    <span className="num">{relativeTime(c.consultedAt)}</span>
                    <ConsultationDeleteButton id={c.id} studentId={c.studentId} label="" />
                  </div>
                </header>

                <p className="text-foreground mt-3 line-clamp-2 text-[13px] leading-relaxed">{c.summary}</p>

                {c.followUpAction || c.followUpDate ? (
                  <div className="border-line mt-3 flex items-center justify-between gap-2 border-t pt-3">
                    <p className="text-text-dim text-[11px]">
                      <span className="text-gold font-mono mr-2 font-bold tracking-wider uppercase">
                        Follow-up
                      </span>
                      {c.followUpAction ?? "—"}
                      {c.followUpDate ? (
                        <span className="num text-text-faint ml-2">· 기한 {c.followUpDate}</span>
                      ) : null}
                    </p>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
        <Pagination page={page} totalPages={totalPages} hrefForPage={pageHref} />
        </>
      )}
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
  value: number;
  icon: LucideIcon;
  color: "primary" | "blue" | "gold" | "danger";
}) {
  const ICON_BG = {
    primary: "bg-primary-soft text-primary",
    blue: "bg-blue-soft text-blue",
    gold: "bg-gold-soft text-gold",
    danger: "bg-danger-soft text-danger",
  } as const;
  return (
    <div className="bg-card border-line shadow-card rounded-2xl border p-4">
      <header className="flex items-center justify-between">
        <p className="micro">{label}</p>
        <span className={`flex size-[26px] items-center justify-center rounded-md ${ICON_BG[color]}`}>
          <Icon size={13} strokeWidth={2} />
        </span>
      </header>
      <p className="tabular text-foreground mt-2 text-[28px] leading-none">{value}</p>
    </div>
  );
}
