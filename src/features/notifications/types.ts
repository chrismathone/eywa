// 알림 공용 타입/상수 — server-only 없음(클라 벨 컴포넌트도 import). 하드코딩 라벨은 여기 한 곳.

export type NotificationType =
  | "enrollment_assigned" // 내 반에 학생 배정
  | "enrollment_transferred_in" // 반이동으로 내 반에 전입
  | "teacher_handover"; // 강사 인수인계로 내가 새 담임 지정

export type NotificationItem = {
  id: string;
  type: NotificationType | string;
  title: string;
  body: string | null;
  link: string | null;
  read: boolean;
  createdAt: string;
};

/** 유형별 이모지(벨 목록 아이콘). 미등록 유형은 기본 🔔. */
export const NOTIFICATION_EMOJI: Record<string, string> = {
  enrollment_assigned: "🎒",
  enrollment_transferred_in: "🔁",
  teacher_handover: "🧑‍🏫",
};
