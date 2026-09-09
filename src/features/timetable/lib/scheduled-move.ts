/**
 * **예약된 반 이동**(이미 저장돼 그날 저절로 일어날 이동)을 수강 행에서 알아보는 순수 함수.
 *
 * 원장 2026-09-09: *"기존 수업에서는 '연보라색 계열'로 '이동 대기' 상태가 되고, 미래에 이동할 반에서는
 * '대기'생 상태가 되는것."* → *"'반이동 대기'일 경우에 툴팁에 기존 반이름도 나와있어야함."*
 *
 * 🔑 **DB에는 이미 그렇게 저장돼 있다** — 반 이동 RPC(`move_enrollments_batch`)가 적용일을 받으면
 *    옛 수강 `end_date = 적용일` + `is_transferred`, 새 수강 `start_date = 적용일` + `is_transferred_in`으로
 *    두 행을 만든다. 그래서 적용일이 미래면 명단 쿼리가 옛 반에선 **재원**, 새 반에선 **대기**로 읽는다.
 *    빠져 있던 것은 화면이 그 둘을 **한 사건으로 잇지 못한 것**뿐이다(도착 반 대기 칸에 낯선 이름이
 *    앉아 있는데 어느 반에서 오는지 알 길이 없었고, 출발 반은 아무 표시도 없었다).
 *
 * 🔴 **새 표도 새 컬럼도 만들지 않는다** — 두 행을 `(학생, 날짜)`로 맞물리면 그게 곧 한 사건이다.
 * ⚠️ 짝이 화면 밖(다른 과목·비활성 반)이면 상대 반을 못 찾는다 — 그때는 **날짜만** 말하고 반 이름은
 *    비운다(모르는 것을 지어내지 않는다).
 * ⚠️ 한 학생이 **같은 날짜에 두 건** 예약돼 있으면(수강 여러 개를 한꺼번에 옮긴 경우) 짝이 모호하다 —
 *    그럴 땐 상대 반을 비운다(엉뚱한 반 이름을 적는 것보다 안 적는 편이 낫다).
 */

export type ScheduledMoveRow = {
  /** 수강 id — 결과 맵의 키. */
  id: string;
  classId: string;
  studentId: string;
  startDate: string;
  endDate: string | null;
  isTransferred: boolean;
  isTransferredIn: boolean;
};

/** 한 수강 행이 걸려 있는 예약 이동 — `otherClassId`는 못 찾으면 null. */
export type ScheduledMove = { on: string; otherClassId: string | null };

export type ScheduledMoves = {
  /** 이 반에서 **나갈** 예정(적용일까지는 이 반 학생) — 수강 id → 예약. */
  out: Map<string, ScheduledMove>;
  /** 이 반으로 **들어올** 예정(적용일까지는 대기) — 수강 id → 예약. */
  in: Map<string, ScheduledMove>;
};

/**
 * @param rows 화면에 뜬 반들의 수강 행 전부(짝을 여기서 찾는다 — 조회를 더 하지 않는다).
 * @param referenceDate 그 주의 기준일(`YYYY-MM-DD`) — 이보다 **뒤**여야 예약이다(오늘은 즉시다).
 */
export function pairScheduledMoves(
  rows: readonly ScheduledMoveRow[],
  referenceDate: string,
): ScheduledMoves {
  const out = new Map<string, ScheduledMove>();
  const ins = new Map<string, ScheduledMove>();
  if (rows.length === 0 || !referenceDate) return { out, in: ins };

  /** `학생|날짜` → 그 날짜에 시작하는 전입 행들(짝 후보). 여럿이면 모호라 안 쓴다. */
  const inByKey = new Map<string, ScheduledMoveRow[]>();
  /** `학생|날짜` → 그 날짜에 끝나는 전출 행들. */
  const outByKey = new Map<string, ScheduledMoveRow[]>();
  for (const r of rows) {
    if (r.isTransferredIn && r.startDate > referenceDate) {
      const k = `${r.studentId}|${r.startDate}`;
      const arr = inByKey.get(k);
      if (arr) arr.push(r);
      else inByKey.set(k, [r]);
    }
    if (r.isTransferred && r.endDate && r.endDate > referenceDate) {
      const k = `${r.studentId}|${r.endDate}`;
      const arr = outByKey.get(k);
      if (arr) arr.push(r);
      else outByKey.set(k, [r]);
    }
  }

  /** 짝이 정확히 하나이고 **다른 반**일 때만 반 id를 준다(모호·자기 자신은 null). */
  const mate = (list: ScheduledMoveRow[] | undefined, selfClassId: string): string | null => {
    if (!list) return null;
    const others = list.filter((r) => r.classId !== selfClassId);
    return others.length === 1 ? others[0]!.classId : null;
  };

  for (const [k, list] of outByKey)
    for (const r of list) out.set(r.id, { on: r.endDate!, otherClassId: mate(inByKey.get(k), r.classId) });
  for (const [k, list] of inByKey)
    for (const r of list) ins.set(r.id, { on: r.startDate, otherClassId: mate(outByKey.get(k), r.classId) });

  return { out, in: ins };
}
