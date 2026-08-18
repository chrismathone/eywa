/**
 * 진도 되감기 **계산**(순수 · Vitest) — 보고서를 지울 때 그 보고서가 밀어 올린 진도를 되돌린다.
 *
 * 원장 2026-08-18: *"진도기록도 되돌려야지"*. 보강 보고서를 지워도 `progress_entries`는 FK가 SET NULL이라
 * 행이 남고 `progress_containers.last_position`은 그 보고서가 올려둔 값 그대로였다 — 학생 진도 위치가
 * **앞당겨진 채 고정**돼 다음 수업의 점프 판정과 예측이 전부 어긋난다("추가 전으로"가 성립하지 않는다).
 *
 * 🔴 되감기는 "빼기"가 아니라 **남은 것으로 다시 계산**이다. `last_position -= 1` 같은 산술은 틀린다 —
 *    엔트리는 날짜순으로 쌓이고 마지막이 최고 위치라는 보장이 없다(복습·역행 입력이 실제로 있다).
 *    `max_jump`도 마찬가지라 남은 엔트리로 처음부터 다시 잰다.
 */

/** 컨테이너에 남은 엔트리 한 줄(되감기 계산에 필요한 것만). */
export type RemainingEntry = {
  /** 정렬 축 — 실제 수업일. */
  entryDate: string;
  /** 커리큘럼 글로벌 위치. null이면 위치 판정에서 제외(원문만 남은 엔트리). */
  globalPosition: number | null;
};

export type ContainerRollback = {
  /** 남은 엔트리의 **마지막(날짜순) 위치**. 하나도 없으면 개시 위치로 되돌린다. */
  lastPosition: number | null;
  /** 남은 엔트리 수. */
  chapterCount: number;
  /** 남은 엔트리로 다시 잰 최대 전진 폭. */
  maxJump: number;
};

/**
 * 엔트리 하나를 뺀 뒤의 컨테이너 상태를 계산한다.
 *
 * @param remaining   그 컨테이너에 **남는** 엔트리 전부(순서 무관 — 여기서 날짜순 정렬한다).
 * @param startPosition 컨테이너 개시 위치 — 엔트리가 0개가 되면 여기로 되돌린다(openContainer가 start=last로 연다).
 */
export function rollbackContainer(
  remaining: RemainingEntry[],
  startPosition: number | null,
): ContainerRollback {
  const sorted = [...remaining].sort((a, b) => (a.entryDate < b.entryDate ? -1 : a.entryDate > b.entryDate ? 1 : 0));
  const positions = sorted
    .map((e) => e.globalPosition)
    .filter((p): p is number => typeof p === "number");
  if (sorted.length === 0) {
    // 엔트리가 없으면 "막 열린 컨테이너"와 같은 상태 — 개시 위치로.
    return { lastPosition: startPosition, chapterCount: 0, maxJump: 0 };
  }
  // 개시 위치부터 순서대로 다시 훑어 전진 폭을 잰다(appendEntry와 같은 규칙: 뒤로 간 건 0).
  let prev = startPosition;
  let maxJump = 0;
  for (const p of positions) {
    if (prev != null) maxJump = Math.max(maxJump, Math.max(0, p - prev));
    prev = p;
  }
  return {
    // 위치가 있는 엔트리가 하나도 없으면(전부 원문만) 개시 위치 유지 — 지어내지 않는다.
    lastPosition: positions.length ? positions[positions.length - 1]! : startPosition,
    chapterCount: sorted.length,
    maxJump,
  };
}
