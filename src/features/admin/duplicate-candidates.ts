/**
 * **중복 병합 후보** 판정 — 순수 로직(IO 없음 · Vitest). 통합 섹션(`/owner?tab=data`)의 단일 소스.
 *
 * 원장 제보(2026-09-10): *"중복 병합으로 합칠 곳이 없음."* — 학생 상세 배너는 *"같은 사람이면 관리자
 * **중복 병합**으로 합치세요"* 라고 안내하는데 정작 그 화면은 *"중복 의심 학생이 없습니다"* 였다.
 *
 * 🔑 **원인은 이름이었다.** 동기화(`scripts/_makeedu/import-students-list.cjs`)는 이름이 겹치면 뒤에
 *    알파벳을 붙여 새 학생을 만든다(`권민서` → `권민서A` → `권민서B`, `dup_suspect=true`). 그런데 후보
 *    판정 두 신호가 모두 **이름이 글자까지 같을 것**을 요구해서, 접미사가 붙는 순간 그 쌍은 **영원히**
 *    후보가 될 수 없었다. 실측(2026-09-10 injaewon, 비퇴원 367명): 후보 0건 · 그중 `dup_suspect`가
 *    살아 있는 학생 1명(`권민서B` 초6·칠성초·010-0000-9104)의 짝 `권민서A`는 **학년·학교·학부모
 *    연락처가 전부 같은데도** 어느 화면에도 안 떴다.
 *
 * 신호는 셋이고, 셋 다 **사람이 눌러야 병합된다**(자동 병합 없음 — 병합은 수강·출결·수납을 옮기고
 * 한쪽을 퇴원시키는 비가역 동작이다).
 *   (a) `natural_key`   이름·학년·학교가 같음(학생 자연키와 같은 차원)
 *   (b) `parent_phone`  이름·학년이 같고 학부모 연락처(숫자만)가 같음 — 보호자1·보호자2(s2_0024) 번호 중 하나라도 겹치면
 *   (c) `auto_suffix`   **접미사만 다르고** 그 이름 무리에 `dup_suspect`가 아직 살아 있음  ← 신규
 *
 * 🔴 **(c)를 `dup_suspect`에 매단 이유** = 배너의 약속과 정확히 같은 집합이기 때문이고, 동시에
 *    **'정상 확인'이 후보를 없애는 유일한 손잡이**이기 때문이다. 접미사를 무조건 벗겨 비교하면 실측
 *    17개 그룹(46명)이 통째로 후보가 되는데, 그중 16개는 학년·학교가 서로 다른 **진짜 동명이인**이고
 *    사람이 이미 손으로 갈라 둔 이름이다 — 그건 [`same-name.ts`](./same-name.ts)가 경고한 **영구 노이즈**다.
 *    (a)·(b)는 이름이 글자까지 같을 때만 걸리므로 접미사 쌍엔 애초에 안 걸린다 → '정상 확인'으로
 *    `dup_suspect`를 내리면 그 쌍은 **완전히** 사라진다(매번 다시 뜨지 않는다).
 * 🔴 **(c)는 이름이 실제로 달라야 한다.** 이름이 글자까지 같은 무리는 통합이 아니라 *"이름을 구분하라"*는
 *    [`same-name.ts`](./same-name.ts) 섹션의 몫이다 — 이 조건 덕분에 두 섹션이 **구조적으로** 같은 쌍을
 *    두고 다투지 않는다((c)가 same-name 그룹 안에서 발화하는 것이 불가능하다).
 * ⚠️ (c)가 걸린 쌍에는 학년·학교·연락처 일치를 **근거로 덧붙이기만** 한다(후보를 넓히지 않는다) —
 *    데스크가 "무엇이 같아서 후보인지"를 보고 판단해야 하기 때문이다.
 */

import { normalizeName } from "@/features/students/lib/student-import";

/** 후보가 된 근거. 화면은 이 값을 라벨로 바꿔 행마다 보여 준다(무엇이 같아서 후보인지). */
export type DuplicateReason = "natural_key" | "parent_phone" | "auto_suffix";

/** 근거 한글 라벨 — 화면에 raw 키를 내보내지 않는다(앱 전역 규약). */
export const DUPLICATE_REASON_LABEL: Record<DuplicateReason, string> = {
  natural_key: "이름·학년·학교 일치",
  parent_phone: "학부모 연락처 일치",
  auto_suffix: "접미사만 다름",
};

/** 판정에 필요한 최소 재료 — 화면이 어떤 필드를 더 싣든 이 판정은 이것만 본다. */
export type DuplicateInput = {
  id: string;
  name: string;
  grade: string | null;
  school: string | null;
  parentPhone: string | null;
  /** 보호자2 연락처(s2_0024) — 보호자1 연락처와 같은 근거로 본다(한 집의 두 보호자가 각자 번호를 적는다). */
  parent2Phone?: string | null;
  /** 동기화가 이름 충돌로 **자동 접미사**를 붙인 학생(0078a). '정상 확인'을 누르면 false가 된다. */
  dupSuspect?: boolean;
};

/**
 * 동기화가 붙인 **알파벳 접미사**를 뗀다 — `권민서B` → `권민서`, `이지호AB` → `이지호`.
 *
 * 규칙의 출처는 `scripts/_makeedu/import-students-list.cjs`의 `excelSuffix()`(엑셀 열 방식:
 * 1→A · 26→Z · 27→AA)이고, 그 접미사는 **대문자 ASCII만** 쓴다. 여기가 그 규칙을 되돌리는 단일 소스다.
 * 🔴 **소문자까지 벗기지 말 것** — `jane` 같은 이름이 통째로 사라진다. 접미사는 대문자로만 붙는다.
 * ⚠️ 남는 글자가 없으면(`ABC`처럼 전부 대문자) 원문을 그대로 돌려준다 — 이름을 빈 문자열로 만드는 것보다
 *    "못 벗겼다"가 정직하다.
 */
export function stripAutoSuffix(name: string): string {
  const trimmed = name.trim();
  const base = trimmed.replace(/[A-Z]+$/, "");
  return base.length > 0 ? base : trimmed;
}

/**
 * '왜 의심인지' 한 줄(원장 2026-10-14 *"왜 의심인지도 간략하게"*). 이 표식(`dup_suspect`)을 켜는 곳은 동기화 하나다 —
 * 같은 이름이 이미 있어 끝에 알파벳을 붙여 새 학생으로 넣었다(`scripts/_makeedu/import-students-list.cjs`).
 * 🔴 뗀 이름·붙인 글자를 **단정하지 않는다** — 원래 이름이 대문자로 끝나면(`김민서G` → 동기화가 `김민서GA`) 끝 대문자를
 *    통째로 접미사로 읽어 사실과 다른 문장이 된다(적대 리뷰). 글자는 바로 옆 이름에 보인다.
 * 끝이 대문자가 아니면(그 뒤 이름을 고쳤다) 알파벳 말을 빼고 적는다 — 지어내지 않는다.
 */
export function suspectReason(name: string): string {
  const trimmed = name.trim();
  return stripAutoSuffix(trimmed) !== trimmed
    ? "동기화 때 같은 이름이 이미 있어 끝에 알파벳을 붙여 따로 등록"
    : "동기화 때 같은 이름이 이미 있어 따로 등록";
}

/** (c)가 쓰는 이름 키 — 접미사를 떼고 **DB `name_normalized` 생성열과 같은 정규화**(소문자+공백 제거). */
export function autoSuffixKey(name: string): string {
  return normalizeName(stripAutoSuffix(name));
}

/**
 * (a)·(b)가 쓰는 이름 키 — **trim + 소문자**(종전 규약 그대로).
 *
 * ⚠️ 여기서 공백까지 접지 말 것. [`same-name.ts`](./same-name.ts)의 제외 판정이 "중복 의심이 실제로 잡는
 * 쌍"만 빼도록 이 규약에 맞춰져 있어서, 한쪽만 넓히면 `김 수아`/`김수아` 같은 쌍이 **양쪽 섹션에서
 * 동시에 사라진다**(same-name.test.ts가 이 경계를 잠근다).
 */
function exactNameKey(name: string): string {
  return name.trim().toLowerCase();
}

const phoneDigits = (v: string | null | undefined): string => (v ?? "").replace(/\D/g, "");
/** 한 학생의 보호자 연락처(숫자만) — 보호자1·보호자2. 빈 값은 뺀다. */
const guardianPhones = (r: Pick<DuplicateInput, "parentPhone" | "parent2Phone">): Set<string> =>
  new Set([phoneDigits(r.parentPhone), phoneDigits(r.parent2Phone)].filter(Boolean));
const gradeKey = (v: string | null | undefined): string => v ?? "";
const schoolKey = (v: string | null | undefined): string => v ?? "";

/**
 * 두 학생이 **왜** 중복 후보인가 — 근거가 하나도 없으면 후보가 아니다(빈 배열).
 *
 * ⚠️ (c)의 근거 덧붙이기(학년·학교·연락처)는 **이미 (c)가 걸린 쌍에만** 작동한다 — 후보를 넓히는
 *    경로가 아니라 화면에 적을 근거를 모으는 경로다.
 */
export function duplicateReasons(a: DuplicateInput, b: DuplicateInput): DuplicateReason[] {
  const sameGrade = gradeKey(a.grade) === gradeKey(b.grade);
  const sameSchool = schoolKey(a.school) === schoolKey(b.school);
  const phonesB = guardianPhones(b);
  const samePhone = [...guardianPhones(a)].some((p) => phonesB.has(p));

  const reasons: DuplicateReason[] = [];
  const sameExactName = exactNameKey(a.name) === exactNameKey(b.name);

  if (sameExactName) {
    if (sameGrade && sameSchool) reasons.push("natural_key");
    if (sameGrade && samePhone) reasons.push("parent_phone");
    return reasons;
  }

  // 이름이 다르다 → 접미사만 다른 쌍인가. 자동 구분 표식(dup_suspect)이 살아 있을 때만.
  const suspected = a.dupSuspect === true || b.dupSuspect === true;
  if (!suspected) return reasons;
  if (autoSuffixKey(a.name) !== autoSuffixKey(b.name)) return reasons;
  if (!autoSuffixKey(a.name)) return reasons; // 이름이 공백뿐인 행은 판정 대상이 아니다

  reasons.push("auto_suffix");
  if (sameGrade && sameSchool) reasons.push("natural_key");
  if (sameGrade && samePhone) reasons.push("parent_phone");
  return reasons;
}

/** 한 그룹 = 서로 이어진 중복 후보들(2명 이상) + 그 그룹이 후보가 된 근거 전부. */
export type DuplicateCandidateGroup<T extends DuplicateInput> = {
  key: string;
  reasons: DuplicateReason[];
  students: T[];
};

const REASON_ORDER: DuplicateReason[] = ["natural_key", "parent_phone", "auto_suffix"];

/**
 * 중복 후보 그룹 뽑기 — 신호로 이어진 학생들을 union-find로 한 덩어리로 묶는다.
 *
 * ⚠️ 호출부는 **퇴원생을 뺀 목록**을 넘긴다(자연키 유니크가 `status<>'withdrawn'`이고, 병합은 진 쪽을
 *    퇴원시키므로 포함하면 "병합했는데 목록에 그대로 남는다").
 * ⚠️ 정렬은 이름 → id로 고정(그룹 순서·그룹 안 순서 모두) — 조회 순서가 흔들려도 페이지가 안 들썩인다.
 */
export function groupDuplicateCandidates<T extends DuplicateInput>(
  rows: readonly T[],
): DuplicateCandidateGroup<T>[] {
  if (rows.length === 0) return [];

  const parent = new Map<string, string>(rows.map((r) => [r.id, r.id]));
  const find = (x: string): string => {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root)!;
    while (parent.get(x) !== root) {
      const next = parent.get(x)!;
      parent.set(x, root);
      x = next;
    }
    return root;
  };
  const union = (a: string, b: string) => parent.set(find(a), find(b));

  // (a)·(b): 이름이 글자까지 같은 쌍만 걸리므로 버킷 한 번이면 된다(전건 O(n)).
  const buckets = new Map<string, string[]>();
  const addToBucket = (key: string, id: string) => {
    const arr = buckets.get(key);
    if (arr) arr.push(id);
    else buckets.set(key, [id]);
  };
  for (const r of rows) {
    const base = `${exactNameKey(r.name)}::${gradeKey(r.grade)}`;
    addToBucket(`nat::${base}::${schoolKey(r.school)}`, r.id);
    for (const phone of guardianPhones(r)) addToBucket(`ph::${base}::${phone}`, r.id);
  }
  for (const ids of buckets.values()) {
    for (let i = 1; i < ids.length; i++) union(ids[0]!, ids[i]!);
  }

  // (c): 접미사를 뗀 이름이 같은 무리 중 **dup_suspect가 살아 있는 무리**만 쌍으로 검사한다.
  //      무리는 실측상 2~3명이라 쌍 검사가 싸고, 쌍 단위로 걸어야 이름이 같은 행이 딸려오지 않는다.
  const byStripped = new Map<string, T[]>();
  for (const r of rows) {
    const key = autoSuffixKey(r.name);
    if (!key) continue;
    const list = byStripped.get(key);
    if (list) list.push(r);
    else byStripped.set(key, [r]);
  }
  for (const list of byStripped.values()) {
    if (list.length < 2) continue;
    if (!list.some((r) => r.dupSuspect === true)) continue;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        if (duplicateReasons(list[i]!, list[j]!).includes("auto_suffix")) {
          union(list[i]!.id, list[j]!.id);
        }
      }
    }
  }

  const comps = new Map<string, T[]>();
  for (const r of rows) {
    const root = find(r.id);
    const list = comps.get(root);
    if (list) list.push(r);
    else comps.set(root, [r]);
  }

  const groups: DuplicateCandidateGroup<T>[] = [];
  for (const list of comps.values()) {
    if (list.length < 2) continue;
    const students = [...list].sort(
      (a, b) => a.name.localeCompare(b.name, "ko") || a.id.localeCompare(b.id),
    );
    // 근거는 그룹 안 모든 쌍의 합집합 — 그룹은 2~3명이라 쌍 검사가 싸다.
    const found = new Set<DuplicateReason>();
    for (let i = 0; i < students.length; i++) {
      for (let j = i + 1; j < students.length; j++) {
        for (const reason of duplicateReasons(students[i]!, students[j]!)) found.add(reason);
      }
    }
    groups.push({
      key: students[0]!.id,
      reasons: REASON_ORDER.filter((r) => found.has(r)),
      students,
    });
  }

  return groups.sort(
    (a, b) =>
      a.students[0]!.name.localeCompare(b.students[0]!.name, "ko") || a.key.localeCompare(b.key),
  );
}

/**
 * **짝 없는 '의심' 학생** — 표식(`dup_suspect`)은 살아 있는데 어느 후보 그룹에도 안 든 학생(짝이 퇴원했거나, 이름을 고쳐
 * 접미사를 뗀 이름이 더는 안 겹친다). 원장 2026-10-14 *"데이터 정리에서는 여전히 정리할 수 있게"* — 원생목록의 '의심'
 * 꼬리표를 걷은 뒤로는 이 목록과 학생 상세가 그 학생을 찾는 자리다('정상 확인'으로 내린다).
 * ⚠️ `groupDuplicateCandidates`에 넘긴 것과 **같은 목록**(퇴원 제외)과 그 결과를 넘긴다. 정렬 = 이름 → id.
 */
export function loneSuspects<T extends DuplicateInput>(
  rows: readonly T[],
  groups: readonly DuplicateCandidateGroup<T>[],
): T[] {
  const grouped = new Set(groups.flatMap((g) => g.students.map((s) => s.id)));
  return rows
    .filter((r) => r.dupSuspect === true && !grouped.has(r.id))
    .sort((a, b) => a.name.localeCompare(b.name, "ko") || a.id.localeCompare(b.id));
}
