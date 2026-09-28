import type { SemanticTone } from "@/lib/design/semantic-color";

/**
 * 고객센터(0294a) 공용 타입·라벨 — 지점 화면(`/support`)과 슈퍼관리자 화면(`/super-admin/support`)이 같이 쓴다.
 * ⚠️ 순수 모듈(서버·클라 공용) — `server-only`·`"use client"` 금지([[#61]]·[[#81]]).
 */

/** 처리상태 — makeedu 개선요청과 같은 네 단계(접수 → 내용확인 → 처리중 → 완료). */
export const SUPPORT_STATUSES = ["received", "checking", "in_progress", "done"] as const;
export type SupportStatus = (typeof SUPPORT_STATUSES)[number];

export const SUPPORT_STATUS_META: Record<SupportStatus, { label: string; tone: SemanticTone }> = {
  received: { label: "접수", tone: "caution" },
  checking: { label: "내용확인", tone: "info" },
  in_progress: { label: "처리중", tone: "info" },
  done: { label: "완료", tone: "positive" },
};

export const SUPPORT_STATUS_OPTIONS = SUPPORT_STATUSES.map((value) => ({
  value,
  label: SUPPORT_STATUS_META[value].label,
}));

export function isSupportStatus(v: unknown): v is SupportStatus {
  return typeof v === "string" && (SUPPORT_STATUSES as readonly string[]).includes(v);
}

export function asSupportStatus(v: unknown): SupportStatus {
  return isSupportStatus(v) ? v : "received";
}

/**
 * 작성자는 **운영자가 한 번도 손대지 않은** 요청만 고친다 — 운영자가 읽기 시작한 글이 바뀌면 답이 엇나간다.
 * 🔴 지금 상태·답변 칸만 보면 안 된다: 상태를 '접수'로 되돌리거나 답을 지워도 잠금은 그대로다
 *    (원장 2026-09-28 *"잠궈둬"* · *"그것도 잠궈"*) — 표식 = `author_locked_at`(0296a 트리거가 한 번 찍고 안 지운다).
 * 작성자는 **지우지 못한다**(원장 2026-09-28 *"작성자가 지울 수 없게해"*) — 삭제 경로 자체가 없다.
 */
export function canAuthorEditRequest(status: SupportStatus, authorLocked: boolean): boolean {
  return status === "received" && !authorLocked;
}

export type SupportRequestListItem = {
  id: string;
  /** 목록 번호(No) — 지금 조건의 총 건수에서 역순. */
  no: number;
  title: string;
  status: SupportStatus;
  authorName: string;
  createdAt: string;
  dueDate: string | null;
  /** 슈퍼관리자 목록만 채운다. */
  tenantName?: string;
  /** 슈퍼관리자 목록만 — 글쓴이 역할 한글 라벨("원장"·"강사"). 동명이인·권한을 가르려고. */
  authorRole?: string;
};

export type SupportRequestDetail = {
  id: string;
  tenantId: string;
  title: string;
  body: string;
  contactPhone: string | null;
  contactEmail: string | null;
  status: SupportStatus;
  dueDate: string | null;
  answer: string | null;
  answeredAt: string | null;
  /** 운영자가 한 번이라도 손댔나(상태 변경·답변 — 되돌려도 true) — 작성자 수정 잠금 판정. */
  authorLocked: boolean;
  authorId: string;
  authorName: string;
  createdAt: string;
  tenantName?: string;
  /** 슈퍼관리자 상세만 — 글쓴이 역할 라벨·로그인 이메일(어느 계정이 썼는지). */
  authorRole?: string;
  authorEmail?: string;
};

export type SupportNoticeListItem = {
  id: string;
  title: string;
  pinned: boolean;
  createdAt: string;
};

export type SupportNoticeDetail = SupportNoticeListItem & { body: string };

/** 목록 조회 결과 — 표 부재·조회 실패면 `ready=false`(화면에 원문 금지 — raw는 title 툴팁). */
export type SupportList<T> = {
  ready: boolean;
  error?: { summary: string; raw: string };
  rows: T[];
  total: number;
};

/** 상세 조회 결과. */
export type SupportLoad<T> =
  | { ready: false; missingTable: boolean; error?: { summary: string; raw: string } }
  | { ready: true; item: T | null };
