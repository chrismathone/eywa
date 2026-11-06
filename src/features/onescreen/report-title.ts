/**
 * 학부모 보고서 **제목**(날짜 뒤) — 단일 소스. /r·인쇄·원스크린 미리보기·ClassNote 캡처가 모두 이 함수로 만든다.
 *
 * - 특강 반 보고서 = 앞에 `[특강] `(원장 2026-09-30 *"대신 수업보고서 앞에 [특강] 수업보고서 로 별도 이름"* ·
 *   *"반 생성할때 '특강' 이면 보고서 미리보기에 [특강] 표시"*). 특강 판정은 수업목록 '구분' 열과 같은 `classKindMeta`
 *   (토글 또는 이름에 '특강') — 호출부가 그 결과를 `special`로 넘긴다. 새 컬럼 없음.
 * - 보강 접미사는 그대로(makeup-label.ts). 모든 학원에 적용(ClassNote 모듈과 무관 — 공유 링크로도 본다).
 * - **과목 보고서**(원장 2026-10-16 *"수업 보고서 라고 발송 되는걸 과목 보고서로. 수학이면 '수학 보고서'. 영어면 '영어 보고서'"*) —
 *   설정 제목이 비었거나 기본값("수업 보고서")이면 `과목 이름 + " 보고서"`. 원장이 설정에서 다른 제목을 정했으면 그 제목 그대로.
 *   과목을 모르면(옛 보고서 · 설정에 없는 과목) 기본값. 과목 이름은 호출부가 학원 설정으로 푼다(`subjectReportLabel`).
 */
import { makeupTitleSuffix, type MakeupShape } from "./makeup-label";

export const SPECIAL_TITLE_PREFIX = "[특강] ";
export const DEFAULT_REPORT_TITLE = "수업 보고서";

/**
 * SRS 보고서(JJ 양식) 제목 = **어휘 관리 보고서**(원장 2026-10-29 *"srs 보고서템플릿 jj반에서 보고서 나갈 경우 영어 보고서 → 어휘 관리 보고서"*).
 * 판정 = 글에 SRS 양식의 항목 제목(`단어 학습 현황` · `SRS 학습 결과`)이 있는가 — 보고서는 고른 템플릿 id를 따로 저장하지 않아서 글로 본다
 * (report-templates/defaults.ts `BUILTIN_JJ_SHEET_TEMPLATE`의 항목 제목과 글자까지 같아야 한다).
 */
export const SRS_REPORT_TITLE = "어휘 관리 보고서";

/**
 * EiE 보고서(일일·월간) 제목 = **EiE 보고서**(원장 2026-11-06 *"EIE 일일 월간 보고서면 영어 보고서 아니고 EIE 보고서로 변경"*).
 * 판정 = 글에 EiE 일일 양식의 '단어 테스트' 항목이 있는가(pilot-notes `isEieDailySections`). 월간 보고서는 시트 모양이라 한글 제목이 없다.
 */
export const EIE_REPORT_TITLE = "EiE 보고서";
const SRS_SECTION_TITLES = new Set(["단어 학습 현황", "SRS 학습 결과"]);
export function isSrsReportSections(sections: readonly { title: string }[] | null | undefined): boolean {
  return !!sections?.some((s) => SRS_SECTION_TITLES.has(s.title.trim()));
}

export function reportTitleText(
  baseTitle: string | null | undefined, r: MakeupShape & { special?: boolean; subjectLabel?: string | null },
): string {
  // 기본값과 같은지는 띄어쓰기를 빼고 본다("수업보고서"로 저장한 지점도 과목 보고서가 된다 · 리뷰 2026-10-16).
  const plain = (s: string) => s.replace(/\s+/g, "");
  const custom = baseTitle?.trim() && plain(baseTitle) !== plain(DEFAULT_REPORT_TITLE) ? baseTitle : null;
  const subject = r.subjectLabel?.trim();
  return `${r.special ? SPECIAL_TITLE_PREFIX : ""}${custom ?? (subject ? `${subject} 보고서` : DEFAULT_REPORT_TITLE)}${makeupTitleSuffix(r)}`;
}

/**
 * 제목에 쓸 과목 이름 — 학원 설정의 과목 이름(`labelOf`). 키가 없거나 설정에 없는 과목이라 키가 그대로 돌아오면 null
 * (학부모에게 `subject_7 보고서` 같은 내부 키가 나가지 않게 — 그때는 기본 제목).
 */
export function subjectReportLabel(labelOf: (key: string) => string, key: string | null | undefined): string | null {
  if (!key) return null;
  const label = labelOf(key).trim();
  return label && label !== key ? label : null;
}
