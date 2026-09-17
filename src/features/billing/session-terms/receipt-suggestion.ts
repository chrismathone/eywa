import { distributeReceipt, type ReceiptAllocationDraft, type ReceiptLine } from "./receipt-allocation";
import { isTuitionReceipt } from "./tuition-receipt";

export type TransferEnrollment = {
  class_id: string; start_date: string; end_date: string | null;
  is_transferred: boolean; is_transferred_in: boolean;
};
export type SuggestionTerm = {
  id: string; classId: string | null; className: string | null; subject: string;
  pricingMode: string; plannedSessions: number | null; confirmedSessions: number | null; unitPrice: number | null;
};
export type ReceiptSuggestion = { lineIndex: number; kind: "match" | "transfer"; reason: string; rows: { termId: string; amount: number }[] };

const raw = (value: unknown): Record<string, unknown> => value && typeof value === "object" ? value as Record<string, unknown> : {};
const normalize = (s: string) => s.trim().replace(/\s+/g, " ").toLocaleLowerCase();
/** 코드·반 ID는 정확히, 서술형 반명은 단어 경계까지 맞아야 한다(A와 AB 등 부분 일치 금지). */
export function receiptMatchesClass(source: unknown, term: Pick<SuggestionTerm, "classId" | "className">): boolean {
  const line = raw(source);
  if (Array.isArray(line.sourceItems) && line.sourceItems.length) return line.sourceItems.some((s) => receiptMatchesClass(s, term));
  if (line.classId) return line.classId === term.classId;
  if (!term.className) return false;
  const name = normalize(term.className), description = normalize(String(line.description ?? line.name ?? ""));
  if (description === name || description.startsWith(`${name} `)) return true;
  // MakeEdu의 '초등브릿지 D'와 반명의 '초등 브릿지 D'는 같다. 끝 단어 경계는 유지한다.
  const compactName = name.replace(/\s/g, "");
  let prefix = "";
  for (const token of description.split(" ")) {
    prefix += token;
    if (prefix === compactName) return true;
    if (prefix.length >= compactName.length) break;
  }
  const code = name.split(" ").at(-1) ?? "";
  return /[a-z]/.test(code) && /\d/.test(code) && description.split(/\s+/).includes(code);
}

/** 날짜만 가까운 병행 수업을 반 이동으로 추정하지 않는다. 양쪽 이동 표식과 유일한 연결을 요구한다. */
export function transferComponents(period: string, terms: SuggestionTerm[], history: TransferEnrollment[]): string[][] {
  const edges: { from: string; to: string }[] = [];
  for (const from of terms) for (const to of terms) {
    if (from.id === to.id || from.subject !== to.subject || from.pricingMode === "monthly" || to.pricingMode === "monthly") continue;
    const moved = history.some((a) => a.class_id === from.classId && a.is_transferred && a.end_date && history.some((b) => {
      if (b.class_id !== to.classId || !b.is_transferred_in || !b.start_date.startsWith(period)) return false;
      const gap = (Date.parse(b.start_date) - Date.parse(a.end_date!)) / 86400000;
      return gap === 0 || gap === 1;
    }));
    if (moved) edges.push({ from: from.id, to: to.id });
  }
  const safe = edges.filter((e) => edges.filter((x) => x.from === e.from).length === 1 && edges.filter((x) => x.to === e.to).length === 1);
  const components: string[][] = [], visited = new Set<string>();
  for (const term of terms) {
    if (visited.has(term.id)) continue;
    const ids = [term.id]; visited.add(term.id);
    for (let i = 0; i < ids.length; i++) for (const edge of safe) {
      const next = edge.from === ids[i] ? edge.to : edge.to === ids[i] ? edge.from : null;
      if (next && !visited.has(next)) { visited.add(next); ids.push(next); }
    }
    components.push(ids);
  }
  return components;
}

/** 읽기 전용 제안. 저장한 배분이나 확정값을 쓰지 않는다. */
export function suggestReceiptAllocations(period: string, lines: ReceiptLine[], terms: SuggestionTerm[], history: TransferEnrollment[]): ReceiptSuggestion[] {
  const bills = lines.filter((l) => isTuitionReceipt(l.source) && Number.isSafeInteger(l.amount) && l.amount >= 0);
  const candidates = new Map(terms.map((t) => [t.id, bills.filter((l) => receiptMatchesClass(l.source, t)).map((l) => l.index)]));
  const components = transferComponents(period, terms, history);
  for (const ids of components.filter((ids) => ids.length > 1)) {
    const indices = [...new Set(ids.flatMap((id) => candidates.get(id) ?? []))];
    // 서로 다른 반명으로 각각 청구된 수납은 각 반에 연결한다. 임의로 합산하지 않는다.
    if (indices.length === 1) for (const id of ids) candidates.set(id, indices);
  }
  const suggestions: ReceiptSuggestion[] = [];
  for (const line of bills) {
    const touched = terms.filter((t) => candidates.get(t.id)?.includes(line.index));
    if (!touched.length || touched.some((t) => candidates.get(t.id)?.length !== 1)) continue;
    const transfer = touched.length > 1 && components.some((ids) => touched.every((t) => ids.includes(t.id)));
    if (touched.length > 1 && !transfer) continue;
    const active = (t: SuggestionTerm) => history.some((e) => e.class_id === t.classId && e.start_date.slice(0, 7) <= period && (!e.end_date || e.end_date >= `${period}-01`));
    if (touched.length === 1) {
      const term = touched[0];
      if (!active(term) || (term.pricingMode !== "monthly" && term.confirmedSessions === 0 && line.amount > 0)) continue;
      suggestions.push({ lineIndex: line.index, kind: "match", reason: "반명·수납 항목이 명확히 일치하여 자동 연결", rows: [{ termId: term.id, amount: line.amount }] });
      continue;
    }
    const units = touched.map((t) => ({ term: t, units: t.confirmedSessions === 0 || !active(t) ? 0 : t.plannedSessions }));
    if (units.some((u) => u.units === null || !Number.isFinite(u.units) || u.units! < 0)) continue;
    const positive = units.filter((u) => u.units! > 0);
    const priced = positive.every((u) => u.term.unitPrice !== null && u.term.unitPrice > 0);
    if (!priced && positive.some((u) => u.term.unitPrice !== null)) continue;
    const weights = units.map((u) => ({ id: u.term.id, amount: u.units! * (priced ? u.term.unitPrice ?? 0 : 1) }));
    if (!weights.some((w) => w.amount > 0)) continue;
    const amounts = distributeReceipt(line.amount, weights);
    suggestions.push({ lineIndex: line.index, kind: "transfer", reason: `반 이동 이력 · 수강 기간·등원 요일의 계획 시수${priced ? " × 단가" : ""} 비율 (${units.map((u) => `${u.term.className} ${u.units}시수`).join(" / ")})`, rows: touched.map((t) => ({ termId: t.id, amount: amounts[t.id] })) });
  }
  return suggestions;
}

export function canApplyReceiptSuggestion(draft: ReceiptAllocationDraft, suggestion: ReceiptSuggestion): boolean {
  return Object.entries(draft).every(([id, row]) => row.line !== String(suggestion.lineIndex) || suggestion.rows.some((s) => s.termId === id));
}
export function applyReceiptSuggestion(draft: ReceiptAllocationDraft, suggestion: ReceiptSuggestion): ReceiptAllocationDraft {
  if (!canApplyReceiptSuggestion(draft, suggestion)) return draft;
  return { ...draft, ...Object.fromEntries(suggestion.rows.map((r) => [r.termId, { line: String(suggestion.lineIndex), amount: String(r.amount) }])) };
}
type SavedTerm = { id: string; amount: number | null; allocatedAmount?: number | null; allocationStale?: boolean; allocationLineIndex?: number | null; refundState?: string };
/** 연결 없이 0원으로 저장해 둔 반 — 다시 열 때 제안이 그 반을 다른 항목에 붙이지 않는다(사람이 고른 "연결 안 함"). */
const savedUnlinkedZero = (t: SavedTerm) => t.allocationLineIndex == null && t.allocatedAmount === 0 && !t.allocationStale && t.refundState !== "full";
export function initialReceiptDraft(terms: SavedTerm[], suggestions: ReceiptSuggestion[] = []): ReceiptAllocationDraft {
  let draft = Object.fromEntries(terms.map((t) => [t.id, { line: t.allocationStale || t.allocationLineIndex == null ? "" : String(t.allocationLineIndex), amount: String(t.allocatedAmount ?? t.amount ?? "") }]));
  for (const suggestion of suggestions) {
    if (suggestion.rows.some((r) => terms.some((t) => t.id === r.termId && (t.allocationLineIndex != null || savedUnlinkedZero(t))))) continue;
    draft = applyReceiptSuggestion(draft, suggestion);
  }
  return draft;
}
