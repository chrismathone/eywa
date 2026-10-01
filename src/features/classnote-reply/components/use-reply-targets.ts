"use client";

import { useEffect, useState } from "react";
import type { NotificationItem } from "@/features/notifications/types";
import { isParentMessageNotification } from "../notification-match";
import type { ReplyTargets } from "../reply-types";
import { getReplyTargetsForNotifications } from "../server/reply-actions";

const NONE: ReplyTargets = { targets: {}, reactions: null, vague: [] };

/**
 * 벨이 열려 있을 때 — 학부모 글·댓글 알림 중 '답글 쓰기'·'공감'을 달 수 있는 것(알림 id → 메시지 id)과 그 메시지의 공감 상태.
 * 학부모 알림이 목록에 없으면 서버에 묻지 않는다(대부분의 벨 열기는 추가 왕복 0). 자격은 서버가 본다.
 * 기능 끔(학원 설정)·모듈 꺼짐·표 없음(0317a 전)·시험 대상 아님·자격 없음이면 빈 지도 = 버튼 없음. 공감 표가 없거나 옛 워커면 `reactions`가 null.
 */
export function useReplyTargets(items: NotificationItem[], open: boolean): ReplyTargets {
  const key = open ? items.filter((n) => isParentMessageNotification(n.type)).map((n) => n.id).join(",") : "";
  const [state, setState] = useState<ReplyTargets>(NONE);
  useEffect(() => {
    if (!key) return;
    let alive = true;
    getReplyTargetsForNotifications(key.split(","))
      .then((m) => {
        if (alive) setState(m);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [key]);
  return key ? state : NONE;
}
