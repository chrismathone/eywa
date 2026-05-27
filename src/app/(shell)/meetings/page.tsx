import Link from "next/link";
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
      <Link href={`/meetings/${m.id}`} className="block p-5">
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
      </Link>
    </li>
  );
}

export default async function MeetingsPage() {
  await requireAccess("meetings");
  const meetings = await getMeetings();
  const completed = meetings.filter((m) => m.processingStatus === "completed").length;
  const inProgress = meetings.filter(
    (m) => m.processingStatus === "transcribing" || m.processingStatus === "analyzing",
  ).length;

  return (
    <div className="space-y-5">
      {/* Stat strip */}
      <section className="grid grid-cols-2 gap-3.5 sm:grid-cols-3">
        <Stat label="전체 회의" value={meetings.length} icon="rings" color="primary" />
        <Stat label="AI 분석 완료" value={completed} icon="sparkle" color="gold" />
        <Stat label="처리 중" value={inProgress} icon="pulse" color="rose" />
      </section>

      <div className="flex items-center justify-between">
        <div>
          <p className="micro">최근 회의록</p>
          <h2 className="text-foreground mt-0.5 text-[17px] font-bold">
            음성 녹음 → AI 분석
          </h2>
        </div>
        <Button render={<Link href="/meetings/new" />}>
          <EyIcon name="plus" size={13} className="mr-1" />
          새 회의록
        </Button>
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
