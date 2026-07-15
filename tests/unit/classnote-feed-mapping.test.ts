import { describe, expect, it } from "vitest";
// 워커 코어(.mjs). playwright/postgres를 물지만 boardsToStudents는 sql만 받으므로 가짜 sql을 주입해
// **쿼리 우주**를 관측할 수 있다(import는 모듈 로드만 — 브라우저를 띄우지 않는다).
import { boardsToStudents } from "../../scripts/_classnote/classnote-feed-core.mjs";

/**
 * F1 트립와이어 — 이 파일이 존재하는 이유.
 *
 * 2026-07-15 적대리뷰가 프로덕션에서 실증한 개인정보 버그: 동명이인 판정 우주를 `status='enrolled'`로 좁히면
 * **퇴원한 동명 학생의 보드**(그 가족이 아직 붙어 있음)가 **재원 동명 학생**에게 유일 매핑돼, 퇴원 가족의 사적인
 * 글이 엉뚱한 강사에게 간다. 실사례: `(수학)김채은` 보드의 원아 = 퇴원 김채은(중1), 재원 김채은은 고1 딴 사람.
 *
 * ⚠️ 2차 리뷰가 **이 버그를 되돌려도 테스트가 전부 통과함을 실증**했다(우주 계약이 산문 주석으로만 있었음).
 * 게다가 되돌리기가 유혹적이다 — 바로 아래 형제 쿼리는 **의도적으로** `status='enrolled'`라 "통일"이 정리처럼
 * 보인다. 실제로 원 버그가 그 경로로 생겼다. 그래서 **우주를 좁히면 빨개지도록** 여기서 못박는다.
 */

/** 태그드 템플릿 `sql`을 흉내내는 가짜 — 쿼리 텍스트를 캡처하고, 텍스트로 분기해 행을 돌려준다. */
function makeFakeSql(rows: { students: unknown[]; enrolled: unknown[] }) {
  const queries: string[] = [];
  const sql = (strings: TemplateStringsArray | unknown[]) => {
    // sql(keys) 형태(값 보간 헬퍼)는 배열을 받는다 — 쿼리가 아니므로 그대로 흘린다.
    if (!("raw" in (strings as TemplateStringsArray))) return strings;
    const text = (strings as TemplateStringsArray).join("?");
    queries.push(text);
    // 대상 집합 쿼리 = enrollments 조인이 있는 것 / 우주 쿼리 = students 단독
    return Promise.resolve(text.includes("enrollments") ? rows.enrolled : rows.students);
  };
  return { sql, queries };
}

const 재원김채은 = { id: "enrolled-kim", name: "김채은", classnote_name: null };
const 퇴원김채은 = { name: "김채은", classnote_name: null }; // 우주에만 존재(퇴원)
const 이시우 = { id: "sw", name: "이시우", classnote_name: null };

describe("boardsToStudents — F1 트립와이어 (동명이인 우주는 전 학생이어야 한다)", () => {
  it("⭐ 퇴원 동명이인이 있으면 그 보드는 **보류** — 재원 동명에게 매핑하면 안 된다", async () => {
    const fake = makeFakeSql({
      students: [재원김채은, 퇴원김채은, 이시우], // 우주 = 퇴원 포함 전 학생
      enrolled: [재원김채은, 이시우], // 대상 집합 = 재원 + 활성 수강
    });
    const { board, collisions } = await boardsToStudents(fake.sql, "t1", ["math"], "(수학)");

    expect(board.has("(수학)김채은")).toBe(false); // 오배달 차단
    expect(collisions.join()).toContain("김채은");
    expect(board.get("(수학)이시우")).toMatchObject({ id: "sw" }); // 정상 학생은 회귀 없음
  });

  it("⭐ 우주 쿼리는 status·과목으로 좁히면 안 된다 — 좁히는 순간 위 사고가 부활한다", async () => {
    const fake = makeFakeSql({ students: [이시우], enrolled: [이시우] });
    await boardsToStudents(fake.sql, "t1", ["math"], "(수학)");

    // 쿼리 2개: 대상 집합(enrollments 조인 O) + 동명 우주(조인 X).
    const universe = fake.queries.find((q) => !q.includes("enrollments"));
    expect(universe, "동명 우주 쿼리를 찾지 못했다 — 구조가 바뀌었으면 이 테스트를 먼저 고쳐라").toBeTruthy();
    expect(universe).toContain("from students");
    // 여기가 트립와이어의 핵심: 우주에 status/subject 필터가 붙으면 실패한다.
    expect(universe, "동명 우주를 좁혔다 = (수학)김채은 오배달 부활").not.toMatch(/status/);
    expect(universe, "동명 우주를 과목으로 좁혔다 = 타과목 동명이인이 안 보임").not.toMatch(/subject/);
  });

  it("동명이 없으면 정상 매핑(과교정 아님)", async () => {
    const fake = makeFakeSql({ students: [이시우, 재원김채은], enrolled: [이시우, 재원김채은] });
    const { board, collisions } = await boardsToStudents(fake.sql, "t1", ["math"], "(수학)");
    expect(board.size).toBe(2);
    expect(collisions).toHaveLength(0);
  });
});
