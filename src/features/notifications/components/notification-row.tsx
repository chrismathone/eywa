"use client";

import {
  Archive,
  RotateCcw,
  Trash2,
} from "@/components/icons/aywa-icon-compat";
import { EyIcon } from "@/components/icons/aywa-icons";
import { NOTIFICATION_ICON, type NotificationItem } from "../types";

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(diff)) return "";
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "방금";
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  const d = Math.floor(h / 24);
  return d < 7
    ? `${d}일 전`
    : new Date(iso).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" });
}

export function NotificationRow({
  item,
  archived,
  onOpen,
  onArchive,
  onDelete,
}: {
  item: NotificationItem;
  archived: boolean;
  onOpen: () => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className={`group/item border-line/70 border-b last:border-b-0 ${item.read ? "" : "bg-primary-soft/40"}`}
    >
      <button
        type="button"
        onClick={onOpen}
        className="hover:bg-bg-soft focus-visible:outline-primary flex w-full items-start gap-2.5 px-3 pt-3 pb-1.5 text-left outline-offset-[-2px] transition"
      >
        <span className="text-text-dim mt-0.5 flex size-5 shrink-0 items-center justify-center">
          <EyIcon name={NOTIFICATION_ICON[item.type] ?? "bell"} size={15} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-start gap-2">
            <span className="text-foreground text-xs leading-relaxed font-bold break-keep [overflow-wrap:anywhere]">
              {item.title}
            </span>
            {!item.read && (
              <span
                className="bg-primary mt-1.5 size-1.5 shrink-0 rounded-full"
                aria-label="안 읽음"
              />
            )}
          </span>
          {item.body && (
            <span className="text-text-dim mt-1 block text-xs leading-relaxed break-keep [overflow-wrap:anywhere]">
              {item.body}
            </span>
          )}
        </span>
      </button>
      <div className="flex items-center justify-between pr-3 pb-2 pl-[42px]">
        <time
          className="text-text-faint text-xs tabular-nums"
          dateTime={item.createdAt}
          title={new Date(item.createdAt).toLocaleString("ko-KR", {
            timeZone: "Asia/Seoul",
          })}
        >
          {relTime(item.createdAt)}
        </time>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onArchive}
            aria-label={`${item.title} ${archived ? "복원" : "보관"}`}
            title={archived ? "받은 알림으로 복원" : "보관"}
            className="text-text-dim hover:bg-line/60 hover:text-foreground focus-visible:outline-primary flex size-7 items-center justify-center rounded-md"
          >
            {archived ? (
              <RotateCcw className="size-3.5" />
            ) : (
              <Archive className="size-3.5" />
            )}
          </button>
          <button
            type="button"
            onClick={onDelete}
            aria-label={`${item.title} 삭제`}
            title="알림 삭제"
            className="text-text-dim hover:bg-danger-soft hover:text-danger focus-visible:outline-primary flex size-7 items-center justify-center rounded-md"
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
