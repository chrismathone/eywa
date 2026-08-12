/**
 * ECS 주간 랜딩 **담임 보기 필터** — 옵션 만들기·유효성·거르기(순수 함수).
 *
 * 원장 2026-08-11: *"담임 필터링 가능하게."* 42반이 한 장에 들어오면서 "이 사람 반만" 보는 일이
 * 실제로 가능해졌다(카드 벽일 땐 어차피 스크롤이라 필터가 있어도 못 썼다).
 *
 * 🔴 **옵션은 '지금 목록에 있는 담임'에서만 만든다.** 그래서 어떤 옵션을 골라도 결과가 0개가 되지 않는다
 *    — 눌러서 빈 화면이 되는 칸을 애초에 안 만드는 쪽이, 빈 화면을 잘 설명하는 것보다 낫다.
 *    (프로그램 필터는 반대 규약이다 — 거긴 개수가 **필터 전** 집합이라 0인 칸도 눌러볼 수 있다.
 *     둘이 다른 이유: 프로그램은 3칸 고정 토글이라 "왜 못 누르지"가 생기고, 담임은 목록형이라
 *     애초에 없는 이름을 안 보여주면 그만이다.)
 * 🔴 **저장값이 지금 옵션에 없으면 '전체'로 떨어뜨린다**(퇴사·반 인계·프로그램 필터 변경으로 그 담임의
 *    반이 이 주에 없을 때). 저장값은 **덮어쓰지 않는다** — 다음 주에 그 반이 돌아오면 필터도 돌아온다.
 *    id를 화면에 그대로 노출할 수는 없으므로(raw 코드 금지) 이름을 못 찾은 값은 고를 수 없는 값이다.
 */

/** 전체 보기 — 저장 안 함(기본값). */
export const ECS_TEACHER_ALL = "all";
/** 담임이 지정되지 않은 반 — 사람 id가 아니라 '빈 담임'이라는 상태라 별도 sentinel. */
export const ECS_TEACHER_NONE = "none";

export type LandingTeacherOption = { value: string; label: string; count: number };

/** 옵션 만들기에 필요한 최소 모양(서버 행에 묶지 않는다). */
export type TeacherFilterable = { teacherId: string | null };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 저장값 정규화 — 모르는 모양은 전부 '전체'.
 * ⚠️ 깨진 값을 그대로 통과시키면 반 목록이 통째로 비어 "반이 사라졌다"가 된다(englishTrack과 같은 규약).
 */
export function normalizeEcsTeacher(raw: unknown): string {
  if (typeof raw !== "string") return ECS_TEACHER_ALL;
  const v = raw.trim();
  if (v === ECS_TEACHER_ALL || v === ECS_TEACHER_NONE) return v;
  return UUID_RE.test(v) ? v : ECS_TEACHER_ALL;
}

/**
 * 지금 목록에 있는 담임으로 옵션을 만든다. 이름순(ko), **'담임 미지정'은 항상 맨 뒤**(사람이 아니라 상태).
 * 이름을 못 찾은 담임은 옵션에서 뺀다 — 화면에 uuid를 보일 수는 없다(raw 코드 노출 금지).
 */
export function buildTeacherOptions(
  rows: readonly TeacherFilterable[],
  nameById: ReadonlyMap<string, string | null>,
): LandingTeacherOption[] {
  const counts = new Map<string, number>();
  let none = 0;
  for (const r of rows) {
    if (!r.teacherId) {
      none += 1;
      continue;
    }
    counts.set(r.teacherId, (counts.get(r.teacherId) ?? 0) + 1);
  }
  const named: LandingTeacherOption[] = [];
  for (const [id, count] of counts) {
    const label = nameById.get(id);
    if (!label) continue;
    named.push({ value: id, label, count });
  }
  named.sort((a, b) => a.label.localeCompare(b.label, "ko"));
  if (none > 0) named.push({ value: ECS_TEACHER_NONE, label: "담임 미지정", count: none });
  return named;
}

/** 저장값이 지금 고를 수 있는 값인가 — 아니면 '전체'. */
export function resolveTeacherFilter(stored: unknown, options: readonly LandingTeacherOption[]): string {
  const v = normalizeEcsTeacher(stored);
  if (v === ECS_TEACHER_ALL) return ECS_TEACHER_ALL;
  return options.some((o) => o.value === v) ? v : ECS_TEACHER_ALL;
}

/** 담임으로 거른다. `all`이면 그대로, `none`이면 담임 없는 반만. */
export function keepTeacher<T extends TeacherFilterable>(rows: readonly T[], filter: string): T[] {
  if (filter === ECS_TEACHER_ALL) return [...rows];
  if (filter === ECS_TEACHER_NONE) return rows.filter((r) => !r.teacherId);
  return rows.filter((r) => r.teacherId === filter);
}
