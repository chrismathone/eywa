/**
 * **같은 이름을 쓰는 학생** 판정 — 순수 로직(IO 없음 · Vitest).
 *
 * 원장 지시(2026-08-20): *"데이터 정리에 이름 중복되는것도 확인가능하도록. 방금 이지호A가 둘이라서
 * 내가 한명을 이지호B로 교체함."*
 *
 * 기존 **중복 의심**([`findDuplicateStudents`](./server/queries.ts))은 ① 이름+학년+학교가 모두 같거나
 * ② 이름+학년이 같고 학부모 연락처가 같을 때만 잡는다. 원장이 만난 두 `이지호A`는 **학교도 학년도
 * 달랐고**(옥산초4 vs 달성초1) 그래서 어디에도 안 걸렸다 — 화면이 *"중복 의심 학생이 없습니다"* 라고
 * 말하는 동안 목록엔 같은 이름이 둘 있었다.
 *
 * 🔴 **이건 '통합' 후보가 아니다.** 중복 의심의 행동은 통합이고 통합은 한쪽을 **퇴원 처리**한다.
 *    동명이인은 **다른 사람**이라 통합하면 남의 수강·출결·수납이 통째로 옮겨간다. 이 판정의 행동은
 *    *"이름을 구분하라"*(접미사)이지 통합이 아니다 — 그래서 섹션도 따로 둔다.
 * 🔴 **접미사를 벗겨 비교하지 않는다.** `이지호`와 `이지호A`는 **이미 구분된 상태**다. 벗겨서 묶으면
 *    데스크가 손을 쓸 수 없는 그룹이 영구히 남는다(=영구 노이즈).
 * ⚠️ 퇴원생은 입력에서 제외한다(호출부 쿼리가 거른다) — 목록에 안 뜨는 사람은 헷갈릴 일도 없고,
 *    기존 중복 의심 쿼리와 같은 결이다.
 */

import { duplicateReasons } from "./duplicate-candidates";

/** 판정에 필요한 최소 재료 — 화면이 어떤 필드를 더 싣든 이 판정은 이것만 본다. */
export type SameNameInput = {
  id: string;
  name: string;
  grade: string | null;
  school: string | null;
  parentPhone: string | null;
  /** 보호자2 연락처(s2_0024) — 통합 섹션의 연락처 신호가 보는 값이라 함께 넘긴다(안 넘기면 그 쌍이 두 섹션에 동시에 뜬다). */
  parent2Phone?: string | null;
  /**
   * 동기화 자동 접미사 표식(0078a). 통합 섹션의 세 번째 신호(`auto_suffix`)가 이 값을 보므로 **그쪽이
   * 잡는 쌍인지**를 정확히 판단하려면 함께 넘겨야 한다(안 넘기면 그 쌍이 두 섹션에 동시에 뜬다).
   */
  dupSuspect?: boolean;
};

/**
 * 같은 이름인가를 판정할 때 쓰는 정규화 — **앞뒤·중간 공백을 한 칸으로 접고 소문자화**.
 *
 * 공백을 접는 이유: `이지호 `와 `이지호`는 화면에서 **똑같이 보인다**(데스크가 구분할 수 없는 것이
 * 곧 이 점검의 대상이다). 소문자화는 기존 중복 의심 판정과 같은 규약이다.
 * ⚠️ 여기서 **더** 지우지 말 것 — 접미사(A·B)·가운뎃점까지 벗기면 이미 구분해 둔 이름이 다시 묶인다.
 */
export function sameNameKey(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * 기존 **중복 의심**(통합 섹션)이 이미 잡고 있는 쌍인가.
 *
 * 🔑 판정은 [`duplicateReasons`](./duplicate-candidates.ts) **단일 소스**에 위임한다 — 종전엔 그쪽 두
 *    신호를 여기에 손으로 베껴 뒀는데, 2026-09-10에 통합 쪽에 세 번째 신호(접미사)가 붙으면서 사본이
 *    한 발 뒤처지면 같은 쌍이 두 섹션에 동시에 뜨는 구조였다.
 * ⚠️ 이름 비교 규약도 그쪽 것을 그대로 쓴다(trim+소문자). 이쪽 정규화(공백 접기)로 판단하면, 중복
 *    의심이 실제로는 못 잡는 쌍(`김 수아` vs `김수아`)을 "이미 잡혔다"고 착각해 **양쪽에서 사라진다**.
 */
function alreadySuspectedPair(a: SameNameInput, b: SameNameInput): boolean {
  return duplicateReasons(a, b).length > 0;
}

/** 한 그룹 = 같은 이름을 쓰는 학생들(2명 이상). `key`는 정규화된 이름이라 목록에서 안정적이다. */
export type SameNameGroup<T extends SameNameInput> = { key: string; name: string; students: T[] };

/**
 * 같은 이름 그룹 뽑기 — **이름 문자열이 같은 비퇴원 학생 2명 이상**.
 *
 * 🔴 그룹 안에 **중복 의심으로 이미 잡힌 쌍**이 하나라도 있으면 그 그룹은 통째로 뺀다(통합 섹션이
 *    맡는다). 통합이 끝나면 진 쪽이 퇴원이 되어 입력에서 빠지고, 남은 동명이인 쌍은 다음 조회에서
 *    여기 뜬다 — 두 섹션이 같은 쌍을 두고 다투지 않는다.
 * ⚠️ 정렬은 **이름 → id**로 고정한다(그룹 순서·그룹 안 순서 모두). 조회 순서가 흔들려도 화면이
 *    들썩이지 않아야 "어제 봤던 그 줄"을 다시 찾을 수 있다.
 */
export function groupSameNameStudents<T extends SameNameInput>(rows: readonly T[]): SameNameGroup<T>[] {
  const byKey = new Map<string, T[]>();
  for (const r of rows) {
    const key = sameNameKey(r.name);
    if (!key) continue; // 이름이 없는 행은 판정 대상이 아니다(화면에 그릴 것도 없다)
    const list = byKey.get(key);
    if (list) list.push(r);
    else byKey.set(key, [r]);
  }

  const groups: SameNameGroup<T>[] = [];
  for (const [key, list] of byKey) {
    if (list.length < 2) continue;
    let suspected = false;
    for (let i = 0; i < list.length && !suspected; i++) {
      for (let j = i + 1; j < list.length; j++) {
        if (alreadySuspectedPair(list[i]!, list[j]!)) {
          suspected = true;
          break;
        }
      }
    }
    if (suspected) continue;
    const students = [...list].sort((a, b) => a.id.localeCompare(b.id));
    groups.push({ key, name: students[0]!.name.trim(), students });
  }
  return groups.sort((a, b) => a.name.localeCompare(b.name, "ko") || a.key.localeCompare(b.key));
}
