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
  if (!currentName) return null;
  const w = walkRenames(index, classId, date, currentName);
  if (!w.appliedAt || w.name === currentName) return null;
  return { name: w.name, before: currentName, date: w.appliedAt };
}

/**
 * 사슬을 `date`까지 걸어 **그 시점 이름**과 **바로 다음에 올 예약 한 건**을 함께 돌려준다.
 * `next`는 아직 오지 않은 예약 중 **가장 이른 것**이다(더 뒤엣것을 먼저 알리면 코앞의 변경을 가린다).
 */
function walkRenames(
  index: ClassNameAsOfIndex,
  classId: string,
  date: string,
  currentName: string,
): { name: string; appliedAt: string | null; next: { name: string; date: string } | null } {
  const list = index.get(classId);
  if (!list) return { name: currentName, appliedAt: null, next: null };
  let name = currentName;
  let appliedAt: string | null = null;
  for (const r of list) {
    if ((r.from ?? null) !== name) break; // 사슬이 끊겼다 — cron도 여기서 건너뛴다
    if (r.date > date) return { name, appliedAt, next: { name: r.to, date: r.date } }; // 아직 오지 않은 예약
    name = r.to;
    appliedAt = r.date;
  }
  return { name, appliedAt, next: null };
}

/**
 * **주 단위 표면용**(ECS 랜딩·시트 헤더) — 그 주에 이 반을 뭐라고 부르나 + 곧 무엇이 되는가.
 *
 * 🔴 시간표(칸 단위)와 축이 다르다. 시간표는 칸마다 실제 날짜가 있어 `resolveClassNameAsOf`로 정확히
 *    가르지만, ECS의 한 주는 이름 한 개로 부른다. 그래서 **주 시작 시점의 이름**을 쓴다(넘겨짚지 않는다 —
 *    주 끝 이름을 쓰면 9/1 화요일 개명을 월요일부터 새 이름으로 불러 하루 앞서 간다).
 *
 * 🔴 **예고(`upcoming`)는 개명이 오는 그 주에만 붙이지 않는다 — 예약이 잡힌 때부터 그날까지 내내 붙인다**
 *    (원장 2026-08-29: *"예약한 순간부터 지금부터 변경날까지 계속 달아줘. 왜냐면 이동당일에 달려있으면
 *    실제로 이전의 담임은 볼 기회가 없음"*). 개명은 담임 교체와 같은 날 오는 일이 잦은데, 전환 주에만
 *    알리면 **그때 그 반은 이미 남의 반**이라 옛 담임 화면엔 뜨지 않는다 — 정작 알아야 할 사람이 못 본다.
 *    ⚠️ 이미 지나간 주(주 끝 < 오늘)엔 안 붙인다. 지난 주 시트는 기록이라 앞으로의 일로 어지럽히지 않는다.
 *    ⚠️ 예고와 옛 이름(`before`)이 함께 나올 수 있다(개명이 사슬로 두 번 예약된 반) — 호출부는 **예고를
 *       먼저** 보인다(옛 이름은 찾기용, 예고는 대비용이라 급한 쪽이 다르다).
 */
export function classNameForWeek(
  index: ClassNameAsOfIndex,
  classId: string,
  weekStart: string,
  weekEnd: string,
  currentName: string | null,
  /** 오늘(KST) — 지나간 주에는 예고를 붙이지 않기 위해서만 쓴다. */
  today: string,
): { name: string; before?: string; upcoming?: { name: string; date: string } } | null {
  if (!currentName) return null;
  const w = walkRenames(index, classId, weekStart, currentName);
  const before = w.appliedAt && w.name !== currentName ? currentName : undefined;
  const upcoming = weekEnd >= today ? (w.next ?? undefined) : undefined;
  if (!before && !upcoming) return null; // 이 주엔 아무 일도 없다 — 호출부가 DB 이름을 그대로 쓴다
  return { name: w.name, ...(before ? { before } : {}), ...(upcoming ? { upcoming } : {}) };
}
