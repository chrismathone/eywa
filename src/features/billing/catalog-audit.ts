/**
 * 교재 단가표(`textbook_catalog`) 변경의 **감사 기록 재료** — 어떤 칸이 무엇에서 무엇으로 바뀌었나(순수·Vitest).
 *
 * 원장 2026-10-08: '초6-1 발전 1권' 단가표가 22,500원인데 신청은 전부 21,000원 — 신청 금액은 스냅샷이라 맞는데,
 * **단가표를 누가 언제 바꿨는지**가 아무 데도 없었다(신청 쪽만 2026-09-09에 감사로그를 붙였다). → *"교재 목록 수정에 감사로그 붙여줘"*.
 * 형식은 교재 신청 감사([`textbook-audit.ts`](./textbook-audit.ts))와 같다 — 금액이 맨 앞, `칸 전 → 후`.
 */
import type { TextbookFieldChange } from "./textbook-audit";

export type CatalogAuditSnapshot = {
  title?: string | null;
  bookDetail?: string | null;
  gradeLevel?: string | null;
  subject?: string | null;
  publisher?: string | null;
  /** 원 단위. 숫자 컬럼이 문자열로 와도 숫자로 읽는다. */
  price?: number | string | null;
};

const EMPTY_MARK = "(없음)";

function moneyText(value: unknown): string {
  const text = String(value ?? "").replace(/[,\s원]/g, "");
  if (text === "") return EMPTY_MARK;
  const n = Number(text);
  return Number.isFinite(n) ? `${n.toLocaleString("ko-KR")}원` : EMPTY_MARK;
}

function plainText(value: unknown): string {
  const text = String(value ?? "").trim();
  return text === "" ? EMPTY_MARK : text;
}

/** 🔴 금액이 맨 앞 — "무엇이 문제였나"가 첫 줄에 보인다. 과목은 키(`math`)라 화면 라벨로 바꾼 값을 넘길 것. */
const FIELDS: readonly { key: keyof CatalogAuditSnapshot; label: string; format: (v: unknown) => string }[] = [
  { key: "price", label: "금액", format: moneyText },
  { key: "title", label: "교재명", format: plainText },
  { key: "bookDetail", label: "상세", format: plainText },
  { key: "gradeLevel", label: "학년", format: plainText },
  { key: "subject", label: "과목", format: plainText },
  { key: "publisher", label: "출판사", format: plainText },
];

/** 바뀐 칸만. `after`에 없는(undefined) 키는 안 바꾼 것이다. */
export function diffCatalogItem(before: CatalogAuditSnapshot, after: CatalogAuditSnapshot): TextbookFieldChange[] {
  const out: TextbookFieldChange[] = [];
  for (const f of FIELDS) {
    if (after[f.key] === undefined) continue;
    const from = f.format(before[f.key]);
    const to = f.format(after[f.key]);
    if (from !== to) out.push({ label: f.label, from, to });
  }
  return out;
}

/** 감사 대상 라벨 — "초6-1 발전 1권 (22개정)". */
export function catalogAuditTarget(s: CatalogAuditSnapshot): string {
  return String(s.title ?? "").trim() || "교재 단가표";
}
