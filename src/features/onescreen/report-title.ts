/**
 * 학부모 보고서 **제목**(날짜 뒤) — 단일 소스. /r·인쇄·원스크린 미리보기·ClassNote 캡처가 모두 이 함수로 만든다.
 *
 * - 특강 반 보고서 = 앞에 `[특강] `(원장 2026-09-30 *"대신 수업보고서 앞에 [특강] 수업보고서 로 별도 이름"* ·
 *   *"반 생성할때 '특강' 이면 보고서 미리보기에 [특강] 표시"*). 특강 판정은 수업목록 '구분' 열과 같은 `classKindMeta`
 *   (토글 또는 이름에 '특강') — 호출부가 그 결과를 `special`로 넘긴다. 새 컬럼 없음.
 * - 보강 접미사는 그대로(makeup-label.ts). 모든 학원에 적용(ClassNote 모듈과 무관 — 공유 링크로도 본다).
 */
import { makeupTitleSuffix, type MakeupShape } from "./makeup-label";

export const SPECIAL_TITLE_PREFIX = "[특강] ";
export const DEFAULT_REPORT_TITLE = "수업 보고서";

export function reportTitleText(baseTitle: string | null | undefined, r: MakeupShape & { special?: boolean }): string {
  return `${r.special ? SPECIAL_TITLE_PREFIX : ""}${baseTitle || DEFAULT_REPORT_TITLE}${makeupTitleSuffix(r)}`;
}
