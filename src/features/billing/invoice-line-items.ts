export type InvoiceLineItem = {
  kind: string;
  description: string;
  classId?: string;
  amount: number;
  discount?: number;
  points?: number;
  paid?: number;
  unpaid?: number;
  method?: string | null;
  paidDate?: string | null;
  receipt?: string | null;
  dueDay?: number | null;
  /** 같은 수업으로 합산하기 전의 수납 기록. 합계에는 부모 항목만 사용한다. */
  sourceItems?: InvoiceLineItem[];
};

export function normalizeInvoiceLineItems(raw: unknown, includeSources = true): InvoiceLineItem[] {
  if (!Array.isArray(raw)) return [];
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
  const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
  return raw.map((item) => {
    const o = (item ?? {}) as Record<string, unknown>;
    const description = str(o.description) ?? str(o.name) ?? "";
    const opt = {
      classId: str(o.classId), discount: num(o.discount), points: num(o.points),
      paid: num(o.paid), unpaid: num(o.unpaid), method: str(o.method),
      paidDate: str(o.paidDate), receipt: str(o.receipt), dueDay: num(o.dueDay),
      sourceItems: includeSources && Array.isArray(o.sourceItems) && o.sourceItems.length
        ? normalizeInvoiceLineItems(o.sourceItems, false) : undefined,
    };
    return {
      kind: typeof o.kind === "string" ? o.kind : "tuition",
      description,
      amount: Number(o.amount) || 0,
      ...Object.fromEntries(Object.entries(opt).filter(([, v]) => v !== undefined)),
    };
  });
}

/** 환불 서식의 결제 이력: 합산 행 대신 원본을 사용해 중복 합산을 피한다. */
export function receiptHistoryLines(raw: unknown): unknown[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    const sources = (item as { sourceItems?: unknown } | null)?.sourceItems;
    return Array.isArray(sources) && sources.length ? sources : [item];
  });
}
