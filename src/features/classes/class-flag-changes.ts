/**
 * 반 수정 감사로그(`class_update`)의 **켜고 끄는 칸** 변경 항목 — 특강(0133a `is_special`) ·
 * 수업보고서 미발송(0174a `report_optout`). (순수 · Vitest)
 *
 * 🔴 2026-11-04 사고: 10-30에 JJ 반 전체를 한꺼번에 '수업보고서 미발송'으로 바꿨는데 그중 14반은 매주 보고서를
 *    보내던 반이었다(원스크린 보고서 칸 잠김 → 다음 날 ClassNote 정기 동기화가 반 보드 연결을 지움 → 보고서 발송 불가).
 *    그런데 반 수정 저장의 감사로그가 담임·강의실·반 이름·과목·배치만 비교해서 **누가 언제 켰는지 남지 않았다**.
 *
 * 모양은 다른 항목과 같다 — `{ field, from, to }`(감사 화면 describe.ts가 "수업보고서 미발송 꺼짐 → 켜짐"으로 읽는다).
 * ⚠️ **폼이 그 칸을 보냈을 때만** 비교한다(`isSpecialProvided`·`reportOptoutProvided` — actions.ts `readForm` 계약).
 *    안 보낸 폼은 그 칸을 저장하지도 않으므로(기존 값 유지) 변경으로 적으면 거짓 기록이 된다.
 * ⚠️ 변경 전 값을 못 읽었으면(`before` null) 아무것도 적지 않는다 — 담임·강의실 항목과 같은 규약(없는 이전값을 지어내지 않는다).
 *    이전 값이 비어 있으면(null·칸 없음) 꺼짐으로 본다 — 두 칸 모두 DB 기본값이 false다.
 */
import { REPORT_OPTOUT_LABEL } from "./report-optout";
import { SPECIAL_LECTURE_LABEL } from "./special-lecture";

/** 감사로그 `changes`의 한 항목(actions.ts `class_update`와 같은 모양). */
export type ClassAuditChange = { field: string; from?: string | null; to?: string | null };

/** 켜고 끄는 칸의 값 표기 — 감사 화면에 영문 `true`/`false`를 내보내지 않는다. */
export const FLAG_ON_LABEL = "켜짐";
export const FLAG_OFF_LABEL = "꺼짐";

const flagLabel = (on: boolean) => (on ? FLAG_ON_LABEL : FLAG_OFF_LABEL);

export function classFlagChanges(
  before: { is_special?: boolean | null; report_optout?: boolean | null } | null,
  input: {
    isSpecialProvided: boolean;
    isSpecial: boolean;
    reportOptoutProvided: boolean;
    reportOptout: boolean;
  },
): ClassAuditChange[] {
  if (!before) return [];
  const out: ClassAuditChange[] = [];
  const compare = (field: string, provided: boolean, prev: boolean | null | undefined, next: boolean) => {
    if (!provided) return;
    const was = prev === true;
    if (was === next) return;
    out.push({ field, from: flagLabel(was), to: flagLabel(next) });
  };
  compare(SPECIAL_LECTURE_LABEL, input.isSpecialProvided, before.is_special, input.isSpecial);
  compare(REPORT_OPTOUT_LABEL, input.reportOptoutProvided, before.report_optout, input.reportOptout);
  return out;
}
