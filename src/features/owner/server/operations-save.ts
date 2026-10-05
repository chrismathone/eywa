import "server-only";
import { createHash } from "node:crypto";
import {
  OPERATIONS_FACES,
  applyOperationsFace,
  applySubjectFields,
  operationsFaceCanonical,
  operationsFaceSnapshot,
  removeSubjectRow,
  subjectFieldsRequestSchema,
  subjectRemoveRequestSchema,
  type OperationsFace,
  type SubjectFieldsPatch,
} from "../operations-slice";
import { operationsSchema, type IntegrationGroupPresetSetting, type OperationsSettings } from "../settings-types";
import { normalizeSubjectFields } from "../subject-fields";
import type { SettingsIssue } from "../settings-error";

/**
 * 운영 섹션 저장 요청 — `saveOwnerSection`이 받는 형식은 이 넷뿐이다(없거나 모르는 값은 저장하지 않는다).
 *  · 두 면(`operations`·`subjects`): data = 운영 섹션 전체, 기준 token 필수. 그 면이 맡는 칸만 적용한다.
 *  · `subject-fields`: 시간표 쪽 서버 호출 — 한 과목의 시간표 칸만.
 *  · `subject-remove`: 과목 흡수·미사용 삭제 뒤 그 과목 행 제거.
 * 🔴 요청 형식은 권한 근거가 아니다 — 권한 검사는 호출부가 먼저 한다. token은 충돌을 알아채기 위한 값일 뿐이다.
 */
export type OperationsRequest =
  | { kind: "face"; face: OperationsFace; baseline: string }
  | { kind: "subject-fields"; subject: string; fields: SubjectFieldsPatch }
  | { kind: "subject-remove"; key: string };

export const STALE_FORM_ERROR = "화면이 오래되었습니다. 새로고침한 뒤 다시 저장해 주세요.";
export const CHANGED_ELSEWHERE_ERROR = "다른 창에서 이 설정이 변경되었습니다. 새로고침한 뒤 다시 저장해 주세요.";

/** 면의 기준 token — 표준 문자열의 해시(운영 체계 면에는 자리 PIN이 들어 있어 원문을 내보내지 않는다). */
export function operationsFaceToken(operations: OperationsSettings, face: OperationsFace): string {
  return createHash("sha256").update(operationsFaceCanonical(operations, face)).digest("hex");
}

export type OperationsFaceTokens = Record<OperationsFace, string>;
export function operationsFaceTokens(operations: OperationsSettings): OperationsFaceTokens {
  return { operations: operationsFaceToken(operations, "operations"), subjects: operationsFaceToken(operations, "subjects") };
}

/**
 * 저장 응답에 싣는 확정 상태 — 화면이 다음 저장의 기준으로 쓴다.
 *  · 과목 삭제: 그 면(과목 운영)의 값도 함께 돌려준다(화면이 값과 token을 한 쌍으로 받는다).
 *  · 시간표 칸 저장: 서버가 도장을 찍은 그 과목의 보관함을 돌려준다(화면엔 도장이 없다).
 */
export type OperationsReply = {
  tokens: OperationsFaceTokens;
  subjectsFace?: ReturnType<typeof operationsFaceSnapshot<"subjects">>;
  presets?: IntegrationGroupPresetSetting[];
};
export function operationsReply(saved: OperationsSettings, request: OperationsRequest): OperationsReply {
  return {
    tokens: operationsFaceTokens(saved),
    ...(request.kind === "subject-remove" ? { subjectsFace: operationsFaceSnapshot(saved, "subjects") } : {}),
    ...(request.kind === "subject-fields"
      ? { presets: saved.subjects.find((s) => s.key === request.subject)?.integrationGroupPresets ?? [] }
      : {}),
  };
}

export function readOperationsRequest(
  formData: FormData,
  parsedJson: unknown,
): { request: OperationsRequest } | { error: string } {
  const face = formData.get("operationsFace");
  if (typeof face !== "string") return { error: STALE_FORM_ERROR };
  if ((OPERATIONS_FACES as readonly string[]).includes(face)) {
    const baseline = formData.get("operationsBaseline");
    if (typeof baseline !== "string" || !baseline) return { error: STALE_FORM_ERROR };
    return { request: { kind: "face", face: face as OperationsFace, baseline } };
  }
  if (face === "subject-fields") {
    const parsed = subjectFieldsRequestSchema.safeParse(parsedJson);
    if (!parsed.success) return { error: "설정 요청 형식이 올바르지 않습니다" };
    return { request: { kind: "subject-fields", subject: parsed.data.subject, fields: parsed.data.fields } };
  }
  if (face === "subject-remove") {
    const parsed = subjectRemoveRequestSchema.safeParse(parsedJson);
    if (!parsed.success) return { error: "설정 요청 형식이 올바르지 않습니다" };
    return { request: { kind: "subject-remove", key: parsed.data.key } };
  }
  return { error: STALE_FORM_ERROR };
}

export type OperationsBuild =
  /** `issue` = 병합 결과의 검증 오류, `checked` = 그때 검사한 값(오류 문구가 그 줄의 이름을 찾는 데 쓴다). */
  | { error: string; issue?: SettingsIssue; checked?: unknown }
  /** 바꿀 것이 없다(이미 없는 과목 삭제) — 쓰지 않고 지금 상태를 돌려준다. */
  | { unchanged: true }
  /** `raw` = 병합 결과(저장 전 다듬기의 원 요청 자리), `parsed` = 스키마를 통과한 값. */
  | { raw: OperationsSettings; parsed: OperationsSettings };

/**
 * 요청을 **방금 읽은 값** 위에 적용하고 결과를 스키마로 다시 검증한다.
 * `incoming` = 두 면이 보낸(이미 스키마를 통과한) 운영 섹션 전체. `stamp` = 지금 저장하는 사람·시각(보관함 도장).
 */
export function buildOperationsSave(
  request: OperationsRequest,
  fresh: OperationsSettings,
  incoming: OperationsSettings | undefined,
  stamp: { by: string | undefined; at: string },
): OperationsBuild {
  let merged: OperationsSettings;
  if (request.kind === "face") {
    if (!incoming) return { error: STALE_FORM_ERROR };
    if (request.baseline !== operationsFaceToken(fresh, request.face)) return { error: CHANGED_ELSEWHERE_ERROR };
    merged = applyOperationsFace(fresh, incoming, request.face);
  } else if (request.kind === "subject-fields") {
    const freshSubject = fresh.subjects.find((s) => s.key === request.subject);
    if (!freshSubject) return { error: "학원 설정에 없는 과목입니다" };
    // 🔴 다듬기·보관함 도장은 여기서 정한다 — 요청이 실어 온 '누가·언제'는 믿지 않는다(subject-fields.ts).
    const applied = applySubjectFields(fresh, request.subject, normalizeSubjectFields(request.fields, freshSubject, stamp));
    if (!applied) return { error: "학원 설정에 없는 과목입니다" };
    merged = applied;
  } else {
    const { next, removed } = removeSubjectRow(fresh, request.key);
    if (!removed) return { unchanged: true };
    merged = next;
  }
  const parsed = operationsSchema.safeParse(merged);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    // 오류의 종류·한도까지 넘긴다 — 화면 문구가 "몇 자 이내" 같은 사유를 만든다(settings-error.ts).
    return { error: first?.message ?? "검증 실패", issue: first ? ({ ...first, path: [...first.path] } as SettingsIssue) : undefined, checked: merged };
  }
  return { raw: merged, parsed: parsed.data };
}
