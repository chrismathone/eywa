import "server-only";
import { AUDIT_ACTIONS } from "@/features/audit/server/log";
import { buildActivityOptions, type ActivityOption } from "../activity-catalog";

/**
 * 활동(감사로그) 목록 — 라벨은 `AUDIT_ACTIONS`(server-only)에서. 화면엔 이 목록을 props로 내려준다.
 * ⚠️ log.ts → (poke) → dispatch → 여기 → log.ts 순환이 있어 **모듈 최상위에서 AUDIT_ACTIONS를 읽지 않는다**(함수 안에서만).
 */
const labels = () => AUDIT_ACTIONS as Readonly<Record<string, string>>;

export function activityOptions(): ActivityOption[] {
  return buildActivityOptions(labels());
}

export function activityKeySet(): Set<string> {
  return new Set(Object.keys(labels()));
}

export function activityLabel(key: string): string {
  return labels()[key] ?? "활동";
}
