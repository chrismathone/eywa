// ECS 저장 단위키·patch 계약 — 순수(Vitest). 클라 저장 큐(use-sheet-saves)와 서버 액션(flushSheetPatches)이
// 같은 타입·검증을 공유한다(#77 — 한쪽만 느슨하면 그게 우회 폭).
import { isPlanPatchField, type PlanPatchField } from "./plan-codec";

/** 계획 행 필드 CAS patch — saveKey = `${lineId}:${field}` (클라 상태기계의 키). */
export type PlanFieldPatch = {
  saveKey: string;
  lineId: string;
  field: PlanPatchField;
  /** CAS 기준값(그 필드의 마지막 canonical). null=비어 있었음. */
  expectedValue: string | null;
  newValue: string | null;
  /** 클라 단조증가 revision — 응답 도착 시 그보다 새 입력이 있으면 draft 유지 판정용. */
  clientRev: number;
};

export function buildSaveKey(lineId: string, field: PlanPatchField): string {
  return `${lineId}:${field}`;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * patch 배치 런타임 검증(서버 액션 진입 직후) — 형태·field allowlist·개수 상한.
 * ⚠️ "다른 반 행" 검증은 여기서 못 한다(DB 조회 필요) — 액션이 lineId들의 소속 class를 조회해
 * 배치 전체를 거부한다(mixed-class 금지). 여기는 순수 형태 게이트.
 */
export function validatePatchBatch(
  patches: unknown,
): { ok: true; patches: PlanFieldPatch[] } | { ok: false; error: string } {
  if (!Array.isArray(patches) || patches.length === 0) {
    return { ok: false, error: "저장할 변경이 없습니다" };
  }
  if (patches.length > 200) return { ok: false, error: "한 번에 저장할 수 있는 변경 수를 넘었습니다" };
  const out: PlanFieldPatch[] = [];
  for (const raw of patches) {
    if (typeof raw !== "object" || raw === null) return { ok: false, error: "잘못된 저장 요청입니다" };
    const p = raw as Record<string, unknown>;
    const lineId = p.lineId;
    const field = p.field;
    if (typeof lineId !== "string" || !UUID_RE.test(lineId)) {
      return { ok: false, error: "잘못된 저장 요청입니다(행 식별자)" };
    }
    if (typeof field !== "string" || !isPlanPatchField(field)) {
      return { ok: false, error: "허용되지 않는 항목입니다" };
    }
    const expectedValue = p.expectedValue;
    const newValue = p.newValue;
    if (expectedValue !== null && typeof expectedValue !== "string") {
      return { ok: false, error: "잘못된 저장 요청입니다(기준값)" };
    }
    if (newValue !== null && typeof newValue !== "string") {
      return { ok: false, error: "잘못된 저장 요청입니다(새 값)" };
    }
    if (typeof newValue === "string" && newValue.length > 500) {
      return { ok: false, error: "입력이 너무 깁니다(500자 이내)" };
    }
    const clientRev = typeof p.clientRev === "number" && Number.isFinite(p.clientRev) ? p.clientRev : 0;
    out.push({
      saveKey: typeof p.saveKey === "string" ? p.saveKey : buildSaveKey(lineId, field),
      lineId,
      field,
      expectedValue: expectedValue as string | null,
      newValue: newValue as string | null,
      clientRev,
    });
  }
  return { ok: true, patches: out };
}

/** patch 1건의 서버 처리 결과 — 클라 상태기계가 saveKey 단위로 소비. */
export type PatchResult =
  | { saveKey: string; status: "applied"; clientRev: number }
  /** 응답 유실 후 재전송 — 서버값이 이미 newValue(성공 취급, canonical 갱신만). */
  | { saveKey: string; status: "already_applied"; clientRev: number }
  /** 진짜 충돌 — 타인이 그 필드를 바꿈. 클라는 key pause + 사용자 선택(서버값/내 값). */
  | { saveKey: string; status: "conflict"; clientRev: number; serverValue: string | null }
  /** 행 자체가 사라짐(타인이 삭제) — 클라는 슬롯 재조회. */
  | { saveKey: string; status: "gone"; clientRev: number }
  | { saveKey: string; status: "error"; clientRev: number; error: string };
