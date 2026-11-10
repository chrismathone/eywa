/**
 * JJ 수업보고서의 **교재** — 원장 2026-10-27 *"jj수업보고서의 경우 교재는 인재원 ISM · 인재원 SRS · Listening (NTA)만 씀"*.
 * 순수 모듈(Vitest). 교재명 칸은 JJ 보고서 행에서만 이 셋을 고르는 칸이 된다(jj-book-picker.tsx).
 *
 * 🔑 판정 = 기본 JJ 템플릿 id **또는 글이 SRS 양식**(`단어 학습 현황`·`SRS 학습 결과` 항목) — 반 이름·과목으로 추측하지 않는다.
 *    글 판정은 학부모 카드의 제목('어휘 관리 보고서')·'보고자' 칸과 **같은 함수**다(report-title.ts `isSrsReportSections`).
 *    원장 2026-10-30 *"jj 수업에 자꾸 jj교재말고 다른 교재들이 들어가는 애들이있대"* — 기본 SRS 템플릿을 복사해 만든 사용자 템플릿
 *    ('SRS 보고서 최하위권용')은 id가 달라 교재 거르기를 통째로 건너뛰었다(시트의 수업 교재까지 실려 발송됨).
 *    고르는 중인 템플릿(`pendingTemplateId`)이 있으면 그것이 이긴다(화면이 보여 주는 템플릿과 같은 순서) — 그 글은 아직 없어 id만 본다.
 * 🔑 여러 권을 함께 쓴 날도 있어 **여러 개를 고를 수 있다** — 값은 ` · `로 이어 붙인 글자(교재 칸 그대로, 저장 경로 무변경).
 * ⚠️ 목록 밖 옛 값(손으로 적은 교재)은 지우지 않고 보여 준다 — 하나라도 다시 누르면 그때 목록 안 값만 남는다.
 */
import { BUILTIN_JJ_SHEET_TEMPLATE_ID } from "@/features/report-templates/defaults";
import { parsePilotNotes } from "./pilot-notes";
import { isSrsReportSections } from "./report-title";

export const JJ_BOOKS = ["인재원 ISM", "인재원 SRS", "Listening (NTA)"] as const;
export type JjBook = (typeof JJ_BOOKS)[number];
export const JJ_BOOK_SEP = " · ";

/** 글이 SRS 양식인가 — 학부모 카드가 제목·'보고자' 칸을 정하는 판정 그대로(복사한 사용자 템플릿 글도 잡는다). */
export function isSrsDraftText(draft: string | null | undefined): boolean {
  return isSrsReportSections(parsePilotNotes(draft));
}

export function isJjSheetReport(
  rep: { templateId?: string; pendingTemplateId?: string; draft?: string } | undefined | null,
): boolean {
  if (rep?.pendingTemplateId) return rep.pendingTemplateId === BUILTIN_JJ_SHEET_TEMPLATE_ID;
  return rep?.templateId === BUILTIN_JJ_SHEET_TEMPLATE_ID || isSrsDraftText(rep?.draft);
}

/**
 * 지금 글이 **JJ 수업보고서로 쓰인** 글인가 — 고르는 중인 템플릿(pending)은 보지 않는다(발송 조건은 실제로 나갈 글을 본다).
 * JJ 글은 사랑의 한마디가 **선택**이다(원장 2026-10-27 *"작성안하면 영역 삭제"*) — 다른 영어 글은 종전대로 필수.
 */
export function isJjSheetDraft(rep: { templateId?: string | null; draft?: string | null } | undefined | null): boolean {
  return rep?.templateId === BUILTIN_JJ_SHEET_TEMPLATE_ID || isSrsDraftText(rep?.draft);
}

/**
 * 진도 없이 저장·발송할 수 있는 글인가 — SRS 보고서(JJ 글)는 진도 항목이 없다(원장 2026-11-05 *"srs보고서의 경우 진도 영역이 필요없자나 필수로 넣지말아줘"*).
 * 판정은 사랑의 한마디 선택(`isJjSheetDraft`)과 같다 — 영어 행 + 지금 글이 JJ 글.
 */
export function isProgressOptionalReport(
  subject: { subjectKey?: string | null },
  rep: { templateId?: string; draft?: string } | undefined | null,
): boolean {
  return subject.subjectKey === "english" && isJjSheetDraft(rep);
}

/** 교재 칸 값 → 고른 JJ 교재 / 목록 밖 조각. 구분은 ` · `·`,`·`/` 어느 것이든. */
export function parseJjBooks(value: string | null | undefined): { picked: JjBook[]; other: string[] } {
  const parts = (value ?? "")
    .split(/\s*(?:·|,|\/)\s*/)
    .map((p) => p.trim())
    .filter(Boolean);
  const known = new Set<string>(JJ_BOOKS);
  return { picked: JJ_BOOKS.filter((b) => parts.includes(b)), other: parts.filter((p) => !known.has(p)) };
}

/**
 * JJ 글에 **실을** 교재 — 세 권 중 고른 것만(목록 순서). 목록 밖 값은 버린다.
 * 🔑 교재 칸은 강사 시트(ECS)·직전 보고서의 교재로 미리 채워진다(roster.ts ③④) — JJ 행에도 그 반의 시트 교재가 들어와,
 *    그날 시트 교재가 마침 세 권 중 하나인 날만 맞게 나갔다(원장 2026-10-28 *"어떤날은 잘뜨고 대부분 이상하게"*).
 *    미리보기·저장(report-fields.ts)과 서버 저장(actions.ts)이 이 함수 하나로 거른다.
 */
export function jjBooksOnly(value: string | null | undefined): string {
  return parseJjBooks(value).picked.join(JJ_BOOK_SEP);
}

/** 한 권을 켜고 끈다 — 결과는 목록 순서로(누른 순서가 아니라). 목록 밖 조각은 버린다. */
export function toggleJjBook(value: string | null | undefined, book: JjBook): string {
  const next = new Set<JjBook>(parseJjBooks(value).picked);
  if (next.has(book)) next.delete(book);
  else next.add(book);
  return JJ_BOOKS.filter((b) => next.has(b)).join(JJ_BOOK_SEP);
}
