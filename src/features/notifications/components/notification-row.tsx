"use client";

import {
  Archive,
  RotateCcw,
  Trash2,
} from "@/components/icons/aywa-icon-compat";
import type { ReactNode } from "react";
import { EyIcon } from "@/components/icons/aywa-icons";
import { NOTIFICATION_ICON, type NotificationItem } from "../types";
import { TaskStateChip } from "@/features/staff-tasks/components/task-state-chip";

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
  onReply,
  replyCount = 0,
  actionSlot,
  belowSlot,
}: {
  item: NotificationItem;
  archived: boolean;
  onOpen: () => void;
  onArchive: () => void;
  onDelete: () => void;
  /** 학부모 글·댓글에 답글(0317a) — 쓸 수 있는 알림에만 온다(없으면 버튼 없음). */
  onReply?: () => void;
  /** 이미 달린 우리 답글 수 — 있으면 '답글 N'으로 쓰레드에 다시 들어간다. */
  replyCount?: number;
  /** 버튼 줄 맨 앞에 놓을 조작(학부모 글 공감 버튼, 0319a) — 없으면 아무것도 없다. */
  actionSlot?: ReactNode;
  /** 버튼 줄 아래 한 줄(공감 종류 고르기·사유) — 없으면 줄 자체가 없다. */
  belowSlot?: ReactNode;
}) {
  return (
    <div
      className={`group/item border-line/70 border-b last:border-b-0 ${item.read ? "" : "bg-primary-soft/40"}`}
    >
      <button
        type="button"
        onClick={onOpen}
        // 읽은 알림은 흐리게(원장 2026-10-29 *"읽은 알림은 약간 흐려져서 비활성화 느낌으로. 작동은 똑같지만"*) — 마우스를 올리면 또렷하게.
        className={`hover:bg-bg-soft focus-visible:outline-primary flex w-full items-start gap-2.5 px-3 pt-3 pb-1.5 text-left outline-offset-[-2px] transition ${item.read ? "opacity-55 group-hover/item:opacity-100" : ""}`}
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
            // 본문은 세 줄까지(원장 2026-11-02 *"너무 알림이 정신없음"*) — 전체는 눌러서 연 화면에서. 줄바꿈(요약 두 줄)은 살린다.
            // 눌러도 열 화면이 없는 알림(링크 없음 — 학생을 못 정한 학부모 출결 연락 등)은 자르지 않는다(나머지를 읽을 길이 없다).
            <span className={`text-text-dim mt-1 text-xs leading-relaxed whitespace-pre-line break-keep [overflow-wrap:anywhere] ${item.link ? "line-clamp-3" : "block"}`}>
              {item.body}
            </span>
          )}
        </span>
      </button>
      <div className="flex items-center justify-between pr-3 pb-2 pl-[42px]">
        <time
          className={`text-text-faint text-xs tabular-nums transition ${item.read ? "opacity-55 group-hover/item:opacity-100" : ""}`}
          dateTime={item.createdAt}
          title={new Date(item.createdAt).toLocaleString("ko-KR", {
            timeZone: "Asia/Seoul",
          })}
        >
          {relTime(item.createdAt)}
        </time>
        {/* 할 일 알림이면 지금 처리 상태(0377a — 원래 기록으로 판정된 값). */}
        {item.task ? <span className="mr-auto ml-2"><TaskStateChip state={item.task.state} total={item.task.total} remaining={item.task.remaining} /></span> : null}
        <div className="flex items-center gap-1">
          {actionSlot}
          {onReply ? (
            <button
              type="button"
              onClick={onReply}
              className="text-primary hover:bg-primary-soft focus-visible:outline-primary rounded-md px-2 py-1 text-xs font-bold"
            >
              {replyCount > 0 ? `답글 ${replyCount}` : "답글 쓰기"}
            </button>
          ) : null}
          {/* 보관 · 삭제는 카드에 마우스를 올렸을 때만(키보드 초점 · 터치 화면은 늘 보인다) — 카드마다 아이콘 둘이 늘 서 있으면 목록이 시끄럽다.
              숨은 동안은 눌리지도 않는다(터치 노트북에서 안 보이는 '삭제'를 탭하는 일 — 삭제는 되돌릴 수 없다). */}
          <span className="pointer-events-none flex items-center gap-1 opacity-0 transition group-hover/item:pointer-events-auto group-hover/item:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100">
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
          </span>
        </div>
      </div>
      {belowSlot ? <div className="pr-3 pb-2 pl-[42px]">{belowSlot}</div> : null}
    </div>
  );
}
