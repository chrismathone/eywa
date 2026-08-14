/**
 * 결재선 검증·정규화 — 순수 함수(Vitest). 기안 폼이 보낸 결재선(순서 있는 결재자 배열)과
 * 참조자 배열을 서버 액션이 이 함수로 거른 뒤에만 행으로 만든다.
 *
 * 🔑 화면(결재선 편집기)도 같은 규칙으로 미리 막지만 **판정의 근거는 서버**다([[#77]]).
 */

/** 결재 단계 상한 — 하이웍스류도 실무 결재선은 3~4단계다. 폼 조작으로 수십 명을 못 넣게 막는다. */
export const MAX_APPROVAL_STEPS = 5;
export const MAX_REFS = 10;

/** 중복 제거(순서 보존) + 기안자 제거. 화면·서버가 공유하는 정규화. */
export function normalizeLine(drafterId: string, ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (!id || id === drafterId || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** 참조자 정규화 — 기안자·결재선에 이미 있는 사람은 뺀다(결재자는 어차피 문서를 본다). */
export function normalizeRefs(
  drafterId: string,
  approverIds: readonly string[],
  refIds: readonly string[],
): string[] {
  const approvers = new Set(approverIds);
  return normalizeLine(drafterId, refIds).filter((id) => !approvers.has(id));
}

/**
 * 결재선 검증 — 통과하면 null, 아니면 **한글 메시지**(화면에 그대로 띄운다).
 * `candidateIds` = 결재자로 고를 수 있는 사람(파일럿 동안은 파일럿 명단, 전사 개방 시 활성 직원).
 */
export function validateApprovalLine(args: {
  drafterId: string;
  approverIds: readonly string[];
  refIds?: readonly string[];
  candidateIds: readonly string[];
}): string | null {
  const { drafterId, refIds = [], candidateIds } = args;
  const approvers = normalizeLine(drafterId, args.approverIds);
  if (approvers.length === 0) return "결재선에 결재자를 1명 이상 지정하세요";
  if (approvers.length > MAX_APPROVAL_STEPS) {
    return `결재 단계는 최대 ${MAX_APPROVAL_STEPS}단계까지입니다`;
  }
  if (args.approverIds.includes(drafterId)) return "본인은 결재선에 넣을 수 없습니다";

  const pool = new Set(candidateIds);
  if (approvers.some((id) => !pool.has(id))) {
    return "결재자로 지정할 수 없는 사람이 포함돼 있습니다";
  }
  const refs = normalizeRefs(drafterId, approvers, refIds);
  if (refs.length > MAX_REFS) return `참조는 최대 ${MAX_REFS}명까지입니다`;
  if (refs.some((id) => !pool.has(id))) return "참조로 지정할 수 없는 사람이 포함돼 있습니다";
  return null;
}
