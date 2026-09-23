/**
 * 학년 문자열(`초6`·`중1`·`고2`)의 **정렬 순서** — 초 < 중 < 고, 같은 급이면 숫자. 모르는 값은 null.
 *
 * 🔴 성적 화면 **둘이 같은 사다리를 쓴다**(입력 격자·확인 뷰). 한쪽이 문자열 `localeCompare("ko")`를
 *    쓰면 `고1 → 중1 → 초3` 순이 되어, 나란히 대조하라고 만든 두 화면의 명단이 **정반대**로 선다
 *    (적대적 리뷰 2026-09-23에서 실제로 잡혔다).
 * 🔑 `null`은 "학년 축이 아닌 값"(`7세`·빈 값)이고 호출부가 **맨 뒤로** 보낸다 — 0으로 접으면
 *    초1보다 앞에 선다.
 * ⚠️ 클라(격자)와 서버(확인 뷰)가 함께 읽는다 — `import "server-only"`를 붙이지 말 것([[#61]]).
 */

const GRADE_LEVEL: Record<string, number> = { 초: 0, 중: 1, 고: 2 };

export function gradeSortRank(grade: string | null | undefined): number | null {
  const s = String(grade ?? "").replace(/\s+/g, "");
  if (!s) return null;
  const level = GRADE_LEVEL[s[0] ?? ""];
  if (level === undefined) return null;
  const num = Number((s.match(/\d+/) ?? ["0"])[0]);
  return level * 100 + (Number.isFinite(num) ? num : 0);
}

/** 학년 오름차순 비교(모르는 값은 뒤로). 동점이면 호출부가 이름으로 잇는다. */
export function compareByGrade(a: string | null | undefined, b: string | null | undefined): number {
  const ra = gradeSortRank(a);
  const rb = gradeSortRank(b);
  if (ra == null && rb == null) return 0;
  if (ra == null) return 1;
  if (rb == null) return -1;
  return ra - rb;
}
