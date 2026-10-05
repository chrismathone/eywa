import type { Access } from "@/lib/permissions";
import type { MakeupAction } from "./types";

const APPROVE: readonly MakeupAction[] = [
  "approve", "deny", "verify", "reverse", "waive", "adjust", "close", "configure",
];
/** 지점 전체 운영. 수기 시수 승인은 여기 넣지 않는다. */
const BRANCH: readonly MakeupAction[] = ["reconcile", "resolve_reconciliation"];
const OPS: readonly MakeupAction[] = [
  "intake", "assign", "reserve", "reschedule", "cancel", "participation", "submit", "hold", "resume", "link_legacy",
];
const ASSIGNED: readonly MakeupAction[] = ["participation", "submit", "reserve", "reschedule", "cancel"];
const DESK: readonly MakeupAction[] = ["intake", "reserve", "reschedule", "cancel", "participation"];

export type MakeupAssignment = {
  owner: boolean;
  teaching: boolean;
  conducting: boolean;
  desk: boolean;
};

export type MakeupPermissionInput = {
  role: string;
  access: Access;
  action: MakeupAction;
  assignment: MakeupAssignment;
  actorId: string;
  conductorId: string | null;
  /** 플랫폼 보호 계정. 화면 문구에는 드러내지 않는다. 자기검증은 여기서도 열지 않는다. */
  unrestricted?: boolean;
  /** 수기 시수 차이를 그대로 인정하는 결정. 원장·관리자만. */
  manualUnitsAcceptance?: boolean;
};

function has(list: readonly MakeupAction[], action: MakeupAction): boolean {
  return list.includes(action);
}

function assigned(input: MakeupPermissionInput): boolean {
  return input.assignment.owner || input.assignment.teaching || input.assignment.conducting;
}

/**
 * 화면 게이트다. 저장을 허용하는 쪽은 SQL `makeup_private.actor()` 다.
 * wide(메뉴 full)가 지점 전체 운영이고, privileged 는 그 중 원장·관리자다.
 * 매니저는 대사 실행과 운영 처리만. 승인·검증·수기 시수 인정은 privileged 만.
 * 실시한 사람의 자기검토는 계정 종류와 상관없이 거절한다.
 */
export function decideMakeupAction(input: MakeupPermissionInput): { ok: true } | { ok: false; error: string } {
  if (!input.actorId) return { ok: false, error: "로그인 정보가 없습니다" };
  const reviewing = input.action === "verify" || input.action === "resolve_reconciliation";
  if (reviewing && input.conductorId && input.actorId === input.conductorId) {
    return { ok: false, error: "실시한 사람이 같은 건을 검토할 수 없습니다" };
  }
  if (input.unrestricted) return { ok: true };
  if (input.access === "none" || input.access === "readonly") {
    return { ok: false, error: "이 보강 작업을 할 수 없습니다" };
  }
  const manager = input.role === "manager";
  const lead = input.role === "master" || input.role === "admin";
  if (input.manualUnitsAcceptance && !(input.access === "full" && lead)) {
    return { ok: false, error: "이 보강 작업을 할 수 없습니다" };
  }
  if (has(BRANCH, input.action)) {
    if (input.access === "full" && (manager || lead)) return { ok: true };
    return { ok: false, error: "이 보강 작업을 할 수 없습니다" };
  }
  if (input.access === "full" && lead && (has(APPROVE, input.action) || has(OPS, input.action))) return { ok: true };
  if ((input.access === "full" || input.access === "scoped") && manager && has(OPS, input.action)) return { ok: true };
  if (has(APPROVE, input.action)) return { ok: false, error: "이 보강 작업을 할 수 없습니다" };
  if (input.assignment.desk && has(DESK, input.action)) return { ok: true };
  if ((input.role === "teacher" || input.access === "scoped") && has(ASSIGNED, input.action) && assigned(input)) {
    return { ok: true };
  }
  if (assigned(input) && has(ASSIGNED, input.action)) return { ok: true };
  return { ok: false, error: "담당으로 배정된 보강만 처리할 수 있습니다" };
}
