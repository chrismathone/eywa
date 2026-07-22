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
  // 조회 실패 — '공지 없음'(사실 주장)과 구분(EnrollmentListCard 주석 참조).
  unavailable = false,
  // 카드와 관리 목록은 **별개 쿼리**라 한쪽만 실패할 수 있다 → 실패 표시도 각각.
  manageUnavailable = false,
}: {
  items: AnnouncementRow[];
  canManage?: boolean;
  manageItems?: ManageAnnouncementRow[];
  unavailable?: boolean;
  manageUnavailable?: boolean;
}) {
  return (
    <DashCard
      title="공지"
      action={
        canManage ? <AnnouncementsManager items={manageItems} unavailable={manageUnavailable} /> : undefined
      }
    >
      {unavailable ? (
        <DashEmpty>공지를 불러오지 못했습니다. 잠시 후 새로고침해 주세요.</DashEmpty>
      ) : items.length === 0 ? (
        <DashEmpty>등록된 공지가 없습니다</DashEmpty>
      ) : (
        <ul className="divide-border min-h-0 flex-1 divide-y overflow-y-auto">
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
