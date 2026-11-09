/**
 * 승인 진행의 **환불 줄**(원장 2026-11-06 *"환불건이 존재하면 여기에 '승인 진행'에 해당 환불 담당자도 추가되어 나오게"* ·
 * 시안 확인 *"이건 그냥 멘트 지워도 될듯. 그냥 관리자처럼 이름 직급만"*) — 목록 '승인 진행' 칸과 보고서 상세 결재란이 같이 쓴다(순수 판정).
 * 순서 = 관리자 → **환불 결정(원장)** → **데스크**. 같은 사람이 겹쳐도 단계마다 따로 둔다. 상태 설명('환불 결정 대기' 등)은 상태 칸 몫이다.
 * - 환불 결정: 결정 대기(DB 묶음 표시 `refund_hold` · 처리 전)면 '○ 받는 원장급'(관리자 줄과 같은 표기 — 모두 직급이 있으면 표시만,
 *   아니면 '원장 ' 머리말). 결정했으면 '✓ 결정한 원장' — '환불 없음'이면 흐리게, '환불 승인'이면 그대로 두고 데스크 줄이 잇는다.
 * - 데스크: 담당마다 한 줄 '○ 홍길동 대리' · 환불완료일자가 들어가면 '✓'. 퇴사·지운 담당은 '이전 담당자'.
 */
import { hasJobTitle, titledName, type RefundStep } from "./model";

export const FORMER_STAFF = "이전 담당자";
type Person = { name: string; jobTitle?: string | null };
/** 원장 결정 요약(DB `withdrawal_report_refund_decisions` — 묶음마다): 환불 승인이 하나라도 있으면 'refund', 아니면 'none' · 그 결정을 한 사람·시각. */
export type RefundOutcome = { outcome: "refund" | "none"; by: string | null; at: string };
export type ApprovalLine = { text: string; muted?: boolean };

/** 데스크 담당 표기 — 직급 이름(`titledName` · '홍길동 대리') · 퇴사(비활성)·지운 담당은 '이전 담당자'. */
export function deskLabel(s: Pick<RefundStep, "deskId" | "deskName" | "deskTitle" | "deskActive">): string {
  return !s.deskId || s.deskActive === false ? FORMER_STAFF : titledName({ name: s.deskName, jobTitle: s.deskTitle ?? null }, s.deskName);
}

/** 사람들의 표시 — 관리자 줄(`reviewers`)과 같은 규칙: 모두 직급이 있으면 '○ 설현 원장 · ○ …', 아니면 '원장 ○ 설현 · …'. 없으면 '원장'. */
function marks(people: readonly (Person | undefined)[], mark: "○" | "✓"): string {
  if (!people.length) return `${mark} 원장`;
  const text = people.map((p) => `${mark} ${titledName(p ? { name: p.name, jobTitle: p.jobTitle ?? null } : undefined, FORMER_STAFF)}`).join(" · ");
  return people.every((p) => p && hasJobTitle({ jobTitle: p.jobTitle ?? null })) ? text : `원장 ${text}`;
}

/**
 * 환불 줄 — `waiting` = 결정 대기(묶음 표시 · 처리 전) · `outcome` = 결정 요약 · `directors` = 받는 원장급(운영자 계정 제외 — 알림·할 일과 같은 명단) ·
 * `personOf` = 결정한 원장 찾기(없으면 '이전 담당자') · `steps` = 데스크 단계.
 */
export function refundApprovalLines(input: {
  waiting: boolean;
  outcome?: RefundOutcome | null;
  directors: readonly Person[];
  personOf: (id: string) => Person | undefined;
  steps: readonly RefundStep[];
  /** 요청이 취소됐다 — 완료 전 데스크 줄은 흐리게 '(요청 취소)'(기다리는 일처럼 보이지 않게 · 리뷰 r2 m14). */
  canceled?: boolean;
}): ApprovalLine[] {
  const decision: ApprovalLine[] = input.waiting
    ? [{ text: marks(input.directors, "○") }]
    : input.outcome
      ? [{ text: marks([input.outcome.by ? input.personOf(input.outcome.by) : undefined], "✓"), ...(input.outcome.outcome === "none" ? { muted: true } : {}) }]
      : [];
  const desk = input.steps.map((s): ApprovalLine => s.completedDate ? { text: `✓ ${deskLabel(s)}` }
    : input.canceled ? { text: `○ ${deskLabel(s)} (요청 취소)`, muted: true } : { text: `○ ${deskLabel(s)}` });
  return [...decision, ...desk];
}

/** 검색에 넣을 이름(보이는 표기 그대로 — '정유진 부원장'으로도 찾는다). */
export function refundApprovalNames(input: Parameters<typeof refundApprovalLines>[0]): string[] {
  return refundApprovalLines(input).map((l) => l.text.replace(/^원장 /, "").replace(/[○✓] /g, ""));
}
