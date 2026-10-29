/**
 * 퇴원보고서 환불 — 청구 줄 키와 요청서 표식(순수 함수 · 테스트용으로 server-only 밖에 둔다).
 * 키 = `<청구 id>#<줄 식별값>`. 식별값은 줄 내용(구분·반·수납명·묶음 id) 해시라 동기화로 순서가 바뀌어도 같은 줄을 가리킨다.
 * 같은 식별값이 여럿이면 `-n`을 붙이는데, 이 번호는 앞에 같은 줄이 끼면 밀린다 — 그래서 잡힘 판정은 **같은 식별값 형제 전체**로 한다.
 */
export const norm = (s: string) => s.replace(/\s+/g, " ").trim();
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
export const LINE_KEY = new RegExp(`^${UUID}#(all|[0-9a-z]{1,8}(-\\d{1,2})?)$`, "i");
export const REFUND_TAG_PREFIX = "퇴원보고서 환불 승인 ·";
export const refundTag = (reportId: string, keys: string[]) => `${REFUND_TAG_PREFIX} report:${reportId} · lines:${keys.join(",")}`;

function fnv(text: string): string {
  let h = 0x811c9dc5;
  for (const ch of text) { h ^= ch.codePointAt(0)!; h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36);
}

/** 줄 식별값 — 구분·반·수납명·묶음 id. 같은 값이 여럿이면 차례 번호(DB `receipt_line_identity`와 같은 생각). */
export function lineIds(raw: unknown[]): string[] {
  const seen = new Map<string, number>();
  return raw.map((v) => {
    const r = (v ?? {}) as Record<string, unknown>;
    const base = fnv([r.kind, r.classId, norm(String(r.description ?? r.name ?? "")), r.receiptGroupId].map(x => x == null ? "" : String(x)).join("|"));
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n ? `${base}-${n}` : base;
  });
}

/** 줄 식별값의 형제 묶음 이름(차례 번호를 뗀 것). */
export const lineBase = (lineId: string) => lineId.split("-")[0];

/** 키 → [청구 id, 줄 식별값]. */
export const splitKey = (key: string): [string, string] => [key.slice(0, 36), key.slice(37)];

/** 요청서 설명 → 잡은 줄 키. 10-29 첫 판(`invoice:<id>`, 줄 표식 없음)은 그 청구 전체(`<id>#*`). */
export function claimedKeys(description: string): string[] {
  const lines = /lines:([^\s·]+)/.exec(description)?.[1];
  if (lines) return lines.split(",").filter(Boolean);
  const invoiceId = new RegExp(`invoice:(${UUID})`, "i").exec(description)?.[1];
  return invoiceId ? [`${invoiceId}#*`] : [];
}

/**
 * 한 청구에서 잡힌 줄 판정. `claimed` = 줄 식별값(또는 `*`) → 요청서. 반환 = 지금 줄마다 잡은 요청서(없으면 null).
 * - `*`(옛 표식)이거나, 잡힌 식별값의 형제가 지금 줄에 하나도 없으면(동기화로 바뀜·`all`↔실제 줄) 청구 전체가 잡힌 것으로 본다.
 * - 그 밖에는 형제 묶음 단위 — 같은 식별값 줄 하나가 잡히면 그 형제 모두를 잡힌 것으로 본다(번호 밀림 대비 · 보수적으로).
 */
export function claimedLines<R>(ids: string[], claimed: Map<string, R> | undefined): (R | null)[] {
  if (!claimed?.size) return ids.map(() => null);
  const bases = new Set(ids.map(lineBase));
  const stale = [...claimed.keys()].find(k => k === "*" || !bases.has(lineBase(k)));
  if (stale != null) return ids.map(() => claimed.get(stale)!);
  const byBase = new Map<string, R>();
  for (const [k, ref] of claimed) if (!byBase.has(lineBase(k))) byBase.set(lineBase(k), ref);
  return ids.map(id => byBase.get(lineBase(id)) ?? null);
}
