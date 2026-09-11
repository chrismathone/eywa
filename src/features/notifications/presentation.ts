import type { NotificationItem } from "./types";

export const REPEATED_ABSENCES_LINK = "/dashboard#repeated-absences";

/** 저장된 알림도 현재 화면 명칭·경로를 사용한다. 당시 학생·건수는 그대로 보존한다. */
export function presentNotification(item: NotificationItem): NotificationItem {
  if (item.type !== "absence_alert") return item;
  return {
    ...item,
    title: item.title.startsWith("담당")
      ? "담당 학생 반복 결석"
      : "반복 결석 학생",
    body:
      item.body
        ?.replace(
          / 학생이 최근 14일 (\d+)회 결석으로 반복 결석 위험입니다\./,
          " 학생 · 최근 14일 결석 $1회. 출결을 확인해 주세요.",
        )
        .replace(
          / (\d+)명이 반복 결석 위험 단계\(최근 14일 (\d+)회 이상\)에 도달했습니다\./,
          " 학생 $1명 · 최근 14일 결석 $2회 이상.",
        ) ?? null,
    link: item.link === "/retention" ? REPEATED_ABSENCES_LINK : item.link,
  };
}
