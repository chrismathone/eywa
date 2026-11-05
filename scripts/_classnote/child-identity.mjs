// scripts/_classnote/child-identity.mjs — 원아 ↔ 학생 **신분 가드의 공용 판정**(순수 — playwright·postgres import 금지 · Vitest).
//
// 원장 2026-11-05 *"형제 원아 연결이 뒤바뀐건 크리티컬함. 아주 섬세한 가드로 매칭해야함"*. 원아(ClassNote 계정)를 학생에게 붙여
// 게시하는 길은 둘이다 — 수학 반 보드(동기화 계획이 0302a에 적는다 · class-board-plan.mjs `resolveStudentChildren`)와 영어 반 방
// (발송 직전 · english-class-route.mjs). 두 길이 **같은 함수**(`childGuardReasons`)를 지나야 한쪽만 고쳐지는 일이 없다([[#112]]).
//   ② 보호자 전화 — 운영관리 명부의 보호자 전화(carer1~N) 중 하나가 aywa 전화 4칸에 있어야 한다. 모르면 보류.
//   ③ 생년 — 학년에서 역산 ±1년(명부 생년 또는 학부모 프로필 생년). 모르면 보류.
//   ④ 역방향 — 이 원아가 다른 학생의 1인 보드에 있거나, 반 보드 기록(0302a)에서 다른 학생에게 확인된 원아면 보류.
//   ⑥ 이름 연속성 — 보드에서 읽은 이름(학부모 프로필)과 **명부 이름 둘 다** 학생 이름과 이어져야 한다(2026-11-05부터 모든 출처 —
//      전에는 원아 연결 출처만 명부 이름을 봤다).
//   ⑦ 같은 집 형제(2026-11-05 신설) — 원아 이름이 같은 집(보호자 전화) **다른 아이**의 이름과 이어지면 보류(`siblingNameClash`).
//   ⑦-b 지점 전체 같은 이름(2026-11-05 적대적 리뷰) — 원아 이름이 다른 학생(기본이름이 다른) 이름과 **똑같으면** 전화와 무관하게 보류
//      (`namesakeClash` — 형제가 aywa에 서로 다른 번호로 적혀 ⑦의 같은 집에 안 잡히는 경우). 이 학생과 정확히 같지 않은 원아 이름(명부·프로필
//      이름마다) 안에 **이 학생보다 긴** 다른 학생 이름이 들어 있어도 보류(`김하` ← 원아 '김하늘이'·'김하늘(둘째)' · 재리뷰·재확인 2026-11-05).
//   사유에는 걸린 원아 이름 그대로와 출처를 적는다 — (명부) = 운영관리 명부(입소 서류) · (프로필) = 학부모 앱 탭·보드에서 읽은 이름.
// 가드는 전부 AND이고 하나라도 모르면 보류한다(fail-closed). 사람 확인으로만 푼다 — ClassNote 원아 이름·보호자 전화를 바로잡거나,
// **원장 확인 연결**(0185a `linked_by = 'confirmed'` · 원장 2026-11-05 *"해결책을 통해 발송 막히지 않도록 해"*): 사람이 확인한 연결은
// 운영관리 명부 = **학부모가 입소 때 낸 기본정보**(명부 이름 · 보호자 전화)만 대조에서 뺀다. 그 서류는 ClassNote에서 고치면 학부모 화면에도
// 바뀌어 보이고(저장 확인창 실측), 형제 서류가 뒤바뀐 채 제출됐거나(박세인·박세하 · 윤현소) 학생 본인 번호로 가입한 계정(김태진·박채향)은
// 서류만 틀린 것이라 학원이 고칠 대상이 아니다. 학부모 프로필(앱 탭) 이름 · 보드 이름 · 생년 · ⑦ 형제 · ④ 다른 학생 기록 · 명부 재원 여부는 그대로 본다.
//
// 실측(2026-11-05, DB select + ClassNote GET만): 침산 원아 연결 495건 중 명부 이름이 연결 학생과 안 이어지는 4건 = 형제 뒤바뀜 3
// (박세하↔박세인 · 윤현소/윤정인 — 명부 이름과 프로필 이름이 형제끼리 뒤바뀐 원아를 사람이 프로필 이름대로 이었다) + 퇴원생 1.
// 영어 반 방 지금 학생 199명 중 이 가드에 걸리는 학생 3명(형제 뒤바뀜 1 · 보호자 전화 불일치 2) · 수학 반 보드 확인 원아 190쌍 중
// ⑥·⑦에 새로 걸리는 것 = 형제 뒤바뀜 3.
import { expectedBirthYear, normBoard } from "./board-safety.mjs";
import { childIdentityKeys, matchesIdentity, studentIdentityKeys } from "./identity-keys.mjs";
import { carerPhones, normalizePhone, phoneMatches } from "./offboard-safety.mjs";

/** 생년 허용 오차(학년 역산 ±1년). */
export const BIRTH_TOLERANCE = 1;

/** 원장 확인 연결의 근거 표기(0185a `classnote_child_links.linked_by`). 자동 연결(0185a 동기화)은 이 값을 쓰지 않는다. */
export const CONFIRMED_LINK = "confirmed";

/** 원장 확인 연결 열쇠 — 학생 id + 원아 id. 확인은 그 연결 한 줄(그 학생 ↔ 그 원아)에만 걸린다 — 같은 원아가 다른 학생의 반 보드에 있어도 그 학생에게는 확인이 아니다. */
export function confirmedPairKey(studentId, childId) {
  return `${studentId}:${Number(childId)}`;
}

/** 기본이름 — 동명이인 접미사(끝 알파벳)를 뗀 이름. `김근우A`→`김근우`, `박서준C`→`박서준`. */
export function baseName(effName) {
  return String(effName ?? "").replace(/\s/g, "").replace(/[A-Za-z]+$/, "");
}

/**
 * ⑥ 원아 이름(학부모가 등록)이 학생 이름과 이어지는가 — 한쪽이 다른 쪽을 포함하면 통과(2글자 이상).
 * `서연`↔`박서연E` · `Jay(이재희)`↔`이재희` 통과, `김민서`↔`김민준`(쌍둥이 형제) 불통과.
 */
export function childNameConsistent(studentName, childName) {
  const x = baseName(studentName);
  if (x.length < 2) return false;
  for (const k of childIdentityKeys(childName)) {
    if (k.length >= 2 && (x.includes(k) || k.includes(x))) return true;
  }
  return false;
}

/**
 * 전화 색인 — 정규화한 번호 → 그 번호를 전화 칸(`phones`)에 가진 학생들(테스트 학생 제외). ⑦ 같은 집 찾기에 쓴다.
 * 🔴 번호는 비교에만 쓴다 — 이 색인을 로그로 찍지 말 것.
 * @param {Iterable<{id:string, name:string, phones?:Array<string|null|undefined>, isTest?:boolean}>} students
 */
export function phoneIndex(students) {
  const index = new Map();
  for (const s of students ?? []) {
    if (!s || s.isTest) continue;
    for (const p of new Set((s.phones ?? []).map(normalizePhone).filter(Boolean))) {
      const list = index.get(p);
      if (list) list.push(s);
      else index.set(p, [s]);
    }
  }
  return index;
}

/** 같은 집 — 주어진 번호(원아 보호자 전화 ∪ 이 학생의 전화) 중 하나라도 가진 학생들(중복 없이). */
export function familyOf(index, phones) {
  const out = new Map();
  for (const p of phones ?? []) {
    const k = normalizePhone(p);
    if (!k) continue;
    for (const s of index?.get?.(k) ?? []) out.set(s.id, s);
  }
  return [...out.values()];
}

/** 이 학생의 같은 집 후보를 돌려주는 함수(계획·발송 공용) — 원아 보호자 전화 ∪ 학생 전화로 찾는다. */
export function familyFinder(students) {
  const index = phoneIndex(students);
  return (student, adm) => familyOf(index, [...carerPhones(adm), ...(student?.phones ?? [])]);
}

/** 원아 이름 목록 정리 — 앞뒤 공백을 떼고 빈 이름·중복을 뺀다. */
const nameList = (names) => [...new Set((names ?? []).map((n) => String(n ?? "").trim()).filter(Boolean))];

/** 원아 이름 하나가 그 학생 이름과 **정확히**(매칭 키 교집합) 같은가. */
const sameName = (n, studentName) => matchesIdentity(childIdentityKeys(n), studentIdentityKeys(studentName ?? "", null));

/**
 * ⑦ 같은 집 형제 확인 — 원아 이름(`names` — 명부·프로필)이 같은 집 **다른 아이**의 이름과 이어지면, 걸린 아이마다
 * `{ other: 그 아이 유효이름, via: 걸린 원아 이름(원문) }`(없으면 빈 배열 — 사유에 실제로 걸린 이름을 적으려고 `via`를 함께 준다).
 *  · 기본이름(끝 알파벳 뗀 이름)이 이 학생과 같은 기록은 같은 아이의 **중복 기록**으로 본다 — 퇴원 기록과 재원 기록이 둘 다 있는
 *    아이(실측 이재윤). 형제는 이름이 같지 않다.
 *  · 원아 이름 하나라도 그 아이와 **정확히**(매칭 키 교집합) 같으면 걸린다 — 이 학생과도 이어져 있어도 그렇다(명부 `박세하` ·
 *    프로필 `박세인`처럼 형제끼리 뒤바뀐 원아).
 *  · 이 학생과 정확히 같은 이름이 하나도 없는데(포함 관계로만 이어짐) 그 아이와도 이어지면 걸린다 — `김하`↔`김하늘`, `강지원&강수정`.
 *    이 학생과 정확히 같은 이름이 있으면 다른 아이와의 포함 관계는 보지 않는다(공유 계정 명부 `강지원&강수정` · 프로필 `강지원` → 강지원).
 * @param {{id:string, name:string}} student  name = 유효이름
 * @param {Array<string|null|undefined>} names
 * @param {Array<{id:string, name:string, isTest?:boolean}>} family
 * @returns {Array<{other:string, via:string[]}>}
 */
export function siblingNameClashDetail(student, names, family) {
  const list = nameList(names);
  if (!list.length) return [];
  const exactMe = list.some((n) => sameName(n, student?.name));
  const me = baseName(student?.name);
  const out = [];
  for (const o of family ?? []) {
    if (!o || o.id === student?.id || o.isTest) continue;
    const theirs = baseName(o.name);
    if (!theirs || theirs === me) continue; // 같은 아이의 중복 기록(위 주석)
    const exact = list.filter((n) => sameName(n, o.name));
    const via = exact.length ? exact : exactMe ? [] : list.filter((n) => childNameConsistent(o.name, n));
    if (via.length) out.push({ other: o.name, via });
  }
  return out;
}

/** ⑦ 같은 집 형제 확인 — 걸린 아이들의 유효이름만(없으면 빈 배열 · `siblingNameClashDetail`과 같은 판정). */
export function siblingNameClash(student, names, family) {
  return [...new Set(siblingNameClashDetail(student, names, family).map((h) => h.other))];
}

/** ⑦-b 포함 관계로 찾는 다른 학생 이름의 최소 길이 — 이 학생(2글자 이상)보다 **긴** 이름만 보므로 3글자부터. */
const CONTAINED_MIN = 3;

/**
 * 지점 전체 이름 색인 — 원아 이름(`names`)과 **정확히**(매칭 키 교집합 — `matchesIdentity`와 같은 뜻) 같은 학생들 + 원아 이름 안에
 * 기본이름(3글자 이상)이 **들어 있는** 학생들을 돌려주는 함수(테스트 학생 제외 · 판정은 `namesakeClashDetail`이 한다).
 * ⑦의 '같은 집'은 전화로 찾아서, 형제가 aywa에 서로 다른 번호로 적혀 있으면 같은 집으로 안 잡힌다
 * (적대적 리뷰 2026-11-05 반례: 김하(엄마 번호) · 김하늘(아빠 번호만) — 원아 '김하늘'(엄마 번호)이 김하에게 붙고 모든 가드를 통과했다 ·
 * 재리뷰: 원아 '김하늘이'·'김하늘(둘째)'도 김하와 포함 관계로 이어져 통과했다).
 * 🔴 이름만 비교한다 — 전화는 보지 않는다.
 * @param {Iterable<{id:string, name:string, isTest?:boolean}>} students  name = 유효이름
 */
export function namesakeFinder(students) {
  const exact = new Map();
  const byBase = new Map();
  const add = (index, k, s) => {
    const list = index.get(k);
    if (list) list.push(s);
    else index.set(k, [s]);
  };
  for (const s of students ?? []) {
    if (!s || s.isTest) continue;
    for (const k of studentIdentityKeys(s.name ?? "", null)) add(exact, k, s);
    const b = baseName(s.name);
    if (b.length >= CONTAINED_MIN) add(byBase, b, s);
  }
  return (names) => {
    const out = new Map();
    for (const n of names ?? []) {
      for (const k of childIdentityKeys(n)) {
        for (const s of exact.get(k) ?? []) out.set(s.id, s);
        // 원아 이름 안의 3글자 이상 조각마다 기본이름 색인을 본다(이름은 짧아 조각 수가 작다 — 지점 전체를 훑지 않는다).
        for (let i = 0; i + CONTAINED_MIN <= k.length; i++)
          for (let j = i + CONTAINED_MIN; j <= k.length; j++) for (const s of byBase.get(k.slice(i, j)) ?? []) out.set(s.id, s);
      }
    }
    return [...out.values()];
  };
}

/**
 * ⑦-b 지점 전체 같은 이름 — 걸린 다른 학생마다 `{ other: 그 학생 유효이름, via: 걸린 원아 이름(원문), kind }`(없으면 빈 배열).
 *  · kind "exact" — 원아 이름 하나라도 **다른 학생**의 이름과 정확히 같다. 같은 집(⑦)의 '정확히 같으면 걸린다'를 전화와 무관하게
 *    지점 전체로 넓힌 것이다.
 *  · kind "contains" — 이 학생과 정확히 같지 않은 원아 이름 안에 **이 학생보다 긴** 다른 학생의 기본이름이 들어 있다(`김하` ← '김하늘이'·
 *    '김하늘(둘째)' — 재리뷰 2026-11-05). **이름마다** 본다 — 프로필이 '김하'(이 학생과 정확히 같음)여도 명부 '김하늘이'는 걸린다(형제 서류 모양 ·
 *    재확인 2026-11-05). 이 학생과 정확히 같은 이름 자체는 보지 않는다(`Jay(이재희)` · 공유 계정 프로필 `강지원`). 같은 길이·짧은 이름은 넓히지
 *    않는다(지점 전체엔 우연히 겹치는 이름이 많다 · 공유 계정 `강지원&강수정`처럼 같은 길이 형제는 ⑦이 같은 집으로 본다).
 *  · 기본이름(끝 알파벳 뗀 이름)이 이 학생과 같은 학생은 보지 않는다 — 같은 아이의 중복 기록이거나 동명이인이고, 동명이인은 ② 보호자 전화가 가른다.
 * @param {{id:string, name:string}} student  name = 유효이름
 * @param {Array<string|null|undefined>} names
 * @param {Array<{id:string, name:string, isTest?:boolean}>} namesakes  `namesakeFinder(...)(names)`
 * @returns {Array<{other:string, via:string[], kind:"exact"|"contains"}>}
 */
export function namesakeClashDetail(student, names, namesakes) {
  const list = nameList(names);
  if (!list.length) return [];
  // '들어 있음'은 이 학생과 정확히 같지 않은 이름마다 본다(위 주석 — 목록 전체에 한 번 정하면 프로필이 같을 때 명부 쪽이 꺼진다).
  const notMine = list.filter((n) => !sameName(n, student?.name));
  const me = baseName(student?.name);
  const out = [];
  for (const o of namesakes ?? []) {
    if (!o || o.id === student?.id || o.isTest) continue;
    const theirs = baseName(o.name);
    if (!theirs || theirs === me) continue;
    const exact = list.filter((n) => sameName(n, o.name));
    if (exact.length) {
      out.push({ other: o.name, via: exact, kind: "exact" });
      continue;
    }
    if (theirs.length <= me.length) continue;
    const inside = notMine.filter((n) => [...childIdentityKeys(n)].some((k) => k.includes(theirs)));
    if (inside.length) out.push({ other: o.name, via: inside, kind: "contains" });
  }
  return out;
}

/** ⑦-b 지점 전체 같은 이름 — 걸린 학생들의 유효이름만(없으면 빈 배열 · `namesakeClashDetail`과 같은 판정). */
export function namesakeClash(student, names, namesakes) {
  return [...new Set(namesakeClashDetail(student, names, namesakes).map((h) => h.other))];
}

/** 사유에 적는 원아 이름의 출처 — (명부) = 운영관리 명부(입소 서류) · (프로필) = 학부모 앱 탭·보드에서 읽은 이름. 둘 다 같으면 둘 다. */
function nameSource(n, admName, liveName) {
  const tags = [];
  if (admName && n === admName) tags.push("명부");
  if (liveName && n === liveName) tags.push("프로필");
  return tags.length ? `(${tags.join("·")})` : "";
}

/** 1인 보드 이름이 가리키는 학생 기본이름(`(수학)`로 시작하지 않으면 null). */
function personalBoardOwner(boardName) {
  const m = normBoard(boardName).match(/^\(수학\)(.+)$/);
  return m ? m[1] : null;
}

/** 생년 칸 → 연도(1900 이상 숫자만). */
const toYear = (v) => {
  const y = Number(String(v ?? "").slice(0, 4));
  return Number.isFinite(y) && y >= 1900 ? y : null;
};

/**
 * 원아 한 명의 신분 가드(②③④⑥⑦) — 수학 반 보드 계획과 영어 반 방 발송이 같은 판정을 쓴다. 사유가 하나라도 있으면 보류.
 * @param {{id:string, name:string, grade?:string|null, phones?:Array<string|null|undefined>}} student  name = 유효이름(classnote_name 우선)
 * @param {{id:number, name?:string, date_birth?:string|null, nameChecks?:string[], profileKnown?:boolean, profileName?:string}} m
 *   name = 보드에서 읽은 이름(학부모 프로필) · nameChecks = ⑥에 거는 이름(원아 연결 출처 = 명부·프로필 둘 다 — 없으면 [name])
 *   · profileKnown=false = 프로필 이름을 못 읽음(원아 연결 출처) · profileName = 원아 연결 출처의 학부모 프로필 이름(name은 명부 이름이 먼저라 따로 받는다).
 * @param {{admissions: Map<number, object>, schoolYear: number, verifiedOwners?: Map<number, Set<string>>|null,
 *          familyFor?: ((student:object, adm:object) => Array<object>)|null, namesakesFor?: ((names:string[]) => Array<object>)|null,
 *          confirmedPairs?: Set<string>|null}} ctx
 *   verifiedOwners = 원아 id → 반 보드 기록(0302a ok)에서 그 원아로 확인된 학생들 · familyFor = 같은 집 후보(`familyFinder`)
 *   · namesakesFor = 지점 전체 같은 이름 후보(`namesakeFinder` — ⑦-b) · confirmedPairs = 원장 확인 연결 열쇠(`confirmedPairKey` — 맨 위 주석).
 * @returns {string[]} 보류 사유(없으면 통과) — 🔴 보호자 전화 **값**은 싣지 않는다(일치 여부만).
 */
export function childGuardReasons(student, m, { admissions, schoolYear, verifiedOwners = null, familyFor = null, namesakesFor = null, confirmedPairs = null }) {
  const reasons = [];
  const adm = admissions?.get?.(m.id) ?? null;
  // 원장 확인 연결(맨 위 주석) — 명부(학부모가 입소 때 낸 기본정보)의 이름·보호자 전화만 대조에서 뺀다. 이 학생 ↔ 이 원아 한 줄에만 걸린다.
  const confirmed = Boolean(confirmedPairs?.has?.(confirmedPairKey(student.id, m.id)));
  // 확인 연결은 학부모 프로필(앱 탭) 이름 하나로 본다 — 보드 출처는 name이 곧 프로필 이름이고, 원아 연결 출처는 profileName으로 따로 온다.
  const liveName = m.profileName !== undefined ? String(m.profileName ?? "").trim() : String(m.name ?? "").trim();
  const who = `원아 "${(confirmed ? liveName : m.name) || "?"}"`;
  // ⑥ 이름 연속성 · ⑦ · ⑦-b가 보는 이름 — 보드 이름(원아 연결 출처는 nameChecks = 명부·프로필) + **명부 이름**(있으면 · 2026-11-05 모든 출처).
  //    형제끼리 이름이 뒤바뀐 원아는 보드 이름은 맞고 명부 이름만 형제 것이다 — 보드 이름 하나로는 못 잡는다(실측 박세하↔박세인).
  //    원장 확인 연결은 프로필 이름 하나로 본다(빈 이름이면 ⑥에서 떨어진다 · ⑦ 형제 확인도 이 이름으로 건다).
  const admName = confirmed ? "" : String(adm?.name ?? "").trim();
  const base = confirmed ? [liveName] : Array.isArray(m.nameChecks) && m.nameChecks.length ? m.nameChecks : [m.name];
  const names = admName && !base.includes(admName) ? [...base, admName] : base;
  // 사유에는 실제로 걸린 이름과 그 출처를 적는다(재리뷰 2026-11-05 — 프로필 '김하' · 명부 '김하늘'인데 "원아 "김하" … 똑같음"으로 적혔다).
  const quote = (n) => (n ? `"${n}"${nameSource(n, admName, liveName)}` : `"?"`);
  const quoteVia = (hits) => [...new Set(hits.flatMap((h) => h.via))].map(quote).join(" · ");
  const othersOf = (hits) => [...new Set(hits.map((h) => h.other))].join(", ");
  // ③ 생년 — 관리자 화면의 생년월일(운영관리 명부 child_date_birth)이 먼저, 학부모 프로필(date_birth)은 보조.
  //    둘 중 하나라도 맞으면 통과(원장 2026-09-29: 관리자 화면에서 고친 생년이 안 먹었다 — 두 값이 따로 산다).
  const expected = expectedBirthYear(student.grade, schoolYear);
  const years = [toYear(adm?.birth), toYear(m.date_birth)].filter((y) => y != null);
  if (expected == null) reasons.push(`학년(${student.grade ?? "없음"})을 몰라 생년 대조 불가`);
  else if (!years.length) reasons.push(`${who} 생년 없음`);
  else if (!years.some((y) => Math.abs(y - expected) <= BIRTH_TOLERANCE)) reasons.push(`${who} 생년 불일치(${years[0]}년생, 기대 ${expected}년생)`);
  // ⑥ 이름 연속성 — 위 `names` 전부가 학생 이름과 이어져야 한다.
  // findIndex — 이름이 비어(undefined) 걸린 원아도 놓치지 않는다(find는 걸린 값 자체가 undefined면 '없음'과 구별이 안 된다).
  const off = names.findIndex((n) => !childNameConsistent(student.name, n));
  if (off >= 0) reasons.push(`원아 ${quote(names[off])} 이름이 학생(${student.name})과 다름 — 형제 계정일 수 있어 확인 필요`);
  // ⑥-b 원아 연결 출처는 학부모 프로필 이름까지 봐야 통과한다 — 못 읽었으면 보류(다음에 다시 읽는다).
  if (m.profileKnown === false) reasons.push(`${who} 학부모 프로필(이름)을 확인하지 못함 — 다음 동기화에서 다시 확인`);
  // ⑦-b 지점 전체 같은 이름 — 원아 이름이 다른 학생 이름과 똑같거나, 이 학생보다 긴 다른 학생 이름을 담고 있다(형제가 서로 다른 번호로 적혀
  //      ⑦의 같은 집에 안 잡혀도 · 리뷰·재리뷰 2026-11-05). ⑦이 이미 같은 집으로 잡은 학생은 거기서 말한다(같은 사유 두 번 안 쓴다).
  const famHits = adm && familyFor ? siblingNameClashDetail(student, names, familyFor(student, adm)) : [];
  const famOthers = new Set(famHits.map((h) => h.other));
  if (namesakesFor) {
    const same = namesakeClashDetail(student, names, namesakesFor(names)).filter((h) => !famOthers.has(h.other));
    const exact = same.filter((h) => h.kind === "exact");
    const inside = same.filter((h) => h.kind === "contains");
    if (exact.length) reasons.push(`원아 ${quoteVia(exact)} 이름이 다른 학생(${othersOf(exact)})과 똑같음 — 그 학생의 원아 계정일 수 있어 확인 필요`);
    if (inside.length) reasons.push(`원아 ${quoteVia(inside)} 이름에 다른 학생(${othersOf(inside)}) 이름이 들어 있음 — 그 학생의 원아 계정일 수 있어 확인 필요`);
  }
  // ⑦ 같은 집 형제 — 원아 이름이 같은 집 다른 아이의 이름과 이어진다(명부를 못 읽은 원아는 ②가 따로 보류한다).
  if (famHits.length) reasons.push(`원아 ${quoteVia(famHits)} 이름이 같은 집 다른 아이(${othersOf(famHits)})와도 이어짐 — 형제 계정이 뒤바뀌었을 수 있어 확인 필요`);
  // ② 전화 — 값은 절대 사유에 싣지 않는다(일치 여부만)
  //    명부에 없는 원아는 원장 확인 연결이어도 보류한다(센터를 떠났거나 다른 원아 — 확인은 입소 서류만 대신한다).
  if (!adm) reasons.push(`${who} 운영관리 명부에 없음 — 보호자 전화 대조 불가`);
  else {
    const pm = confirmed ? true : phoneMatches(student.phones ?? [], carerPhones(adm)); // 보호자1~N 전부(원장 2026-11-04 — 엄마·아빠 번호가 갈려 적힌 집)
    if (pm === null) reasons.push(`${who} 보호자 전화 대조 불가(한쪽 번호 없음)`);
    else if (pm === false) reasons.push(`${who} 보호자 전화 불일치`);
    // ④ 역방향 — 이 원아가 다른 학생의 1인 보드에도 있다. 명부의 소속 보드 칸을 못 읽었으면(null) 대조할 수 없다(리뷰 B3 — 빈 목록으로 두면 조용히 통과).
    if (adm.boardNames === null) reasons.push(`${who} 운영관리 명부의 소속 보드를 읽지 못함 — 다른 학생 1인 보드 대조 불가`);
    const others = (adm.boardNames ?? []).map(personalBoardOwner).filter((o) => o && o !== normBoard(student.name));
    if (others.length) reasons.push(`${who} 다른 학생 1인 보드에도 있음(${others.map((o) => `(수학)${o}`).join(", ")})`);
  }
  // ④ 역방향(기록) — 반 보드 기록에서 이 원아가 다른 학생에게 '정상'으로 잡혀 있다(1인 보드가 비면 위 검사로는 못 잡는다).
  const recordedFor = [...(verifiedOwners?.get?.(Number(m.id)) ?? [])].filter((sid) => sid !== student.id);
  if (recordedFor.length) reasons.push(`${who} 반 보드 기록에서 다른 학생에게 확인된 원아입니다`);
  return reasons;
}

/**
 * **영어 반 방 원아 판정**(순수 · 2026-11-05) — 이 학생의 원아 연결(0185a) ∩ 지금 그 반 방 원아(`targets`)에 수학 반 보드와 같은 가드
 * (`childGuardReasons`)를 건다. 반 방 원아는 원아 연결로만 고르므로 수학의 '원아 연결 출처'와 같은 규칙이다: 이름 = 명부 이름 + 반 방에서 읽은
 * 학부모 프로필 이름 **둘 다**(프로필 이름이 비면 보류 · 명부 이름이 비면 ⑥ 탈락 · 원장 확인 연결은 프로필 이름 하나 — 맨 위 주석).
 * 실측(2026-11-05): 영어 반 방 지금 학생 199명 중 통과 196 · 보류 3(형제 서류 뒤바뀜 1 · 학생 본인 번호 가입 2 — 원장 확인 연결로 풂).
 * @param {{ student: object|null, targets: Array<{id:number|string, name?:string|null, date_birth?:string|null}>, admissions: Map<number, object>,
 *           schoolYear: number, verifiedOwners?: Map<number, Set<string>>|null, familyFor?: Function|null, namesakesFor?: Function|null,
 *           confirmedPairs?: Set<string>|null, maxChildren: number }} p
 *   student = `loadBoardStudents` 한 줄(유효이름·학년·전화) · targets = 원아 번호와 반 방에서 읽은 이름·생년.
 * @returns {{ ok: true } | { ok: false, reasons: string[] }}
 */
export function roomChildrenVerdict({ student, targets, admissions, schoolYear, verifiedOwners = null, familyFor = null, namesakesFor = null, confirmedPairs = null, maxChildren }) {
  if (!student) return { ok: false, reasons: ["학생 정보를 읽지 못해 원아를 대조할 수 없음"] };
  const list = targets ?? [];
  if (list.length > maxChildren) return { ok: false, reasons: [`이 학생과 연결된 원아 ${list.length}명이 같은 반 방에 있음 — 사람 확인 필요`] };
  const reasons = [];
  for (const t of list) {
    const id = Number(t.id);
    const admName = String(admissions?.get?.(id)?.name ?? "").trim();
    const profileName = String(t.name ?? "").trim();
    const m = {
      id,
      name: profileName || admName,
      date_birth: t.date_birth ?? null,
      // 명부 이름은 비어 있어도 넣는다(빈 이름 = ⑥ 탈락) — 프로필 이름 하나로 통과시키지 않는다(수학 linkMembers와 같은 규칙).
      nameChecks: [...new Set([admName, profileName].filter((n, i) => i === 0 || n))],
      profileKnown: Boolean(profileName),
      profileName,
    };
    reasons.push(...childGuardReasons(student, m, { admissions, schoolYear, verifiedOwners, familyFor, namesakesFor, confirmedPairs }));
  }
  return reasons.length ? { ok: false, reasons: [...new Set(reasons)] } : { ok: true };
}
