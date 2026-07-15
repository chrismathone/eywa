import type { EywaIconName } from "@/components/icons/eywa-icons";

// 알림 공용 타입/상수 — server-only 없음(클라 벨 컴포넌트도 import). 하드코딩 라벨은 여기 한 곳.

export type NotificationType =
  | "enrollment_assigned" // 내 반에 학생 배정
  | "enrollment_transferred_in" // 반이동으로 내 반에 전입
  | "teacher_handover" // 강사 인수인계로 내가 새 담임 지정
  | "classnote_parent_post"; // 학부모가 ClassNote에 새 글 → 그 학생 담당 강사(연동 PC 워커가 insert)

export type NotificationItem = {
  id: string;
  type: NotificationType | string;
  title: string;
  body: string | null;
  link: string | null;
  read: boolean;
  createdAt: string;
};

/** 유형별 Eywa 아이콘. 미등록 유형은 벨 컴포넌트에서 기본 bell. */
export const NOTIFICATION_ICON: Record<string, EywaIconName> = {
  enrollment_assigned: "book",
  enrollment_transferred_in: "swap",
  teacher_handover: "userCheck",
  classnote_parent_post: "message",
};
