import Link from "next/link";
import { WindowLink } from "@/components/workspace/window-link";
import { EyIcon } from "@/components/icons/eywa-icons";
import { Pill, type PillColor } from "@/components/atoms/pill";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { requireAccess } from "@/lib/auth/require-access";
import {
  getMeetings,
  type MeetingProcessingStatus,
  type MeetingRow,
} from "@/features/meetings/server/queries";
import { NewMeetingTrigger } from "./_new-meeting-trigger";

export const metadata = { title: "회의록 — eywa" };

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
              <EyIcon name={isLive ? "pulse" : "rings"} size={16} />
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="text-foreground text-[15px] font-bold">{m.title}</h3>
                {m.hasAudio ? (
                  <span className="text-text-faint inline-flex items-center gap-1 text-[11px]">
                    <EyIcon name="dot" size={10} />
                    음성
                  </span>
                ) : null}
                {isLive ? (
                  <Pill color="danger" soft={false}>
                    LIVE
                  </Pill>
                ) : badge ? (
                  <Pill color={badge.color}>{badge.label}</Pill>
                ) : null}
              </div>
              <p className="text-text-dim num mt-0.5 text-[11px]">{formatHeldAt(m.heldAt)}</p>
            </div>
          </div>
          {m.authorName ? (
            <span className="text-text-dim text-xs">{m.authorName}</span>
          ) : null}
        </header>

        <p className="text-text-dim mt-3 line-clamp-2 text-[13px] leading-relaxed">{m.excerpt}</p>

        {m.attendees.length > 0 ? (
          <div className="text-text-faint mt-3 flex items-center gap-2 text-[11px]">
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
    const d = new Date(iso);
    const today = new Date();
    return d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth();
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
  searchParams: Promise<{ range?: RangeKey; status?: StatusKey; q?: string }>;
}) {
  await requireAccess("meetings");
  const sp = await searchParams;
  const range: RangeKey = (sp.range as RangeKey) ?? "all";
  const status: StatusKey = (sp.status as StatusKey) ?? "all";
  const q = sp.q ?? "";

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

  const completed = all.filter((m) => m.processingStatus === "completed").length;
  const inProgress = all.filter(
    (m) => m.processingStatus === "transcribing" || m.processingStatus === "analyzing",
  ).length;

  const current = { range, status, q };

  return (
    <div className="space-y-4">
      {/* Stat strip */}
      <section className="grid grid-cols-2 gap-3.5 sm:grid-cols-3">
        <Stat label="전체 회의" value={all.length} icon="rings" color="primary" />
        <Stat label="AI 분석 완료" value={completed} icon="sparkle" color="gold" />
        <Stat label="처리 중" value={inProgress} icon="pulse" color="rose" />
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
            <span className="micro mr-1">상태</span>
            {STATUS_FILTERS.map((f) => (
              <Link
                key={f.key}
                href={buildHref({ ...current, status: f.key })}
                className={`shrink-0 rounded-sm border px-2 py-0.5 text-xs transition ${
                  status === f.key
                    ? "border-primary bg-primary text-primary-foreground font-medium"
                    : "border-line text-text-dim hover:text-foreground hover:bg-bg-soft"
                }`}
              >
                {f.label}
              </Link>
            ))}
          </div>
          <form action="/meetings" method="get" className="ml-auto flex items-center gap-2">
            {range !== "all" ? <input type="hidden" name="range" value={range} /> : null}
            {status !== "all" ? <input type="hidden" name="status" value={status} /> : null}
            <div className="border-line bg-bg-soft text-text-dim flex items-center gap-2 rounded-sm border px-2.5 py-1.5">
              <EyIcon name="search" size={13} />
              <input
                type="search"
                name="q"
                defaultValue={q}
                placeholder="제목·참석자"
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
          결과 <span className="text-foreground font-bold">{meetings.length}</span>건
        </p>
        <NewMeetingTrigger />
      </div>

      {meetings.length === 0 ? (
        <EmptyState
          icon={() => <EyIcon name="rings" size={32} />}
          title="기록된 회의가 없습니다"
        />
      ) : (
        <ul className="space-y-2.5">
          {meetings.map((m) => (
            <MeetingItem key={m.id} m={m} />
          ))}
        </ul>
      )}
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
  value: number;
  icon: Parameters<typeof EyIcon>[0]["name"];
  color: "primary" | "gold" | "rose";
}) {
  const ICON_BG = {
    primary: "bg-primary-soft text-primary",
    gold: "bg-gold-soft text-gold",
    rose: "bg-rose-soft text-rose",
  } as const;
  return (
    <div className="bg-card border-line shadow-card rounded-2xl border p-4">
      <header className="flex items-center justify-between">
        <p className="micro">{label}</p>
        <span className={`flex size-[26px] items-center justify-center rounded-md ${ICON_BG[color]}`}>
          <EyIcon name={icon} size={13} />
        </span>
      </header>
      <p className="tabular text-foreground mt-2 text-[28px] leading-none">{value}</p>
    </div>
  );
}
