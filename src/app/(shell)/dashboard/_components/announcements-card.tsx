/**
 * 공지 — 최근 공지 목록(고정 우선). 기존 미사용 쿼리(getRecentAnnouncements)를 펼침.
 */
import { Pill } from "@/components/atoms/pill";
import { relativeTimeKo } from "@/lib/relative-time";
import { DashCard, DashEmpty } from "./dash-card";
import { AnnouncementsManager } from "./announcements-manager";
import type {
  AnnouncementRow,
  ManageAnnouncementRow,
} from "@/features/dashboard/server/queries";

export function AnnouncementsCard({
  items,
  canManage = false,
  manageItems = [],
}: {
  items: AnnouncementRow[];
  canManage?: boolean;
  manageItems?: ManageAnnouncementRow[];
}) {
  return (
    <DashCard
      title="공지"
      action={canManage ? <AnnouncementsManager items={manageItems} /> : undefined}
    >
      {items.length === 0 ? (
        <DashEmpty>등록된 공지가 없습니다</DashEmpty>
      ) : (
        <ul className="divide-border flex-1 divide-y">
          {items.map((a) => (
            <li key={a.id} className="flex flex-col gap-0.5 py-2">
              <div className="flex items-center gap-1.5">
                {a.pinned ? <Pill color="gold">고정</Pill> : null}
                <span className="text-foreground truncate text-[13px] font-medium">{a.title}</span>
              </div>
              <p className="text-text-faint flex items-center gap-1.5 text-[11px]">
                <span>{relativeTimeKo(a.createdAt)}</span>
                {a.authorName ? <span>· {a.authorName}</span> : null}
              </p>
            </li>
          ))}
        </ul>
      )}
    </DashCard>
  );
}
