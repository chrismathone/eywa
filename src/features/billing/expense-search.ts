/**
 * 지출(결의서) 검색 — 순수 함수. 원장 2026-09-10: *"지출에서 검색할 수 있도록"*.
 *
 * 🔴 **거르기만 한다.** 금액·집계 산식(`summarizeExpenses`)은 한 글자도 안 건드린다 —
 *    화면의 KPI·분류별 바는 **이 달 전체** 기준 그대로고 검색은 **표만** 좁힌다
 *    (수납 면이 이미 그렇게 정해 뒀다: *"배너·KPI는 항상 이 달 전체 기준 — 검색은 표만 좁힌다.
 *    예전엔 배너만 검색 결과 기준이라 같은 화면에 모집단이 다른 '미수' 숫자 2개가 떴다"*,
 *    2026-07-30 적대 리뷰). 그래서 이 모듈엔 합계가 없다 — 세는 것도 부르는 쪽 몫이다.
 *
 * 🔑 **금액은 검색 대상이 아니다.** `114000`·`114,000`·`11.4만`이 사람마다 달라서, 숫자를 텍스트로
 *    맞추면 "분명 있는데 안 나온다"가 된다(그건 금액 범위 필터가 할 일이지 검색어가 할 일이 아니다).
 * 🔑 **분류(category)도 대상이 아니다** — 옆에 전용 드롭다운(`분류: 전체`)이 이미 있다. 검색어로도
 *    걸리면 두 컨트롤이 같은 축을 다투고, `분류: 인건비` + `인건비` 검색이 서로 다른 뜻으로 읽힌다.
 *
 * 대상 칸 = 사람이 결의서를 되찾을 때 실제로 기억하는 텍스트:
 *   행 = 제목 · 거래처 · 성명(작성자) · 부서명 · 메모
 *   라인 항목 = 용도 · 거래처 · 사용내역
 * (실측 2026-09-10, injaewon 219행: 제목 219/219 · 성명 219/219 · 부서 215 · 거래처 212 ·
 *  라인항목 219 · 메모 31. 라인 항목엔 `purpose="소모품비"`, `description="세모금컵 4,000개입"`처럼
 *  제목만으론 못 찾는 내용이 들어 있어 함께 본다 — 수납 면 검색이 `lineItems.description`을 보는 것과 같다.)
 */

/** 검색이 보는 라인 항목 — `ExpenseLineItem`의 부분집합(구조 타입이라 서로 import하지 않는다). */
export type ExpenseSearchLine = {
  purpose?: string | null;
  vendor?: string | null;
  description?: string | null;
};

/** 검색이 보는 행 — `ExpenseRow`가 구조적으로 만족한다(server-only 모듈을 끌어오지 않게 별도 선언). */
export type ExpenseSearchFields = {
  title?: string | null;
  vendor?: string | null;
  author?: string | null;
  department?: string | null;
  memo?: string | null;
  lineItems?: ExpenseSearchLine[] | null;
};

/**
 * 검색어 → 토큰 배열. 공백으로 나누고 소문자로 맞춘다(빈 문자열이면 빈 배열 = 필터 없음).
 * ⚠️ 소문자화는 영문 거래처(`Ai 레벨테스트`) 때문 — 한글은 영향이 없다.
 */
export function expenseSearchTokens(q: string | null | undefined): string[] {
  return (q ?? "").trim().toLowerCase().split(/\s+/).filter(Boolean);
}

/** 한 행이 검색에 걸리는지 볼 때 훑는 텍스트 — 소문자 한 덩어리. */
function haystackOf(row: ExpenseSearchFields): string {
  const parts: (string | null | undefined)[] = [
    row.title,
    row.vendor,
    row.author,
    row.department,
    row.memo,
  ];
  for (const li of row.lineItems ?? []) {
    parts.push(li.purpose, li.vendor, li.description);
  }
  // 칸 경계에 공백을 둔다 — 붙이면 `제목끝`+`거래처앞`이 우연히 한 낱말이 되어 없는 걸 찾아낸다.
  return parts.filter((p): p is string => typeof p === "string" && p !== "").join(" ").toLowerCase();
}

/**
 * 토큰 **전부**(AND)가 어딘가에 있으면 통과.
 *
 * 🔑 토큰 하나면 단순 부분일치와 똑같고, 둘 이상일 때만 더 너그럽다 — `당근 마켓`이 `당근마켓`을 찾고
 *    `김예원 당근`처럼 **다른 칸을 가로질러** 좁힐 수 있다(한 칸 안에서만 찾으면 0건이 되어 고장으로 읽힌다).
 */
export function expenseMatches(row: ExpenseSearchFields, tokens: string[]): boolean {
  if (tokens.length === 0) return true;
  const hay = haystackOf(row);
  return tokens.every((t) => hay.includes(t));
}

/** 검색어로 거른 행. 검색어가 비면 **원본 배열을 그대로 돌려준다**(불필요한 사본 금지). */
export function filterExpensesByQuery<T extends ExpenseSearchFields>(
  rows: T[],
  q: string | null | undefined,
): T[] {
  const tokens = expenseSearchTokens(q);
  if (tokens.length === 0) return rows;
  return rows.filter((r) => expenseMatches(r, tokens));
}

/** 지출 면 분류 필터 값(화면·엑셀 공용 — 감사 N2). 아는 값만 받는다(손으로 친 `?cat=zzz`는 '전체'). */
export const EXPENSE_FILTER_CATEGORIES = ["인건비", "운영비", "매입", "마케팅", "기타"] as const;
export function normalizeExpenseCategoryFilter(cat: string | null | undefined): string {
  return cat && (EXPENSE_FILTER_CATEGORIES as readonly string[]).includes(cat) ? cat : "all";
}

/**
 * 지출 면 **표에 보이는 집합** = 이 달 행 → 분류 → 검색어. 화면(expenses-panel)과 엑셀이 같은 함수를 지난다(N2).
 * 집계(KPI)는 여기 없다 — 부르는 쪽이 이 달 전체로 따로 낸다(위 머리주석 규약).
 */
export function filterExpensesForView<T extends ExpenseSearchFields & { category: string }>(
  rows: readonly T[],
  cat: string,
  q: string,
): T[] {
  const catRows = cat === "all" ? [...rows] : rows.filter((r) => r.category === cat);
  return filterExpensesByQuery(catRows, q);
}
