/**
 * "그 날 이 반 이름은 뭐가 되나" **미리 보기**(순수 · Vitest) — 원장 2026-08-29:
 * *"반이름을 미래걸로 이동한다고 보여줄 수 있는 기능은 안돼? 선생님들이 미래조회시에 지금 반으로 보면
 * 착각할 수 있을거같은데"*.
 *
 * 🔴 **반 이름도 담임처럼 시간 축이 없다.** `classes.class_name` 한 칸뿐이라, 9/1로 예약해 둔 이름 변경
 *    17건이 있어도 9월 주간 시간표에 **오늘 이름**(DP6)이 그려진다 — 그 주에 그 반은 PL1a인데.
 *    강사가 미래 주를 열어 "DP6 그대로구나"로 읽으면 그건 화면이 만든 오해다.
 *
 * [`teacher-as-of.ts`](./teacher-as-of.ts)의 **거울상**이다. 그쪽은 지난 주를 기록으로 되살리고,
 * 이쪽은 다음 주를 **예약으로 앞당겨 보여 준다**. 근거도 추정이 아니라 사실 하나뿐이다 —
 * 가져오기 스냅샷의 `classUpdates[].className`(9/1 cron이 그대로 재생할 바로 그 값).
 *
 * 🔴 판정은 [`shouldApplyName`](../timetable/due-class-updates.ts)과 **같아야 한다** — cron이 실제로
 *    적용할 때만 미리 보여 준다. 사람이 그 사이 이름을 손으로 바꿨으면 cron은 건너뛰므로(예약 시점과
 *    현재 이름이 다르다) 화면도 아무 말 하지 않아야 한다. 갈리면 화면이 오지 않을 미래를 약속한다.
 */

/** 예약된 이름 변경 한 건. `from`이 **현재 이름과 같을 때만** 적용된다(cron과 같은 조건). */
export type PendingRename = {
  classId: string;
  /** 예약 시점의 이름. */
  from: string | null;
  to: string;
  /** 적용일 `YYYY-MM-DD`. */
  date: string;
};

/** classId → 적용일 오름차순 예약 목록. */
export type ClassNameAsOfIndex = Map<string, PendingRename[]>;

export function buildClassNameAsOfIndex(renames: readonly PendingRename[]): ClassNameAsOfIndex {
  const index: ClassNameAsOfIndex = new Map();
  for (const r of renames) {
    if (!r.classId || !r.to) continue;
    const list = index.get(r.classId);
    if (list) list.push(r);
    else index.set(r.classId, [r]);
  }
  // 사슬을 순서대로 걸어야 하므로 날짜 오름차순. 같은 날짜가 둘이면 입력 순서를 지킨다(안정 정렬).
  for (const list of index.values()) list.sort((a, b) => a.date.localeCompare(b.date));
  return index;
}

/**
 * `date`(그 칸의 실제 날짜) 시점에 이 반이 불릴 이름. 바뀌지 않으면 **null**(호출부가 현재 이름을 쓴다).
 *
 * 사슬을 지원한다 — 9/1 `DP6→PL1a`, 10/1 `PL1a→PL2`가 함께 예약돼 있으면 10월 칸은 `PL2`다.
 * ⚠️ 중간 고리가 어긋나면(누가 손으로 바꿨다) **거기서 멈춘다** — 억지로 이어 붙이면 오지 않을 이름이 뜬다.
 */
export function resolveClassNameAsOf(
  index: ClassNameAsOfIndex,
  classId: string,
  date: string,
  currentName: string | null,
): { name: string; before: string; date: string } | null {
  const list = index.get(classId);
  if (!list || !currentName) return null;

  let name = currentName;
  let appliedAt: string | null = null;
  for (const r of list) {
    if (r.date > date) break; // 아직 오지 않은 예약
    if ((r.from ?? null) !== name) break; // 사슬이 끊겼다 — cron도 여기서 건너뛴다
    name = r.to;
    appliedAt = r.date;
  }
  if (!appliedAt || name === currentName) return null;
  return { name, before: currentName, date: appliedAt };
}

/**
 * **주 단위 표면용**(ECS 랜딩·시트 헤더) — 그 주에 이 반을 뭐라고 부르나 + 그 주 안에 개명이 오는가.
 *
 * 🔴 시간표(칸 단위)와 축이 다르다. 시간표는 칸마다 실제 날짜가 있어 `resolveClassNameAsOf`로 정확히
 *    가르지만, ECS의 한 주는 이름 한 개로 부른다. 그래서 **주 시작 시점의 이름**을 쓰고(넘겨짚지 않는다),
 *    그 주 **안에** 개명이 오면 `upcoming`으로 따로 알린다 — 전환 주엔 두 이름이 다 사실이기 때문이다.
 *    (주 끝 이름을 쓰면 월요일에 이미 새 이름으로 불러 앞서 가고, 예고를 안 하면 원장 지적대로 착각한다.)
 */
export function classNameForWeek(
  index: ClassNameAsOfIndex,
  classId: string,
  weekStart: string,
  weekEnd: string,
  currentName: string | null,
): { name: string; before?: string; upcoming?: { name: string; date: string } } | null {
  if (!currentName) return null;
  const atStart = resolveClassNameAsOf(index, classId, weekStart, currentName);
  const atEnd = resolveClassNameAsOf(index, classId, weekEnd, currentName);
  const name = atStart?.name ?? currentName;
  const upcoming = atEnd && atEnd.name !== name ? { name: atEnd.name, date: atEnd.date } : undefined;
  if (!atStart && !upcoming) return null; // 이 주엔 아무 일도 없다 — 호출부가 DB 이름을 그대로 쓴다
  return { name, ...(atStart ? { before: atStart.before } : {}), ...(upcoming ? { upcoming } : {}) };
}
