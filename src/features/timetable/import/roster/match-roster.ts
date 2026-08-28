// **명단 이름 → 학생 id** — 통합 탭 전용 매칭(순수 함수).
//
// 🔴 왜 `matchStudent`를 그대로 못 쓰는가(2026-08-29 적대 리뷰 grok): 그 함수는 **이름 완전일치**로
//    후보를 먼저 거르고, 0건이면 즉시 `none`을 돌려준다([match.ts](../match.ts)). 그래서 학교·학년
//    좁히기에 **도달조차 못 한다.** 시트는 원장이 손으로 쓰는 문서라 접미사를 안 붙인다:
//      시트 `이도윤`(칠성초3) ↔ DB `이도윤`(퇴원)·`이도윤A`(퇴원)·`이도윤B`(재원, 칠성초3)
//      시트 `김준서`(칠성초6) ↔ DB `김준서`(퇴원)·`김준서A`(재원, 칠성초6)
//      시트 `박서준 C`(성광중3) ↔ DB `박서준C`(공백 표기차)
//    실측 237명 중 232명은 완전일치로 끝나고, **5명이 정확히 이 경우**다.
//
// 규칙(순서대로):
//   ① 이름 완전일치 후보 → 여럿이면 학교(+학년)로 좁힌다
//   ② 0건이면 **접미사 형제까지 넓힌다**(`baseNameOf` — `이도윤` ⊃ `이도윤A/B/C`) → 학교(+학년)로 좁힌다
//   ③ 그래도 유일하지 않으면 **제외**하고 이유를 돌려준다(억지로 고르지 않는다 — 남의 아이를 옮긴다)
//
// ⚠️ 학년이 null일 수 있다(실업계 `경북여상2` 등, parse-roster 주석) → 그때는 학교로만 좁힌다.
// ⚠️ 퇴원 학생 판정은 여기서 하지 않는다 — 호출부가 `status`를 보고 **적용 대상에서 빼고 보고**한다
//    (원장 지시: 학생 상태를 자동으로 바꾸는 경로는 만들지 않는다).

import { baseNameOf } from "@/features/students/name-suffix";
import { norm } from "../match";

export interface RosterStudentRef {
  studentId: string;
  name: string;
  school: string | null;
  grade: string | null;
  status: string | null;
}

/**
 * 무엇을 근거로 골랐는지 — 보고서가 사람에게 보여 줄 값.
 * `unique`(그 이름이 DB에 하나뿐)가 가장 강하고, 아래로 갈수록 약하다. 약한 근거로 고른 건은
 * 드라이런에서 **눈으로 확인**해야 한다(조용히 넘어가면 남의 아이를 옮겨도 모른다).
 */
export type MatchBasis = "unique" | "school+grade" | "school" | "grade" | "enrolled" | "literal";

export type RosterMatch =
  | { status: "ok"; studentId: string; viaSuffix: boolean; basis: MatchBasis }
  | { status: "none" }
  | { status: "ambiguous"; candidates: RosterStudentRef[] };

/** 한 축으로 좁힌다. 시트 값이 비어 있으면 그 축은 못 쓴다(빈 조건은 아무것도 안 거른다). */
function by(
  pool: readonly RosterStudentRef[],
  pick: (s: RosterStudentRef) => string | null,
  want: string | null,
): RosterStudentRef[] | null {
  const w = norm(want);
  if (!w) return null;
  return pool.filter((s) => norm(pick(s)) === w);
}

/**
 * 명단 한 줄 → 학생. 접미사 형제까지 본 뒤 학교(+학년)로 유일 확정한다.
 *
 * `viaSuffix`는 "시트 이름과 DB 이름이 정확히 같지는 않았다"는 표시다 — 호출부가 보고서에 적어
 * 사람이 눈으로 확인할 수 있게 한다(조용히 넘어가면 남의 아이를 옮겨도 모른다).
 */
export function matchRosterStudent(
  name: string,
  school: string | null,
  grade: string | null,
  students: readonly RosterStudentRef[],
): RosterMatch {
  const key = norm(name);
  if (!key) return { status: "none" };
  const base = norm(baseNameOf(name));

  // ① 후보 풀 = 완전일치 **∪ 접미사 형제**.
  // 🔴 완전일치가 1건이어도 곧바로 채택하지 않는다 — 실측 `이도윤`이 그 함정이다: DB에 `이도윤`(침산중2,
  //    퇴원)과 `이도윤B`(칠성초3, 재원)가 있고 시트가 가리키는 건 **후자**다. 완전일치만 믿으면 퇴원한
  //    남을 옮긴다. 형제를 먼저 모아 놓고 증거로 가른다.
  const pool = students.filter(
    (s) => norm(s.name) === key || (!!base && norm(baseNameOf(s.name)) === base),
  );
  if (pool.length === 0) return { status: "none" };

  const decide = (s: RosterStudentRef, basis: MatchBasis): RosterMatch => ({
    status: "ok",
    studentId: s.studentId,
    viaSuffix: norm(s.name) !== key,
    basis,
  });

  // 그 이름을 쓰는 사람이 애초에 하나뿐이면 가릴 것이 없다(237명 중 대부분이 여기서 끝난다).
  if (pool.length === 1) return decide(pool[0]!, "unique");

  // ② 증거를 **강한 순서로** 시도한다. 🔴 학교·학년을 하드 필터로 쓰면 안 된다 — 시트의 학교·학년은
  //    DB와 자주 어긋난다(실측: `일중` vs `대구일중`이 DB에 **둘 다** 있고, 진급 반영 시차·전학으로
  //    학년·학교가 다른 건이 237명 중 21명). 하드 필터로 거르면 그 21명이 '명단에 없는 사람'이 되고,
  //    computeImportDiff가 그들의 수강을 **종료 후보**로 넘긴다 — 조용한 퇴출이다.
  //    그래서 한 축이 어긋나도 다른 축으로 유일하게 갈리면 그걸 근거로 삼는다.
  const attempts: [MatchBasis, RosterStudentRef[] | null][] = [
    ["school+grade", (() => {
      const a = by(pool, (s) => s.school, school);
      const b = by(pool, (s) => s.grade, grade);
      return a && b ? a.filter((s) => b.includes(s)) : null;
    })()],
    ["school", by(pool, (s) => s.school, school)],
    ["grade", by(pool, (s) => s.grade, grade)],
    // 9월 명단은 **앞으로 다닐 사람**의 목록이라, 형제 중 재원이 하나뿐이면 그 사람이다.
    ["enrolled", pool.filter((s) => s.status === "enrolled")],
    // 마지막 — 시트가 적은 문자 그대로. 제외해 버리면 조용한 퇴출이 되므로 최선의 근거로 남긴다.
    ["literal", pool.filter((s) => norm(s.name) === key)],
  ];
  for (const [basis, hit] of attempts) {
    if (hit && hit.length === 1) return decide(hit[0]!, basis);
  }

  // 어떤 축으로도 안 갈리면 고르지 않는다(호출부가 보고하고 사람이 정한다).
  return { status: "ambiguous", candidates: pool };
}
