/**
 * 출석부 "바로 열기" 허브의 과목별 그룹핑 — 순수 함수(Vitest로 고정).
 *
 * **왜 있나(2026-07-21 실측 결함):** 이 패널은 반 목록을 `slice(0, 8)`로 잘라 보여줬는데, 반 목록은
 * DB `class_name` 오름차순이고(`getMonthlyAttendanceMatrix`) 영어반 이름은 로마자(DP5·JP1·KW1…),
 * 수학반 이름은 한글(고등M·개별…)로 시작한다. 로마자가 한글보다 먼저 정렬되므로 **앞 43개가 통째로
 * 영어반**이었고 → 앞 8개도 언제나 영어반 → 운영 중인 수학반 65개는 이 패널에 단 한 번도 나타날 수
 * 없었다(수학 담당자에겐 영구히 무용지물).
 *
 * 정렬만 뒤집으면 이번엔 영어가 굶는다. 그래서 **자르는 축을 "전체 목록"에서 "과목별"로 옮긴다** —
 * 과목마다 앞 N개를 보장하면 정렬이 무엇이든 어떤 과목도 0이 되지 않는다. 이 모듈의 불변식은 둘:
 *   ① 어떤 과목도 0개가 되지 않는다(그룹 자체를 드롭하지 않는다 — 상한을 낮출지언정).
 *   ② 입력된 반은 하나도 그룹 밖으로 흘러나가지 않는다(설정에 없는 과목·과목 없는 반 포함).
 * ②를 깨면 "목록에서 조용히 사라지는 반"이라는 같은 버그를 다른 이름으로 재도입하는 것이다.
 */

export type QuickOpenSubject = { value: string; label: string };

/** 그룹핑에 필요한 최소 형태 — 호출부의 반 타입을 그대로 통과시키려 제네릭. */
export type QuickOpenClassLike = { className: string; subject: string | null };

export type QuickOpenGroup<T> = {
  /** React key 겸 과목 필터 값. 미지정 그룹은 `UNASSIGNED_KEY`(필터 값으로 못 씀 → `unassigned` 참고). */
  key: string;
  /** 화면 표시 라벨 — 학원설정의 한글 과목명. raw 키는 절대 여기로 들어오지 않는다. */
  label: string;
  /** 설정에 없는 과목/과목 미지정 반 묶음 — 과목 필터로 드릴다운할 수 없다(링크 숨김용). */
  unassigned: boolean;
  /** 상한 적용 **전** 이 과목의 전체 반 수 — 헤더에 노출해 "숨긴 규모"를 항상 알린다. */
  total: number;
  /** 상한 적용 후 실제로 보여줄 반. */
  classes: T[];
};

export type QuickOpen<T> = {
  groups: QuickOpenGroup<T>[];
  /** 과목당 상한(모든 그룹 공통). */
  limit: number;
  /** 한 과목이라도 잘렸는가 — 안내 문구 노출 조건. */
  truncated: boolean;
};

/** 패널이 한 번에 보여줄 총 행 수 예산. 좌측 PhotoCard와 카드 높이를 맞춘 값. */
export const QUICK_OPEN_BUDGET = 12;

/** 설정에 없는 과목/과목 미지정 반이 모이는 그룹의 키. 과목 필터 값이 아니다. */
export const UNASSIGNED_KEY = "__unassigned";

const UNASSIGNED_LABEL = "(미지정)";

/**
 * 과목당 상한 = 예산 ÷ 과목 수, 단 2~6으로 clamp.
 * 과목이 1개면(과목 필터 적용·단일과목 학원·강사뷰) 섹션 헤더가 없으므로 예산 전부를 쓴다.
 * 과목이 많아져도 하한 2를 보장 — **어떤 과목도 굶지 않는다**가 이 설계의 존재 이유다.
 */
export function quickOpenLimit(groupCount: number, budget: number = QUICK_OPEN_BUDGET): number {
  if (groupCount <= 1) return budget;
  return Math.min(6, Math.max(2, Math.floor(budget / groupCount)));
}

/**
 * 반 목록을 과목별 섹션으로 나누고 과목당 상한을 적용한다.
 *
 * - 섹션 순서 = `subjects` 순서(학원설정 과목 순서). 반이 0개인 과목은 섹션을 만들지 않는다.
 * - **섹션 내 정렬은 하지 않는다 — 호출부가 준 순서를 그대로 보존한다.**
 *   ⚠️ 여기서 이름순으로 재정렬하고 싶은 유혹을 참을 것. 실제로 `localeCompare(_, "ko")`를 넣었다가
 *   되돌렸다: ICU 한국어 콜레이션은 **한글을 로마자보다 앞**에 두는데(Postgres는 정반대), 영어 과목은
 *   한글 이름 27개 + 로마자 코드 16개(DP5·JP1·KW1…)가 섞여 있어 상위 6개가 한글 반에 독점됐다.
 *   = 이 모듈이 고치려던 바로 그 실패(정렬 편향 × 상위 N)를 **과목 안에서 재현**한 것. 게다가 그 16개는
 *   옛 패널이 유일하게 보여주던 반이라 명백한 회귀였다. 카테고리 편향은 **버킷팅으로만** 풀고,
 *   버킷 안에서는 순서를 건드리지 않는다(어떤 이름 정렬이든 섞인 문자 체계 중 한쪽을 굶긴다).
 * - `subjects`에 없는 과목 키·과목 없는 반은 전부 마지막 "(미지정)" 그룹으로 모은다(불변식 ②).
 *   raw 키를 라벨로 쓰지 않는 이유는 화면에 영문 코드를 노출하지 않기 위해서다.
 */
export function buildQuickOpen<T extends QuickOpenClassLike>(
  classes: readonly T[],
  subjects: readonly QuickOpenSubject[],
  budget: number = QUICK_OPEN_BUDGET,
): QuickOpen<T> {
  const known = new Set(subjects.map((s) => s.value));
  const buckets = new Map<string, T[]>();
  const rest: T[] = [];

  for (const c of classes) {
    const key = c.subject ?? "";
    if (!key || !known.has(key)) {
      rest.push(c);
      continue;
    }
    const list = buckets.get(key);
    if (list) list.push(c);
    else buckets.set(key, [c]);
  }

  // 버킷 안에서는 순서를 바꾸지 않는다(위 주석의 이유 — 재정렬은 섞인 문자 체계 중 한쪽을 굶긴다).
  const collected: { key: string; label: string; unassigned: boolean; all: T[] }[] = [];
  for (const s of subjects) {
    const list = buckets.get(s.value);
    if (!list?.length) continue;
    collected.push({ key: s.value, label: s.label, unassigned: false, all: list });
  }
  if (rest.length) {
    collected.push({ key: UNASSIGNED_KEY, label: UNASSIGNED_LABEL, unassigned: true, all: rest });
  }

  const limit = quickOpenLimit(collected.length, budget);
  const groups = collected.map((g) => ({
    key: g.key,
    label: g.label,
    unassigned: g.unassigned,
    total: g.all.length,
    classes: g.all.slice(0, limit),
  }));

  return { groups, limit, truncated: groups.some((g) => g.total > limit) };
}
