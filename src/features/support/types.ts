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
 * 작성자는 '접수' 상태이고 **답변이 아직 없을 때만** 고치고 지운다 — 운영자가 읽기 시작한 글이 바뀌면 답이 엇나간다.
 * 🔴 상태만 보면 안 된다: 운영자는 '접수'로 둔 채 답변만 저장할 수 있다(그 뒤 본문이 바뀌면 답이 다른 질문에 붙는다).
 */
export function canAuthorEditRequest(status: SupportStatus, answer: string | null): boolean {
  return status === "received" && !answer;
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
  authorId: string;
  authorName: string;
  createdAt: string;
  tenantName?: string;
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
