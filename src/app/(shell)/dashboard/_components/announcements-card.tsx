/**
 * Announcements — 시안 사양: 키커 "공지" (amber mono) + 행별 pill + 시간 + 제목 + 작성자
 */
import { Pill, type PillColor } from "@/components/atoms/pill";
import type { AnnouncementRow } from "@/features/dashboard/server/queries";

const AUDIENCE_META: Record<string, { label: string; color: PillColor }> = {
  all: { label: "전체", color: "primary" },
  staff: { label: "직원", color: "blue" },
  teachers: { label: "강사", color: "gold" },
  counselors: { label: "상담", color: "rose" },
  accounting: { label: "회계", color: "purple" },
};

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diff = Math.max(0, now - then);
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "방금";
  if (mins < 60) return `${mins}분 전`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "어제";
  if (days < 7) return `${days}일 전`;
  return new Date(iso).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" });
}

export function AnnouncementsCard({ announcements }: { announcements: AnnouncementRow[] }) {
  return (
    <section className="bg-card border-line shadow-card flex h-full flex-col overflow-hidden rounded-2xl border">
      <header className="px-6 pt-5 pb-3">
        <p className="text-amber font-mono text-[11px] tracking-wider uppercase">공지</p>
        <h2 className="text-foreground mt-1 text-[17px] font-bold">최근 알림</h2>
      </header>

      {announcements.length === 0 ? (
        <div className="text-text-dim flex flex-1 items-center justify-center px-5 py-10 text-sm">
          등록된 공지가 없습니다
        </div>
      ) : (
        <ul className="divide-line flex-1 divide-y">
          {announcements.map((a) => {
            const meta = AUDIENCE_META[a.audience] ?? { label: a.audience, color: "neutral" as PillColor };
            return (
              <li key={a.id} className="px-6 py-3.5">
                <div className="flex items-start gap-3">
                  <Pill color={meta.color}>{meta.label}</Pill>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-foreground text-[13px] font-semibold leading-snug">
                      {a.title}
                    </h3>
                    <p className="text-text-dim mt-1 line-clamp-2 text-[12px] leading-relaxed">
                      {a.content}
                    </p>
                    <div className="text-text-faint mt-1.5 flex items-center gap-1.5 text-[11px]">
                      {a.authorName ? <span>{a.authorName}</span> : null}
                      <span className="opacity-60">·</span>
                      <span className="num">{relativeTime(a.createdAt)}</span>
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
