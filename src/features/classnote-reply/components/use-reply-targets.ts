"use client";

import { useEffect, useState } from "react";
import type { NotificationItem } from "@/features/notifications/types";
import { isParentMessageNotification } from "../notification-match";
import { getReplyTargetsForNotifications } from "../server/reply-actions";

/**
 * 벨이 열려 있을 때 — 학부모 글·댓글 알림 중 '답글 쓰기'를 달 수 있는 것(알림 id → 메시지 id).
 * 학부모 알림이 목록에 없으면 서버에 묻지 않는다(대부분의 벨 열기는 추가 왕복 0). 자격은 창을 열 때 서버가 본다.
 * 모듈 꺼짐·표 없음(0317a 전)·시험 대상 아님이면 빈 지도 = 버튼 없음.
 */
export function useReplyTargets(items: NotificationItem[], open: boolean): Record<string, string> {
  const key = open ? items.filter((n) => isParentMessageNotification(n.type)).map((n) => n.id).join(",") : "";
  const [map, setMap] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!key) return;
    let alive = true;
    getReplyTargetsForNotifications(key.split(","))
      .then((m) => {
        if (alive) setMap(m);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [key]);
  return key ? map : {};
}
