"use client";

import type { ComponentProps } from "react";
import { NotificationRow } from "@/features/notifications/components/notification-row";
import type { ReactionView } from "../reply-types";
import { useReactionControl } from "./reaction-control";

/**
 * 벨의 학부모 글·댓글 알림 한 줄 — 보통 알림 행에 **공감**(0319a) 조작을 얹는다: 버튼은 '답글 쓰기' 옆, 종류 고르기는 그 아래 줄.
 * 공감 기능이 없는 자리(`reaction` null — 0319a 전·옛 워커·기능 끔)는 보통 알림 행과 똑같다.
 */
export function ParentNotificationRow({ reaction, ...row }: ComponentProps<typeof NotificationRow> & { reaction: ReactionView | null }) {
  const { trigger, panel } = useReactionControl(reaction);
  return <NotificationRow {...row} actionSlot={trigger} belowSlot={panel} />;
}
