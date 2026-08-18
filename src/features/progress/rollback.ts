/**
 * 진도 되감기 **계산**(순수 · Vitest) — 보고서를 지울 때 그 보고서가 밀어 올린 진도를 되돌린다.
 *
 * 원장 2026-08-18: *"진도기록도 되돌려야지"*. 보강 보고서를 지워도 `progress_entries`는 FK가 SET NULL이라
 * 행이 남고 `progress_containers.last_position`은 그 보고서가 올려둔 값 그대로였다 — 학생 진도 위치가
 * **앞당겨진 채 고정**돼 다음 수업의 점프 판정과 예측이 전부 어긋난다("추가 전으로"가 성립하지 않는다).
 *
 * 🔴 되감기는 "빼기"가 아니라 **남은 것으로 다시 계산**이다(`last_position -= 1` 같은 산술은 틀린다).
 * 🔴 **정렬축은 인제스트 순서(`created_at`)** — 날짜(`entry_date`)가 아니다. ingest는 `container.lastPosition`
 *    기준으로 점프를 재는데(ingest.ts `appendEntry`), 그건 **저장된 순서**다. 지난 날짜 보고서를 나중에
 *    입력하는 backfill이 흔해서 날짜순으로 재면 값이 갈린다(실측: 저장된 max_jump와 2개 컨테이너 불일치).
 *    ⚠️ 복습·역행은 애초에 엔트리를 만들지 않으므로(ingest가 review로 걸러낸다) 인제스트 순서는 단조 증가다.
 */

export type RemainingEntry = {
  /** 인제스트(저장) 시각 — ingest가 점프를 잰 그 순서. 정렬축. */
  createdAt: string;
  /** 커리큘럼 글로벌 위치. null이면 위치 판정에서 제외(원문만 남은 엔트리). */
  globalPosition: number | null;
};

export type ContainerRollback = {
  /** 남은 엔트리의 마지막(인제스트 순) 위치. */
  lastPosition: number | null;
  /** 남은 엔트리 수. */
  chapterCount: number;
  /** 남은 엔트리로 다시 잰 최대 전진 폭. */
  maxJump: number;
  /**
   * 이 컨테이너를 **통째로 지워야 하는가** — 남은 엔트리가 0이면 true.
   * 🔴 빈 컨테이너를 `start_position`으로 되돌려 두면 안 된다. `openContainer`가 start=last=그 수업 위치로
   *    열기 때문에, 유일한 엔트리를 지워도 **지운 그 수업 위치가 "현재 진도"로 남는다**(진도 탭·예측이
   *    그 값을 읽는다). 다음 보고서가 그 위치 이하면 복습으로 걸러져 진도가 조용히 유실되고, 크게 위면
   *    점프 오류가 난다(적대 리뷰 치명). 컨테이너를 지우면 다음 인제스트가 새로 연다 = 추가 전 상태.
   */
  dropContainer: boolean;
};

/**
 * 엔트리를 뺀 뒤의 컨테이너 상태를 계산한다.
 *
 * @param remaining   그 컨테이너에 **남는** 엔트리 전부(순서 무관 — 여기서 인제스트 순으로 정렬한다).
 * @param startPosition 컨테이너 개시 위치 — 위치가 있는 엔트리가 없을 때의 기준.
 */
export function rollbackContainer(
  remaining: RemainingEntry[],
  startPosition: number | null,
): ContainerRollback {
  if (remaining.length === 0) {
    return { lastPosition: startPosition, chapterCount: 0, maxJump: 0, dropContainer: true };
  }
  const sorted = [...remaining].sort((a, b) =>
    a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0,
  );
  const positions = sorted
    .map((e) => e.globalPosition)
    .filter((p): p is number => typeof p === "number");
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
    dropContainer: false,
  };
}
