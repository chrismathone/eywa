/**
 * 퇴원보고서 환불 — 청구 줄 키와 요청서 표식(순수 함수 · 테스트용으로 server-only 밖에 둔다).
 * 키 = `<청구 id>#<줄 식별값>`. 식별값은 줄 내용(구분·반·수납명·묶음 id) 해시라 동기화로 순서가 바뀌어도 같은 줄을 가리킨다.
 * 같은 식별값이 여럿이면 `-n`을 붙이는데, 이 번호는 앞에 같은 줄이 끼면 밀린다 — 그래서 잡힘 판정은 **같은 식별값 형제 전체**로 한다.
 */
export const norm = (s: string) => s.replace(/\s+/g, " ").trim();
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
/** 과목 키 한 조각(학원 설정 과목 키 — math · english · subject_1 …). 미배분 키의 과목 범위에 쓴다. */
const SUBJECT = "[a-z0-9_]{1,32}";
/**
 * 줄 키 형식(DB s2_0037 줄 키 검사와 같은 글자 — 바꿀 땐 함께) — `all`(줄 기록 없는 청구) · 미배분 납부(`unalloc` · 과목 범위 `unalloc:<과목.과목>` ·
 * 나머지 `unalloc:~<과목.과목>` — 리뷰 r2 D-10) · 줄 식별값(해시 · 같은 값이면 `-n`).
 */
export const LINE_KEY = new RegExp(`^${UUID}#(all|unalloc(:~?${SUBJECT}(\\.${SUBJECT}){0,9})?|[0-9a-z]{1,8}(-\\d{1,2})?)$`, "i");
/** 미배분 납부 줄 식별값 — 과목 범위가 없으면 청구 전체 몫(`unalloc`) · `subjects` = 그 과목 몫 · `except` = 그 과목들을 뺀 나머지 몫. */
export function unallocId(range?: { subjects?: readonly string[]; except?: readonly string[] }): string {
  const list = (xs: readonly string[]) => [...new Set(xs)].sort().join(".");
  if (range?.subjects?.length) return `unalloc:${list(range.subjects)}`;
  if (range?.except?.length) return `unalloc:~${list(range.except)}`;
  return "unalloc";
}
export const isUnallocId = (id: string) => /^unalloc(:|$)/.test(id);
/** 미배분 식별값 → 범위(`whole` 청구 전체 · `only` 그 과목들 · `except` 그 과목들 밖). */
function unallocRange(id: string): { kind: "whole" } | { kind: "only" | "except"; subjects: string[] } {
  const body = id.slice("unalloc".length);
  if (!body.startsWith(":")) return { kind: "whole" };
  const except = body.startsWith(":~");
  return { kind: except ? "except" : "only", subjects: body.slice(except ? 2 : 1).split(".").filter(Boolean) };
}
/**
 * 🔴 두 줄 식별값이 **같은 돈일 수 있나**(겹침) — 같은 청구 안에서. 앱(이 함수)과 DB(`withdrawal_refund_keys_overlap` · s2_0037)가 같은 규칙 한 벌(리뷰 r2 D-1 ⅱ):
 * - `all`·`*`(줄 기록 없는 청구 · 옛 표식) ↔ 모든 줄.
 * - 미배분 ↔ 실제 줄: 겹친다(미배분 돈은 어느 줄 몫인지 모른다 — 줄별 납부가 나중에 채워지면 그 줄 돈이 된다).
 * - 미배분끼리: 청구 전체 몫(`unalloc`)은 모두와 · 과목 몫끼리는 과목이 하나라도 같으면 · '나머지' 몫은 그 밖 과목이 있는 과목 몫과 · 나머지끼리는 늘.
 * - 실제 줄끼리: 차례 번호(`-n`)를 뗀 식별값이 같으면(형제 · 번호 밀림 대비).
 * 청구 단위로 무조건 겹치게 보지 않는다 — 과목별로 나눠 끝내는 정상 흐름(수학 줄 환불 뒤 영어 줄 환불)을 막지 않게.
 * '낡은 키'(지금 줄에 형제가 하나도 없음)는 앱만 안다 — 앱이 청구 전체로 넓히고(`claimsOf`), DB는 대신 대체된 요청서 id(supersedes)로 본다.
 */
export function lineIdsOverlap(a: string, b: string): boolean {
  if (a === b || a === "all" || b === "all" || a === "*" || b === "*") return true;
  const ua = isUnallocId(a), ub = isUnallocId(b);
  if (ua !== ub) return true;
  if (!ua) return lineBase(a) === lineBase(b);
  const x = unallocRange(a), y = unallocRange(b);
  if (x.kind === "whole" || y.kind === "whole") return true;
  if (x.kind === "except" && y.kind === "except") return true;
  if (x.kind === "only" && y.kind === "only") return x.subjects.some(s => y.subjects.includes(s));
  const [only, except] = x.kind === "only" ? [x, y as { subjects: string[] }] : [y as { subjects: string[] }, x];
  return only.subjects.some(s => !except.subjects.includes(s));
}
/** 두 줄 키가 겹치나 — 같은 청구 id + `lineIdsOverlap`. */
export function keysOverlap(a: string, b: string): boolean {
  const [ia, la] = splitKey(a), [ib, lb] = splitKey(b);
  return ia.toLowerCase() === ib.toLowerCase() && lineIdsOverlap(la, lb);
}
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

/**
 * 수납 줄이 어느 반 몫인가 — 줄에 `classId`가 있으면 그것, 없으면 **반 이름으로 시작하는** 줄(뒤에 공백·끝). makeedu 수납명은
 * 반 이름 뒤에 강사·요일·시간이 붙는다(김덕현 11월: 반 '중등E_중2 심화' ↔ 줄 '중등E_중2 심화 Jane 월수목 16:20-18:10' — 원장 2026-10-29).
 * 여러 반 이름이 맞으면 가장 긴 이름(‘A’와 ‘A 심화’가 함께 있을 때 ‘A 심화 …’ 줄은 ‘A 심화’ 몫).
 */
export function courseOfLine<C extends { classId: string; className: string }>(line: { classId?: unknown; description: string }, courses: readonly C[]): C | null {
  if (typeof line.classId === "string" && line.classId) {
    const byId = courses.find(c => c.classId === line.classId);
    if (byId) return byId; // id로 못 찾으면(반을 다시 만들어 id가 바뀜 등) 이름으로 넘어간다.
  }
  const text = norm(line.description);
  let best: C | null = null;
  for (const c of courses) {
    const name = norm(c.className);
    if (name && (text === name || text.startsWith(`${name} `)) && (!best || name.length > norm(best.className).length)) best = c;
  }
  return best;
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
 * 한 청구에서 요청서가 담은 줄 판정(리뷰 r2 D-1·D-2 — 겹침 규칙 `lineIdsOverlap` 한 벌). `entries` = (담은 식별값 또는 `*`, 요청서) — 요청서를 만든 차례.
 * 반환 = 지금 줄마다 { 그 줄을 담은 요청서(먼저 만든 것) · 그 줄 식별값이 요청서 표식에 **정확히** 있나 · 겹치는 요청서 전부 }.
 * - `own`(이 묶음 요청서): 표식 키가 지금 줄에 있으면 **그 줄만** 담는다(형제·미배분은 따로 정할 수 있는 다른 돈 — DB도 같은 묶음 안 겹침은 막지 않는다).
 *   표식 키가 지금 줄에 없으면(낡음 — 수납명 변경 · 미배분이 줄에 배분됨 · 범위 바뀜) 겹치는 줄을 담은 것으로 본다(정확하지 않음 → DB가 원장 결정을 다시 묻는다).
 *   단 미배분 키는, 그 청구에 아직 미배분 납부가 남아 있으면(`unallocNow`) 미배분 줄만 겹침으로 본다 — 실제 줄 돈은 미배분과 따로 기록된 돈이다
 *   (미배분이 0이 됐을 때만 줄에 배분된 것으로 보고 실제 줄까지 담는다). 부르는 쪽은 그 청구의 모든 과목 몫 미배분 키를 `ids`에 넣는다(보고서마다 화면이 달라도 같은 판정).
 * - `other`(다른 묶음 요청서): 겹치는 줄은 늘 담은 것으로 본다(같은 돈 두 번 막기 — DB attach 반대쪽·C.3과 같은 규칙).
 * - 둘 다: `*`·`all`은 청구 전체 · 실제 줄 식별값의 형제가 지금 줄에 하나도 없으면(낡은 키) 청구 전체(앱만 아는 것 — DB는 supersedes로 본다).
 */
export type LineClaim<R> = { ref: R | null; exact: boolean; all: R[] };
export function claimsOf<R>(ids: readonly string[], entries: readonly (readonly [string, R])[] | undefined, mode: "own" | "other", unallocNow = true): LineClaim<R>[] {
  if (!entries?.length) return ids.map(() => ({ ref: null, exact: false, all: [] }));
  const bases = new Set(ids.map(lineBase));
  const present = new Set(ids);
  const covers = (k: string, id: string) => {
    if (k === "*" || k === "all") return true;
    if (!isUnallocId(k) && !bases.has(lineBase(k))) return true; // 낡은 키 → 청구 전체(보수적)
    if (mode === "own" && present.has(k)) return k === id;
    if (mode === "own" && isUnallocId(k) && unallocNow && !isUnallocId(id)) return false; // 미배분이 남아 있으면 실제 줄은 따로 기록된 돈
    return lineIdsOverlap(k, id);
  };
  return ids.map(id => {
    const all: R[] = [];
    let exactRef: R | null = null;
    for (const [k, ref] of entries) {
      if (!covers(k, id)) continue;
      if (k === id && exactRef === null) exactRef = ref;
      if (!all.includes(ref)) all.push(ref);
    }
    // 정확히 담은 요청서가 있으면 그것이 앞(DB note claimed 갈래가 그 요청서 표식에서 키를 찾는다).
    if (exactRef !== null) { all.splice(all.indexOf(exactRef), 1); all.unshift(exactRef); }
    return { ref: all[0] ?? null, exact: exactRef !== null, all };
  });
}
