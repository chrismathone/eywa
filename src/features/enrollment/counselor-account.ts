// 상담자(글자 `counselor`)와 상담자 계정(`consultant_id`)은 같은 사실이다 — 한쪽만 바뀌면 화면(글자)과
// 후속 조치 할 일·알림(계정, 0441a · detectEnrollmentFollowup)이 갈린다([[#115]]).
// 2026-10-26 원장 제보: QR 접수 상담은 계정이 비고 처음 고친 직원 이름만 글자로 채워져(counselorAutofill) — 김성현 상담의
// 상담자는 '정유진'인데 할 일이 원장 전원 다섯 명에게 갔다(최근 60일 상담 40건 중 37건이 계정 빈칸).
// ⚠️ server-only 금지 — 순수 함수(Vitest 대상, [[#61]]).

/**
 * 이번 저장에서 상담자 계정을 어떻게 할지 — `undefined` = 손대지 않는다.
 * - 계정을 직접 고른 저장(목록 인라인 '상담사')은 그대로 둔다.
 * - 빈 상담자를 처음 고친 직원 이름으로 채웠으면(자동 채움) 계정이 비었을 때 그 사람으로.
 * - 상담자 글자를 고쳤으면 그 이름과 같은 재직 직원이 **딱 한 명**일 때만 그 사람으로(`resolved`) — 모르면 손대지 않는다(추측 금지).
 */
export function counselorAccountPatch(input: {
  beforeAccount: string | null | undefined;
  patch: Readonly<Record<string, unknown>>;
  autofilled: string | null;
  userId: string;
  resolved: string | null;
}): string | undefined {
  const { beforeAccount, patch, autofilled, userId, resolved } = input;
  if ("consultant_id" in patch) return undefined;
  if (autofilled) return beforeAccount ? undefined : userId;
  if ("counselor" in patch && resolved && resolved !== beforeAccount) return resolved;
  return undefined;
}
