/**
 * 성적관리 **정렬 보기 설정** — 열 머리를 눌러 바꾸고 계정(`users.ui_prefs.grades`)에 남는다
 * (원장 2026-08-04 *"뷰 세팅은 계정 귀속"*, 09-22 *"학년 누르면 학년오름내림 학교 이름 점수별 정렬"*).
 *
 * 🔴 정렬은 **화면 안에서** 한다(주소를 바꾸지 않는다) — 주소가 바뀌면 격자가 다시 마운트되어
 *    **적다 만 점수가 날아간다**. 그래서 서버는 초깃값만 주고, 바뀌면 저장 액션만 조용히 부른다.
 * ⚠️ 반 묶음은 그대로다(정렬은 **묶음 안에서**) — 반을 섞으면 어느 반을 적고 있는지 알 수 없다.
 */
export type GradeSortKey = "name" | "school" | "grade" | "score";
export type GradeSortDir = "asc" | "desc";
export type GradeSort = { key: GradeSortKey | null; dir: GradeSortDir };

export const GRADE_SORT_DEFAULT: GradeSort = { key: null, dir: "asc" };

const KEYS: readonly GradeSortKey[] = ["name", "school", "grade", "score"];

export function isGradeSortKey(v: unknown): v is GradeSortKey {
  return typeof v === "string" && (KEYS as readonly string[]).includes(v);
}

/** 저장값·클라 입력을 안전한 모양으로. 모르는 값은 기본값(정렬 없음 = 서버 순서 그대로). */
export function parseGradeSort(raw: unknown): GradeSort {
  if (!raw || typeof raw !== "object") return GRADE_SORT_DEFAULT;
  const o = raw as { key?: unknown; dir?: unknown };
  return {
    key: isGradeSortKey(o.key) ? o.key : null,
    dir: o.dir === "desc" ? "desc" : "asc",
  };
}

/** 같은 열을 다시 누르면 오름↔내림, 다른 열이면 그 열 오름차순. */
export function nextGradeSort(cur: GradeSort, key: GradeSortKey): GradeSort {
  if (cur.key !== key) return { key, dir: "asc" };
  return cur.dir === "asc" ? { key, dir: "desc" } : GRADE_SORT_DEFAULT;
}
