import { EXPENSE_CATEGORIES } from "@/features/approvals/types";
import { formatMoney, isValidCurrency } from "@/features/billing/currencies";
import type { ActivityFacts } from "./activity-facts";
import { shortDate } from "./short-date";

/**
 * 돈 계열(opaque) 활동 중 **원장이 싣기로 고른 칸만** — 지출결의서 작성·수정의 **분류 · 지출일 · 금액**
 * (원장 2026-09-29 *"3번"* = ① 누가 작성만 / ② 분류·지출일 / ③ + 금액 중 ③).
 * 🔴 제목(대상 문구)·메모·계좌·항목 내역은 여전히 안 싣는다 — 제목은 자유 글이라 무엇이 섞일지 모른다(opaque 규약 그대로).
 * 🔴 허용 목록 밖의 액션·키는 null — 다른 돈 계열(청구·수납·환불)은 이 함수로 열리지 않는다(열려면 원장에게 다시 물을 것).
 * 분류는 결의서 분류 목록(`EXPENSE_CATEGORIES`)에 있는 값만, 금액은 유한한 0 이상 수 + 등록된 통화만.
 */
// 복제도 같은 금액의 결의서가 하나 더 생기는 일이라 작성과 같이 싣는다.
const EXPENSE_ACTIONS = new Set(["expense_create", "expense_update", "expense_duplicate"]);

const money = (v: unknown, currency: string) =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? formatMoney(v, currency) : null;

export function moneyFacts(action: string, metadata: unknown): ActivityFacts | undefined {
  if (!EXPENSE_ACTIONS.has(action)) return undefined;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return undefined;
  const m = metadata as Record<string, unknown>;
  const currency = typeof m.currency === "string" && isValidCurrency(m.currency) ? m.currency : "KRW";
  const category =
    typeof m.category === "string" && (EXPENSE_CATEGORIES as readonly string[]).includes(m.category) ? m.category : null;
  const date = shortDate(m.expenseDate);
  const amount = money(m.amount, currency);
  const before = action === "expense_update" ? money(m.amountBefore, currency) : null;
  const amountText = amount ? (before && before !== amount ? `${before} → ${amount}` : amount) : null;

  const rows: ActivityFacts["rows"] = [];
  if (category) rows.push({ label: "분류", value: category });
  if (date) rows.push({ label: "지출일", value: date });
  if (amountText) rows.push({ label: "금액", value: amountText });
  if (!rows.length) return undefined;
  const brief = [category, date ? `지출일 ${date}` : null, amountText].filter((x): x is string => !!x);
  return { brief, rows, href: null };
}
