import "server-only";

/** ExcelJS 셀 값 → 문자열(richText·수식 결과·하이퍼링크·날짜·숫자 안전화). 날짜는 UTC 성분으로 YYYY-MM-DD(엑셀 날짜엔 시간대가 없다). */
export function cellText(v: unknown): string {
  if (v == null) return "";
  if (v instanceof Date) {
    return `${v.getUTCFullYear()}-${String(v.getUTCMonth() + 1).padStart(2, "0")}-${String(v.getUTCDate()).padStart(2, "0")}`;
  }
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (typeof o.text === "string") return o.text;
    if (Array.isArray(o.richText)) return (o.richText as { text?: string }[]).map((t) => t.text ?? "").join("");
    if (o.result != null) return cellText(o.result);
    return String(v);
  }
  return String(v);
}
