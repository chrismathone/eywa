import Link from "next/link";
import { Mic, RefreshCw } from "@/components/icons/eywa-icon-compat";
import { WindowLink } from "@/components/workspace/window-link";
import { EditingBadge } from "@/features/presence/editing-badge";
import { EyIcon } from "@/components/icons/eywa-icons";
import { Pill, type PillColor } from "@/components/atoms/pill";
import { BigStat } from "@/components/atoms/big-stat";
import { PageHeader } from "@/components/page-header";
import { PhotoCard } from "@/components/atoms/photo-card";
import { SearchForm } from "@/components/search-form";
import { requireAccess } from "@/lib/auth/require-access";
import { kstMonth } from "@/lib/date-kst";
import {
  getMeetings,
  type MeetingProcessingStatus,
  type MeetingRow,
} from "@/features/meetings/server/queries";
import { NewMeetingTrigger } from "./_new-meeting-trigger";
import { Pagination } from "@/components/pagination";

export const metadata = { title: "회의록 — eywa" };

const PAGE_SIZE = 50;

const STATUS_META: Record<
  MeetingProcessingStatus,
  { label: string; color: PillColor } | null
> = {
  idle: null,
  uploaded: { label: "대기", color: "amber" },
  transcribing: { label: "전사 중", color: "blue" },
  analyzing: { label: "분석 중", color: "primary" },
  completed: { label: "완료", color: "primary" },
  failed: { label: "실패", color: "danger" },
};

function formatHeldAt(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
  });
}

function MeetingItem({ m }: { m: MeetingRow }) {
  const badge = STATUS_META[m.processingStatus];
  const isLive = m.processingStatus === "transcribing" || m.processingStatus === "analyzing";
  return (
    <li
      className={`shadow-card overflow-hidden rounded-2xl border transition ${
        isLive ? "border-danger/30 bg-danger-soft" : "border-line bg-card hover:bg-bg-soft/50"
      }`}
    >
      <WindowLink href={`/meetings/${m.id}`} title={m.title} className="block p-5">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span
              className={`flex size-[34px] shrink-0 items-center justify-center rounded-md ${
                isLive ? "bg-danger/15 text-danger" : "bg-primary-soft text-primary"
              }`}
            >
              {isLive ? (
                <RefreshCw size={16} strokeWidth={1.8} />
              ) : (
                <Mic size={16} strokeWidth={1.8} />
              )}
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="text-foreground text-[15px] font-bold">{m.title}</h3>
                <EditingBadge scope={`meeting:${m.id}`} />
                {m.hasAudio ? (
                  <span className="text-text-faint inline-flex items-center gap-1 text-[12px]">
                    <EyIcon name="dot" size={10} />
                    음성
                  </span>
                ) : null}
                {isLive ? (
                  <Pill color="danger" soft={false}>
                    진행 중
                  </Pill>
                ) : badge ? (
                  <Pill color={badge.color}>{badge.label}</Pill>
                ) : null}
              </div>
              <p className="text-text-dim num mt-0.5 text-[12px]">{formatHeldAt(m.heldAt)}</p>
            </div>
          </div>
          {m.authorName ? (
            <span className="text-text-dim text-xs">{m.authorName}</span>
          ) : null}
        </header>

        <p
          title={m.summaryFull ?? undefined}
          className={`text-text-dim mt-3 line-clamp-2 text-[13px] leading-relaxed ${
            m.summaryFull ? "cursor-help" : ""
          }`}
        >
          {m.excerpt}
        </p>

        {m.attendees.length > 0 ? (
          <div className="text-text-faint mt-3 flex items-center gap-2 text-[12px]">
            <span className="num font-bold">{m.attendees.length}명</span>
            <span className="opacity-60">·</span>
            <span className="truncate">{m.attendees.join(", ")}</span>
          </div>
        ) : null}
      </WindowLink>
    </li>
  );
}

type RangeKey = "all" | "7d" | "30d" | "month";
type StatusKey = "all" | "completed" | "processing" | "failed" | "idle";

const RANGE_FILTERS: { key: RangeKey; label: string }[] = [
  { key: "all", label: "전체" },
  { key: "7d", label: "최근 7일" },
  { key: "30d", label: "최근 30일" },
  { key: "month", label: "이번 달" },
];

const STATUS_FILTERS: { key: StatusKey; label: string }[] = [
  { key: "all", label: "전체" },
  { key: "completed", label: "완료" },
  { key: "processing", label: "처리 중" },
  { key: "failed", label: "실패" },
  { key: "idle", label: "수동" },
];

function inRange(iso: string, key: RangeKey): boolean {
  if (key === "all") return true;
  const then = new Date(iso).getTime();
  const now = Date.now();
  if (key === "7d") return now - then <= 7 * 86_400_000;
  if (key === "30d") return now - then <= 30 * 86_400_000;
  if (key === "month") {
    return kstMonth(new Date(iso)) === kstMonth();
  }
  return true;
}

function matchStatus(s: MeetingProcessingStatus, key: StatusKey): boolean {
  if (key === "all") return true;
  if (key === "completed") return s === "completed";
  if (key === "processing")
    return s === "transcribing" || s === "analyzing" || s === "uploaded";
  if (key === "failed") return s === "failed";
  if (key === "idle") return s === "idle";
  return true;
}

function buildHref(params: { range: RangeKey; status: StatusKey; q: string }): string {
  const sp = new URLSearchParams();
  if (params.range !== "all") sp.set("range", params.range);
  if (params.status !== "all") sp.set("status", params.status);
  if (params.q) sp.set("q", params.q);
  const s = sp.toString();
  return s ? `/meetings?${s}` : "/meetings";
}

export default async function MeetingsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: RangeKey; status?: StatusKey; q?: string; page?: string }>;
}) {
  await requireAccess("meetings");
  const sp = await searchParams;
  const range: RangeKey = (sp.range as RangeKey) ?? "all";
  const status: StatusKey = (sp.status as StatusKey) ?? "all";
  const q = sp.q ?? "";
  const page = Math.max(1, Number(sp.page) || 1);

  // 회의는 모집단이 모더릿(수백)하고 필터(다중 상태·참석자 jsonb·상대기간)가 SQL로 옮기기 까다로워,
  // 수납 페이지와 같은 메모리 페이지네이션을 쓴다(전건 fetch는 기존과 동일 — 렌더만 50행으로 캡).
  const all = await getMeetings();
  let meetings = all;
  if (q) {
    const term = q.toLowerCase();
    meetings = meetings.filter(
      (m) =>
        m.title.toLowerCase().includes(term) ||
        m.attendees.some((a) => a.toLowerCase().includes(term)),
    );
  }
  meetings = meetings.filter((m) => inRange(m.heldAt, range));
  meetings = meetings.filter((m) => matchStatus(m.processingStatus, status));

  const total = meetings.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const rows = meetings.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const completed = all.filter((m) => m.processingStatus === "completed").length;
  const inProgress = all.filter(
    (m) => m.processingStatus === "transcribing" || m.processingStatus === "analyzing",
  ).length;

  const current = { range, status, q };
  // 필터(buildHref)는 page를 안 실어 자동 1페이지 리셋. pageHref만 p>1에서 page= 세팅.
  const pageHref = (p: number) => {
    const params = new URLSearchParams();
    if (range !== "all") params.set("range", range);
    if (status !== "all") params.set("status", status);
    if (q) params.set("q", q);
    if (p > 1) params.set("page", String(p));
    const s = params.toString();
    return s ? `/meetings?${s}` : "/meetings";
  };

  return (
    <div className="space-y-5">
      {/* Editorial 문법 ① — eyebrow→헤드라인→서브 */}
      <PageHeader
        eyebrow="운영"
        title="회의록"
        description="녹음하면 전사와 AI 분석까지 자동으로 정리됩니다"
      />

      {/* Stat strip — Editorial 문법 ②(BigStat 공용 아톰) */}
      <section className="grid grid-cols-2 gap-3.5 sm:grid-cols-3">
        <BigStat label="전체 회의" value={all.length} unit="건" tone="primary" icon={<Mic size={16} strokeWidth={1.8} />} />
        <BigStat label="AI 분석 완료" value={completed} unit="건" tone="gold" icon={<EyIcon name="sparkle" size={16} />} />
        <BigStat label="처리 중" value={inProgress} unit="건" tone="rose" icon={<RefreshCw size={16} strokeWidth={1.8} />} />
      </section>

      {/* Filter bar */}
      <div className="bg-card shadow-card space-y-3 rounded-2xl px-4 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="micro mr-1">기간</span>
            {RANGE_FILTERS.map((f) => (
              <Link
                key={f.key}
                href={buildHref({ ...current, range: f.key })}
                className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs transition ${
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
            <span className="micro mr-1">상태</span>
            {STATUS_FILTERS.map((f) => (
              <Link
                key={f.key}
                href={buildHref({ ...current, status: f.key })}
                className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs transition ${
                  status === f.key
                    ? "border-primary bg-primary text-primary-foreground font-medium"
                    : "border-line text-text-dim hover:text-foreground hover:bg-bg-soft"
                }`}
              >
                {f.label}
              </Link>
            ))}
          </div>
          <SearchForm placeholder="제목·참석자" defaultValue={q} />
        </div>
      </div>

      <div className="flex items-center justify-between">
        <p className="micro">
          결과 <span className="text-foreground font-bold">{total}</span>건
          {totalPages > 1 ? (
            <span className="text-text-faint ml-2 normal-case">
              · {page}/{totalPages} 페이지
            </span>
          ) : null}
        </p>
        <NewMeetingTrigger />
      </div>

      {total === 0 ? (
        <div className="mx-auto max-w-xl py-4">
          <PhotoCard
            src="/photos/meetings-hero.webp"
            alt=""
            caption="기록된 회의가 없습니다"
            sub="녹음을 올리면 전사와 AI 분석이 자동으로 정리됩니다"
            aspect="3/2"
            sizes="(max-width: 768px) 100vw, 576px"
          />
        </div>
      ) : (
        <>
          <ul className="space-y-2.5">
            {rows.map((m) => (
              <MeetingItem key={m.id} m={m} />
            ))}
          </ul>
          <Pagination page={page} totalPages={totalPages} hrefForPage={pageHref} />
        </>
      )}
    </div>
  );
}
