/**
 * 출결 저장이 **어느 행을 고칠지** 정하는 규칙 — 셀 저장과 일괄 저장이 이 한 곳을 공유한다.
 *
 * `attendance_records`는 정정을 새 행으로 남기는 append-only 표이고, 0196a 이후 **교시(`slot_start`)가
 * 있는 행**과 그 이전의 **"그날 전체"(null) 행**이 한 표에 섞여 산다(실측 2026-08-14: 공존 조합 37건).
 * 이 섞임 때문에 저장 대상을 잘못 고르면 화면은 멀쩡한데 **돈이 조용히 틀어진다**:
 *
 *  · 옛 day-level 행을 못 보고 새 교시 행을 INSERT하면 같은 (학생·반·날짜)에 **두 행이 살아남아**
 *    시수·회차가 두 번 세어진다(정정이 급여에 안 닿는 꼴).
 *  · 반대로 day-level 행을 **입양만** 하면 하루 두 번 만나는 반에서 두 교시가 한 행을 공유해
 *    먼저 찍은 교시가 조용히 덮인다(실측: 영어 116 반×요일이 하루 2교시 이상, 최대 4교시).
 *
 * 그래서 규칙은 셋이다 — ① 교시를 안 넘긴 저장(출석부)은 그날 **모든 교시 행**을 함께 고친다(한 칸에
 * 한 상태). ② 교시를 넘겼고 **그 교시 행이 있으면** 그 행을 고친다(day-level 행이 남아 있으면 상태가
 * 갈리지 않게 함께 고친다). ③ 교시를 넘겼는데 **day-level 행뿐이면 그 행을 그 교시로 승격**한다 —
 * 새 행을 만들지 않으므로 이중 계상 없이 교시 정체성만 얻는다.
 *
 * 🔴 저장 축 자체(교시로 쓸 것이냐)는 여기가 아니라 [`live/slot-axis.ts`](./live/slot-axis.ts)가 정한다.
 *    수학은 하루 한 행이 규약이라 애초에 `slot === null`로 들어온다.
 */

export type SaveTargetRow = {
  id: string;
  /** null = "그날 전체"(0196a 이전 기록). "HH:MM[:SS]" 형태는 앞 5자만 비교한다. */
  slot_start?: string | null;
};

export type SaveTargets = {
  /** 그대로 갱신할 행 id. */
  updateIds: string[];
  /** 갱신하면서 `slot_start`를 그 교시로 **승격**할 행 id(옛 "그날 전체" 행). */
  promoteIds: string[];
};

const DAY = ""; // 교시 없는 행의 키

/**
 * 한 칸(학생·반·날짜)의 기록들 중 저장 대상을 고른다.
 *
 * @param rowsNewestFirst `recorded_at` 내림차순 — **교시마다 처음 만난 행이 최신**이라는 전제다
 *   (effectiveAttendanceRecords와 같은 규칙). 정렬이 다르면 옛 행을 고친다.
 * @param slot 저장할 교시("HH:MM") 또는 null("그날 전체").
 */
export function pickSaveTargets(rowsNewestFirst: readonly SaveTargetRow[], slot: string | null): SaveTargets {
  const latestBySlot = new Map<string, string>();
  for (const row of rowsNewestFirst) {
    const key = row.slot_start ? row.slot_start.slice(0, 5) : DAY;
    if (!latestBySlot.has(key)) latestBySlot.set(key, row.id);
  }

  // ① 교시 미지정 — 그날 있는 행을 전부 같은 상태로 맞춘다(출석부 한 칸 = 하루 하나의 사실).
  if (slot === null) return { updateIds: [...latestBySlot.values()], promoteIds: [] };

  const key = slot.slice(0, 5);
  const sameSlot = latestBySlot.get(key);
  const dayRow = latestBySlot.get(DAY);

  // ② 그 교시 행이 있다 — 그 행이 대상. day-level 행이 함께 있으면 상태가 갈리지 않게 같이 고친다
  //    (그 행은 다른 교시의 폴백으로 읽히므로 두고 오면 옛 상태가 남의 칸에 보인다).
  if (sameSlot) return { updateIds: dayRow ? [sameSlot, dayRow] : [sameSlot], promoteIds: [] };

  // ③ day-level 행뿐 — 승격. 없으면 대상이 없다(호출부가 INSERT).
  return { updateIds: [], promoteIds: dayRow ? [dayRow] : [] };
}

/** 이 칸에 이미 유효 기록이 있나 — '빈 칸만 채우기'의 서버 판정. */
export function hasSaveTarget(targets: SaveTargets): boolean {
  return targets.updateIds.length > 0 || targets.promoteIds.length > 0;
}
