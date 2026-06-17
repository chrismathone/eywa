/**
 * 공지 — 최근 공지 목록(고정 우선). 기존 미사용 쿼리(getRecentAnnouncements)를 펼침.
 */
import { Pill } from "@/components/atoms/pill";
import { DashCard, DashEmpty } from "./dash-card";
import type { AnnouncementRow } from "@/features/dashboard/server/queries";

/** 모듈 함수라 RSC 본문이 아님 → react-hooks/purity 무관(new Date 허용). */
function relDay(iso: string): string {
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days <= 0) return "오늘";
  if (days === 1) return "어제";
  if (days < 7) return `${days}일 전`;
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export function AnnouncementsCard({ items }: { items: AnnouncementRow[] }) {
  return (
    <DashCard title="공지">
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
                <span>{relDay(a.createdAt)}</span>
                {a.authorName ? <span>· {a.authorName}</span> : null}
              </p>
            </li>
          ))}
        </ul>
      )}
    </DashCard>
  );
}
