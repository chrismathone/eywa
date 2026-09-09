/**
 * 교재 신청 변경의 **감사 기록 재료** — 어떤 칸이 무엇에서 무엇으로 바뀌었나(순수·Vitest).
 *
 * 원장 2026-09-09: 단가표 23,500원짜리 교재가 신청서엔 22,500원으로 적혀 있었는데 *"범인 찾기가 실패하네"* ·
 * *"이거 전부 다 감사로그에 남겨 — 금액 수정같은거"*. 그때까지 `textbook_orders`를 바꾸는 경로 일곱은
 * **감사로그를 한 줄도 안 남겼다** — 누가 금액을 고쳤는지 되짚을 방법이 아예 없었다.
 *
 * 🔴 **금액은 단가표를 따라가지 않는다**(스냅샷) — 단가가 오르면 지난 신청 금액이 소급해 바뀌면 안 되기
 *    때문이다. 그래서 "왜 다른가"의 답은 **누가 언제 고쳤나**뿐이고, 그걸 남기는 게 이 모듈이다.
 * ⚠️ 학생 기록 전수 감사(2026-08-18, `student_*`)와 같은 결 — 표시 문자열은 [`describe.ts`](../audit/describe.ts)가
 *    이 모듈의 `changes`로 만든다(감사 화면에 raw 컬럼명이 새지 않게).
 */

export type TextbookAuditSnapshot = {
  studentName?: string | null;
  teacherName?: string | null;
  bookName?: string | null;
  bookDetail?: string | null;
  /** 원 단위. 문자열로 와도(숫자 컬럼의 PostgREST 응답) 숫자로 읽는다. */
  price?: number | string | null;
  requestDate?: string | null;
  notes?: string | null;
};

export type TextbookFieldChange = {
  /** 사람이 읽는 칸 이름 — 감사 화면에 그대로 나간다(raw 컬럼명 금지). */
  label: string;
  from: string;
  to: string;
};

const EMPTY_MARK = "(없음)";

function moneyText(value: unknown): string {
  // 🔴 빈 값을 0원으로 읽지 말 것 — "금액이 없던 칸"과 "0원이던 칸"은 다른 사실이다.
  const text = String(value ?? "").replace(/[,\s원]/g, "");
  if (text === "") return EMPTY_MARK;
  const n = Number(text);
  if (!Number.isFinite(n)) return EMPTY_MARK;
  return `${n.toLocaleString("ko-KR")}원`;
}

function plainText(value: unknown): string {
  const text = String(value ?? "").trim();
  return text === "" ? EMPTY_MARK : text;
}

/** 🔴 라벨을 바꿔도 순서는 유지 — 금액이 맨 앞이라야 "무엇이 문제였나"가 첫 줄에 보인다. */
const FIELDS: readonly { key: keyof TextbookAuditSnapshot; label: string; format: (v: unknown) => string }[] = [
  { key: "price", label: "금액", format: moneyText },
  { key: "bookName", label: "교재명", format: plainText },
  { key: "bookDetail", label: "상세", format: plainText },
  { key: "studentName", label: "학생", format: plainText },
  { key: "teacherName", label: "담당", format: plainText },
  { key: "requestDate", label: "신청일", format: plainText },
  { key: "notes", label: "메모", format: plainText },
];

/**
 * 바뀐 칸만 추린다.
 * ⚠️ **`after`에 없는 키는 "안 바꾼 것"**이다(undefined) — 폼이 안 보낸 칸을 `(없음)`으로 지웠다고 적으면
 *    거짓 기록이 된다. 반대로 `null`·빈 문자열은 **비운 것**이라 기록한다.
 */
export function diffTextbookOrder(
  before: TextbookAuditSnapshot,
  after: TextbookAuditSnapshot,
): TextbookFieldChange[] {
  const changes: TextbookFieldChange[] = [];
  for (const field of FIELDS) {
    if (!(field.key in after) || after[field.key] === undefined) continue;
    const from = field.format(before[field.key]);
    const to = field.format(after[field.key]);
    if (from === to) continue;
    changes.push({ label: field.label, from, to });
  }
  return changes;
}

/** "금액 22,500원 → 23,500원 · 교재명 …" — 감사 목록 한 줄. */
export function describeTextbookChanges(
  changes: readonly TextbookFieldChange[] | null | undefined,
  max = 3,
): string | null {
  if (!changes || changes.length === 0) return null;
  const head = changes.slice(0, max).map((c) => `${c.label} ${c.from} → ${c.to}`);
  return changes.length > max ? `${head.join(" · ")} 외 ${changes.length - max}` : head.join(" · ");
}

/** "정하운 · 초5-2 발전 2권 (22개정)" — 감사 로그의 대상 라벨. */
export function textbookAuditTarget(snapshot: TextbookAuditSnapshot): string {
  const parts = [snapshot.studentName, snapshot.bookName]
    .map((part) => String(part ?? "").trim())
    .filter((part) => part !== "");
  return parts.length > 0 ? parts.join(" · ") : "교재 신청";
}

/** 체크 항목(등록·주문·납부) 라벨 — 감사 기록과 화면이 같은 글자를 쓴다. */
export const TEXTBOOK_CHECK_LABEL: Readonly<Record<string, string>> = {
  registered: "등록",
  ordered: "주문",
  paid: "납부",
};
