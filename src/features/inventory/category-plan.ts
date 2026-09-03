/**
 * 엑셀에 적힌 **모르는 분류** → 새로 만들 분류(키·라벨·접두) 도출 — 순수(서버 액션·Vitest 공용).
 *
 * 원장 2026-09-03: *"엑셀에서 없는 분류 추가하면 자동으로 분류 추가되도록"* + *"분류 추가시에 반영 누르면
 * '확인' 메시지 하나 띄워주는걸로"*. 여기는 **무엇이 생기는지 계산만** 한다 — 쓰기는 서버 액션이,
 * 사람 확인은 엑셀 다이얼로그가 맡는다.
 *
 * 🔑 사람은 **라벨만** 적는다(파일에 쓴 글자 그대로). 키·접두는 여기서 도출한다 — 과목 키 선례와 같은 결
 *    (`KNOWN_SUBJECT_KEYS` → `subject_N`). 🔴 키는 확정 후 **불변**이라 나중에 라벨을 고쳐도 안 바뀐다.
 * 🔑 접두는 **파일에서 뽑는다** — 그 분류의 첫 행 자산ID가 `HS-001`처럼 `^[A-Z]{2,3}-` 모양이고 아직 안 쓰인
 *    접두면 그걸 쓴다(사람이 이미 골라 적은 값이라 가장 정직하다). 못 뽑거나 겹치면 `C1`·`C2`… 폴백.
 * ⚠️ **오탈자가 새 분류를 만든다**('헤드셋'/'헤드셑'). 자동 병합은 **하지 않는다**(사람이 판단) — 대신
 *    비슷한 기존 라벨을 `similarTo`로 함께 돌려주고 확인 창이 그 사실을 눈에 띄게 적는다.
 */
import { FALLBACK_CODE_PREFIX, normalizeCategoryText, type InventoryCategory } from "./category";

/**
 * 흔한 분류 이름 → 표준 키. **작은 사전**이다 — 여기에 없으면 `category_N`으로 떨어질 뿐 아무것도 안 깨진다
 * (키는 화면에 안 보이는 내부 식별자라 값 자체는 무의미하다). 🔴 사전을 크게 지어내지 말 것.
 * 내장 7종은 표에 이미 있어(0247a 시드) 라벨로 매칭되므로 여기 없어도 된다.
 */
export const KNOWN_CATEGORY_KEYS = new Map<string, string>([
  ["헤드셋", "headset"],
  ["웹캠", "webcam"],
  ["스피커", "speaker"],
  ["공유기", "router"],
  ["프로젝터", "projector"],
]);

/** 파일의 자산ID에서 뽑을 수 있는 접두 — `HS-001` → `HS`. 2~3자 대문자만(숫자 섞인 건 안 뽑는다). */
const MINEABLE_PREFIX_RE = /^([A-Z]{2,3})-/;

const MAX_DERIVE_TRIES = 9999;

export type NewCategoryPlan = {
  /** 파일에 적힌 글자 그대로(trim) — 그대로 라벨이 된다. */
  label: string;
  /** 도출된 내부 키(불변). */
  key: string;
  /** 도출된 자산ID 접두. */
  codePrefix: string;
  /** 접두를 파일의 자산ID에서 뽑았는가(false = `C1` 폴백). 확인 창이 근거를 적는다. */
  prefixFromFile: boolean;
  /** 비슷한 기존/앞선 라벨 — 오탈자 경보(자동 병합은 안 한다). */
  similarTo?: string;
  /** 이 분류로 들어올 파일 행 수 — 확인 창이 "몇 대가 딸려 오는지" 적는다. */
  rowCount: number;
};

export type NewCategoryEntry = {
  /** 엑셀 분류 칸(trim된 원문). */
  label: string;
  /** 같은 행의 자산ID — 접두를 여기서 뽑는다. */
  assetCode: string;
};

/** 편집 거리 ≤ 1인가 — 한 글자 오타('헤드셑')만 잡는다(넓히면 진짜 다른 분류까지 경보가 뜬다). */
function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  const [s, l] = a.length <= b.length ? [a, b] : [b, a];
  let i = 0;
  let j = 0;
  let diff = 0;
  while (i < s.length && j < l.length) {
    if (s[i] === l[j]) {
      i += 1;
      j += 1;
      continue;
    }
    diff += 1;
    if (diff > 1) return false;
    if (s.length === l.length) i += 1;
    j += 1;
  }
  return true;
}

/**
 * 비슷한 라벨 찾기 — 한 글자 오타 또는 한쪽이 다른 쪽을 품는 경우('노트북' ⊂ '노트북PC').
 * 🔴 판정만 하고 **합치지 않는다**(자동 병합은 사람이 안 본 사이에 분류를 지운다).
 */
export function similarCategoryLabel(label: string, pool: ReadonlyArray<string>): string | undefined {
  const a = normalizeCategoryText(label);
  if (a.length < 2) return undefined;
  for (const other of pool) {
    const b = normalizeCategoryText(other);
    if (b.length < 2 || a === b) continue;
    if (withinOneEdit(a, b) || a.includes(b) || b.includes(a)) return other;
  }
  return undefined;
}

/**
 * 라벨 → 내부 키. 사전에 있고 안 쓰였으면 표준 키, 아니면 `category_N`(빈 번호).
 * ⚠️ 사전은 **Map**이다 — 평범한 객체면 `constructor`·`__proto__` 같은 라벨이 프로토타입 멤버를 키로 되돌린다.
 */
export function deriveCategoryKey(label: string, takenKeys: ReadonlySet<string>): string {
  const known = KNOWN_CATEGORY_KEYS.get(normalizeCategoryText(label)) ?? KNOWN_CATEGORY_KEYS.get(label.trim());
  if (known && !takenKeys.has(known)) return known;
  for (let n = 1; n <= MAX_DERIVE_TRIES; n += 1) {
    const k = `category_${n}`;
    if (!takenKeys.has(k)) return k;
  }
  // 여기까지 오면 분류가 1만 개다 — 실무상 불가능하지만 조용히 겹치는 키를 돌려주지는 않는다.
  throw new Error("분류 키를 더 만들 수 없습니다");
}

/** `C1`·`C2`… 중 안 쓰인 접두(파일에서 못 뽑았을 때). */
function fallbackPrefix(taken: ReadonlySet<string>): string {
  if (!taken.has(FALLBACK_CODE_PREFIX)) return FALLBACK_CODE_PREFIX;
  for (let n = 2; n <= MAX_DERIVE_TRIES; n += 1) {
    const p = `C${n}`;
    if (p.length <= 4 && !taken.has(p)) return p;
  }
  throw new Error("자산ID 접두를 더 만들 수 없습니다");
}

/**
 * 파일의 모르는 분류들 → 새로 만들 분류 계획(첫 등장 순).
 *
 * `entries`는 **분류 칸을 못 알아본 행만** 넘긴다(순서 = 파일 행 순서). 같은 라벨은 공백 무시로 묶는다.
 * ⚠️ 서버가 이 함수를 다시 돌려 클라가 확인한 목록과 대조한다([[#77]] — 확인 창을 건너뛴 요청은 거절).
 */
export function planNewCategories(
  entries: ReadonlyArray<NewCategoryEntry>,
  existing: ReadonlyArray<InventoryCategory>,
): NewCategoryPlan[] {
  // 같은 라벨끼리 묶기 — 첫 등장 순서를 유지한다(접두는 그 묶음의 첫 유효 자산ID에서 뽑는다).
  const groups = new Map<string, { label: string; codes: string[] }>();
  for (const e of entries) {
    const label = e.label.trim();
    if (!label) continue;
    const norm = normalizeCategoryText(label);
    const g = groups.get(norm);
    if (g) g.codes.push(e.assetCode);
    else groups.set(norm, { label, codes: [e.assetCode] });
  }

  const takenKeys = new Set(existing.map((c) => c.key));
  const takenPrefixes = new Set(existing.map((c) => c.codePrefix));
  const labelPool = existing.map((c) => c.label);

  const out: NewCategoryPlan[] = [];
  for (const { label, codes } of groups.values()) {
    const key = deriveCategoryKey(label, takenKeys);
    takenKeys.add(key);

    const mined = codes
      .map((c) => MINEABLE_PREFIX_RE.exec(c.trim().toUpperCase())?.[1])
      .find((p): p is string => !!p && !takenPrefixes.has(p));
    const codePrefix = mined ?? fallbackPrefix(takenPrefixes);
    takenPrefixes.add(codePrefix);

    out.push({
      label,
      key,
      codePrefix,
      prefixFromFile: !!mined,
      similarTo: similarCategoryLabel(label, labelPool),
      rowCount: codes.length,
    });
    // 뒤에 오는 새 분류도 앞선 새 분류와의 오탈자를 잡는다('헤드셋'·'헤드셑'이 같은 파일에 있을 때).
    labelPool.push(label);
  }
  return out;
}

/** 계획 → 새 분류 행(정렬 순서 포함). 서버 액션이 이 모양으로 insert 한다. */
export function planToCategories(plan: ReadonlyArray<NewCategoryPlan>, existing: ReadonlyArray<InventoryCategory>): InventoryCategory[] {
  const base = existing.reduce((m, c) => Math.max(m, c.sortOrder), 0);
  return plan.map((p, i) => ({ key: p.key, label: p.label, codePrefix: p.codePrefix, sortOrder: base + (i + 1) * 10 }));
}

/**
 * 클라가 확인한 목록 == 서버가 다시 계산한 계획인가 — **게이트는 화면이 아니라 서버**([[#77]]).
 * 라벨 집합이 정확히 같아야 통과한다(순서는 안 본다 — 확인 창이 보여 준 것은 목록이지 순서가 아니다).
 */
export function confirmMatchesPlan(confirmed: ReadonlyArray<string>, plan: ReadonlyArray<NewCategoryPlan>): boolean {
  const a = [...new Set(confirmed.map((s) => normalizeCategoryText(s)))].sort();
  const b = [...new Set(plan.map((p) => normalizeCategoryText(p.label)))].sort();
  return a.length === b.length && a.every((v, i) => v === b[i]);
}
