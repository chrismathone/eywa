/**
 * 신규 콜&상담 '같은 학생' 판정 — 한 벌(원장 2026-10-19 *"같은 학생이 상담을 여러번 올 경우 체크할 수 있는 방법"* → 1·2번).
 * 쓰는 곳 넷이 이 함수를 지난다(같은 데이터는 같은 판정):
 *  칸반 카드 'N건' 배지(`getEnrollmentConsultations`) · 상세 '같은 학생의 다른 신규 콜&상담'(`getSiblingConsultations`) ·
 *  상담 준비 브리프의 이전 접수(`prep-facts`) · 새 상담 작성 중 '이전 상담' 안내(`/api/enrollment/prior-consults`).
 *
 * 열쇠 셋 중 하나라도 같으면 같은 학생이다(목록에선 이어진 것끼리 한 묶음):
 *  ① 연결된 원생(`student_id`)
 *  ② 이름 + 학교 + 학년 — 학교·학년이 둘 다 비면 열쇠가 아니다(이름뿐이면 남남이 묶인다: 옛 시트 이관분 이름 칸의
 *     "영어문의"·"예비중1" 316건 실측)
 *  ③ 이름 + 보호자 휴대폰(숫자만 · +82는 0으로 · 일반전화는 빼고) — 해가 바뀌어 학년이 오르거나("칠성초 4"→"칠성초 5") 학교 표기가 달라도
 *     ("사대초"/"사대부초") 같은 아이를 잡는다. 2026-10-19 실측: 연락처·이름이 같은데 ①②로 안 묶이던 87명 · 상담 199건.
 *     형제자매는 이름이 달라 따로 남는다.
 * 이름은 띄어쓰기·대소문자를 무시한다. 🔴 이름만으로는 묶지 않는다(동명이인). 🔴 열쇠가 같아도 반대 증거(다른 원생 연결 ·
 * 서로 다른 보호자 휴대폰)가 있으면 잇지 않는다 — [[#132]] 김근우(이름·학교·학년이 같은 다른 아이). 잘못 묶인 건 아무도
 * 모르지만 안 묶여서 놓치는 건 눈에 띈다.
 */
export type PersonRow = {
  id: string;
  student_id?: string | null;
  prospect_name?: string | null;
  prospect_school?: string | null;
  prospect_grade?: string | null;
  parent_phone?: string | null;
};

export const personName = (n: string | null | undefined) => (n ?? "").toLowerCase().replace(/\s+/g, "");

/** 연락처 → 숫자만(국가번호 82는 0으로) — "010-1234-5678" · "01012345678" · "+82 10-1234-5678"가 같은 값이 된다. */
export function phoneDigits(p: string | null | undefined): string {
  const d = (p ?? "").replace(/\D/g, "");
  return d.startsWith("82") && d.length >= 11 ? `0${d.slice(2)}` : d;
}

/**
 * 연락처 열쇠 = **휴대폰 번호만**(01로 시작하는 10~11자리). 학원 대표번호 같은 일반전화는 여러 집이 같이 적어
 * (2026-10-19 실측: 이름 4~6개가 함께 쓰는 번호들) 같은 이름의 다른 아이를 묶을 수 있다. 끝자리만 적은 메모도 열쇠가 아니다.
 */
export function phoneKeyOf(p: string | null | undefined): string | null {
  const d = phoneDigits(p);
  // 같은 숫자만 늘어놓은 자리 채움 번호("010-0000-0000")는 열쇠가 아니다(2026-10-19 실측 0건 — 앞으로 들어와도 남남을 안 묶게).
  return /^01\d{8,9}$/.test(d) && !/^(\d)\1{7}$/.test(d.slice(-8)) ? d : null;
}

export function personKeys(c: PersonRow): string[] {
  const keys: string[] = [];
  if (c.student_id) keys.push(`s:${c.student_id}`);
  const name = personName(c.prospect_name);
  if (!name) return keys;
  if (c.prospect_school || c.prospect_grade) keys.push(`n:${name}|${c.prospect_school ?? ""}|${c.prospect_grade ?? ""}`);
  const phone = phoneKeyOf(c.parent_phone);
  if (phone) keys.push(`p:${name}|${phone}`);
  return keys;
}

/** 묶음이 들고 다니는 반대 증거 — 연결된 원생(묶음당 하나) · 보호자 휴대폰들 · 맨 앞 행 id(순서를 입력에 기대지 않게). */
type Facts = { student: string | null; phones: Set<string>; first: string };

/**
 * 두 묶음을 이 열쇠로 이어도 되는가 — 🔴 반대 증거가 있으면 잇지 않는다([[#132]] 김근우: 이름·학교·학년이 같아도
 * 보호자 연락처가 다르면 다른 아이).
 *  · 서로 다른 원생에 연결된 묶음은 어떤 열쇠로도 잇지 않는다(병합 계획 `merge-plan.ts`와 같은 원칙).
 *  · 이름+학교+학년(`n:`)은 양쪽 다 휴대폰이 있는데 하나도 안 겹치면 잇지 않는다. 원생 연결(`s:`)은 연락처가 달라도 잇는다
 *    (보호자 둘이 각자 번호를 적는다 — 연결이 더 강한 근거).
 */
function compatible(a: Facts, b: Facts, kind: string): boolean {
  if (a.student && b.student && a.student !== b.student) return false;
  if (kind === "n" && a.phones.size > 0 && b.phones.size > 0 && ![...a.phones].some((p) => b.phones.has(p))) return false;
  return true;
}

/** 이 열쇠에서 반대 증거를 낼 수 있는 묶음인가 — 근거 없는 묶음(원생 연결·휴대폰 없음)은 어느 쪽과도 부딪히지 않는다. */
const anchored = (f: Facts, kind: string) => !!f.student || (kind === "n" && f.phones.size > 0);

/** 강한 열쇠부터 잇는다 — 원생 연결 → 이름+휴대폰 → 이름+학교+학년(약한 열쇠가 강한 묶음의 반대 증거를 보고 판단하게). */
const KIND_ORDER: Record<string, number> = { s: 0, p: 1, n: 2 };
const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * 행들을 같은 학생끼리 묶는다 → 행 id → 묶음 id. 열쇠가 없는 행은 자기 혼자 한 묶음.
 * 열쇠 하나마다 그 열쇠를 가진 묶음 전부를 한꺼번에 본다(행 순서와 무관 — 카드 'N건'과 상세가 같은 답을 내게):
 *  · 근거 있는 묶음끼리 서로 다 맞으면 전부 잇고, 근거 없는 묶음도 거기에 붙인다.
 *  · 🔴 근거 있는 묶음끼리 하나라도 부딪히면 이 열쇠로는 아무것도 잇지 않는다 — 근거 없는 상담은 어느 아이 것인지 모른다
 *    (먼저 본 쪽에 붙이면 두 아이의 상세가 같은 상담을 서로 제 것이라 한다).
 *  · 근거 있는 묶음이 없으면 근거 없는 것끼리 잇는다.
 */
export function samePersonGroups(rows: readonly PersonRow[]): Map<string, string> {
  const parent = new Map<string, string>();
  const facts = new Map<string, Facts>();
  const find = (x: string): string => {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root)!;
    for (let y = x; parent.get(y) !== root; ) {
      const next = parent.get(y)!;
      parent.set(y, root);
      y = next;
    }
    return root;
  };
  /** 두 루트를 잇고 남는 루트를 돌려준다(맨 앞 행 id가 작은 쪽이 남는다). */
  const union = (a: string, b: string): string => {
    const [keep, drop] = byText(facts.get(a)!.first, facts.get(b)!.first) <= 0 ? [a, b] : [b, a];
    parent.set(drop, keep);
    const fk = facts.get(keep)!;
    const fd = facts.get(drop)!;
    fk.student ??= fd.student;
    for (const p of fd.phones) fk.phones.add(p);
    return keep;
  };
  const holders = new Map<string, string[]>();
  for (const row of rows) {
    parent.set(row.id, row.id);
    const phone = phoneKeyOf(row.parent_phone);
    facts.set(row.id, { student: row.student_id || null, phones: new Set(phone ? [phone] : []), first: row.id });
    for (const key of personKeys(row)) {
      const list = holders.get(key);
      if (list) list.push(row.id);
      else holders.set(key, [row.id]);
    }
  }
  const keys = [...holders.keys()].sort((x, y) => KIND_ORDER[x[0]!]! - KIND_ORDER[y[0]!]! || byText(x, y));
  for (const key of keys) {
    const kind = key[0]!;
    const roots = [...new Set(holders.get(key)!.map(find))].sort((a, b) => byText(facts.get(a)!.first, facts.get(b)!.first));
    if (roots.length < 2) continue;
    if (kind === "s") {
      roots.reduce(union); // 같은 원생 = 같은 학생
      continue;
    }
    const strong = roots.filter((r) => anchored(facts.get(r)!, kind));
    const loose = roots.filter((r) => !anchored(facts.get(r)!, kind));
    const fit = strong.every((a, i) => strong.slice(i + 1).every((b) => compatible(facts.get(a)!, facts.get(b)!, kind)));
    if (!fit) continue;
    let anchor = strong.length > 0 ? strong.reduce(union) : loose.shift()!;
    for (const r of loose) anchor = union(anchor, r);
  }
  const out = new Map<string, string>();
  for (const row of rows) out.set(row.id, find(row.id));
  return out;
}

/** `self`와 같은 학생인 후보만(자기 제외) — 후보를 넉넉히 받아 같은 묶음 규칙으로 거른다. */
export function samePersonOf<T extends PersonRow>(self: PersonRow, candidates: readonly T[]): T[] {
  const others = candidates.filter((c) => c.id !== self.id);
  const groups = samePersonGroups([self, ...others]);
  const mine = groups.get(self.id);
  return others.filter((c) => groups.get(c.id) === mine);
}
