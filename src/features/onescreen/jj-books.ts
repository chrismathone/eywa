/**
 * JJ 수업보고서의 **교재** — 원장 2026-10-27 *"jj수업보고서의 경우 교재는 인재원 ISM · 인재원 SRS · Listening (NTA)만 씀"*.
 * 순수 모듈(Vitest). 교재명 칸은 JJ 보고서 행에서만 이 셋을 고르는 칸이 된다(jj-book-picker.tsx).
 *
 * 🔑 판정은 **템플릿 id 하나** — 반 이름·과목으로 추측하지 않는다(강사가 JJ 수업보고서를 고른 행만).
 *    고르는 중인 템플릿(`pendingTemplateId`)이 있으면 그것이 이긴다(화면이 보여 주는 템플릿과 같은 순서).
 * 🔑 여러 권을 함께 쓴 날도 있어 **여러 개를 고를 수 있다** — 값은 ` · `로 이어 붙인 글자(교재 칸 그대로, 저장 경로 무변경).
 * ⚠️ 목록 밖 옛 값(손으로 적은 교재)은 지우지 않고 보여 준다 — 하나라도 다시 누르면 그때 목록 안 값만 남는다.
 */
import { BUILTIN_JJ_SHEET_TEMPLATE_ID } from "@/features/report-templates/defaults";

export const JJ_BOOKS = ["인재원 ISM", "인재원 SRS", "Listening (NTA)"] as const;
export type JjBook = (typeof JJ_BOOKS)[number];
export const JJ_BOOK_SEP = " · ";

export function isJjSheetReport(rep: { templateId?: string; pendingTemplateId?: string } | undefined | null): boolean {
  return (rep?.pendingTemplateId ?? rep?.templateId) === BUILTIN_JJ_SHEET_TEMPLATE_ID;
}

/**
 * 지금 글이 **JJ 수업보고서로 쓰인** 글인가 — 고르는 중인 템플릿(pending)은 보지 않는다(발송 조건은 실제로 나갈 글을 본다).
 * JJ 글은 사랑의 한마디가 **선택**이다(원장 2026-10-27 *"작성안하면 영역 삭제"*) — 다른 영어 글은 종전대로 필수.
 */
export function isJjSheetDraft(rep: { templateId?: string } | undefined | null): boolean {
  return rep?.templateId === BUILTIN_JJ_SHEET_TEMPLATE_ID;
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

/** 한 권을 켜고 끈다 — 결과는 목록 순서로(누른 순서가 아니라). 목록 밖 조각은 버린다. */
export function toggleJjBook(value: string | null | undefined, book: JjBook): string {
  const next = new Set<JjBook>(parseJjBooks(value).picked);
  if (next.has(book)) next.delete(book);
  else next.add(book);
  return JJ_BOOKS.filter((b) => next.has(b)).join(JJ_BOOK_SEP);
}
