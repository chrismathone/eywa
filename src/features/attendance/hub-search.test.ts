import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { schoolGradeLabel } from "@/lib/format/school-grade";
import {
  HUB_SEARCH_LIMIT,
  buildHubHits,
  hubSearchTerm,
  hubEmptyMessage,
  hubLinkTeacherId,
  hubSearchPattern,
  hubTruncatedNote,
  sortHubHits,
  type HubSearchClass,
  type HubSearchEnrollment,
} from "./hub-search";

const MINE: HubSearchClass = { id: "c1", className: "고등M 고1 BS4A", teacherId: "t1", teacherName: "김윤하" };
const ALSO_MINE: HubSearchClass = { id: "c2", className: "DP-1", teacherId: "t1", teacherName: "김윤하" };
const SEAT: HubSearchClass = { id: "c9", className: "LAB 자리", teacherId: null, teacherName: null };

function en(over: Partial<HubSearchEnrollment> = {}): HubSearchEnrollment {
  return {
    classId: "c1",
    studentId: "s1",
    studentName: "윤현소",
    school: "경명여중",
    grade: "중1",
    ...over,
  };
}

const build = (input: Omit<Parameters<typeof buildHubHits>[0], "schoolGradeOf">) =>
  buildHubHits({ ...input, schoolGradeOf: schoolGradeLabel });

describe("hubSearchPattern — DB에 넘길 ilike", () => {
  it("공백·대소문자는 시트 검색과 같은 규칙으로 지운다", () => {
    expect(hubSearchPattern(" 윤 현소 ")).toBe("%윤현소%");
    expect(hubSearchPattern("Florence")).toBe("%florence%");
  });

  it("정리된 검색어는 패턴과 화면 재판정이 **같은 문자열**을 쓴다", () => {
    expect(hubSearchTerm(" 윤 현소 ")).toBe("윤현소");
    expect(hubSearchTerm("윤%현")).toBe("윤현");
    expect(hubSearchTerm("  ")).toBe("");
  });

  it("빈 검색어·공백만은 null — 조회 자체를 하지 않는다", () => {
    expect(hubSearchPattern("")).toBeNull();
    expect(hubSearchPattern("   ")).toBeNull();
  });

  it("🔴 와일드카드(%·_·*)는 지운다 — 친 글자가 조용히 '아무거나'가 되면 안 된다", () => {
    expect(hubSearchPattern("%윤%")).toBe("%윤%"); // 감싸는 %만 남고 안쪽 %는 사라진다
    expect(hubSearchPattern("_윤_")).toBe("%윤%");
    expect(hubSearchPattern("*")).toBeNull();
  });
});

describe("buildHubHits — 스코프·정렬·상한", () => {
  it("🔴 스코프 밖 반의 수강은 결과에 못 든다(권한 회귀 가드)", () => {
    const { hits } = build({
      query: "윤현소",
      // 조회가 남의 반 행을 흘려도(c3) 반 목록에 없으면 여기서 잘린다.
      enrollments: [en(), en({ classId: "c3", studentId: "s9", studentName: "윤현소" })],
      classes: [MINE],
    });
    expect(hits.map((h) => h.classId)).toEqual(["c1"]);
  });

  it("한 학생이 여러 반이면 반마다 한 줄(원장 스크린샷의 윤현소)", () => {
    const { hits } = build({
      query: "윤현소",
      enrollments: [en(), en({ classId: "c2" })],
      classes: [MINE, ALSO_MINE],
    });
    expect(hits).toHaveLength(2);
    // ⚠️ 반 이름 순은 `localeCompare("ko")` — 한글이 로마자보다 앞이다(Postgres 정렬과 반대, [[#84]]).
    expect(hits.map((h) => h.className)).toEqual(["고등M 고1 BS4A", "DP-1"]);
  });

  it("같은 반 재등록(수강 행 2개)은 한 줄로 합친다", () => {
    const { hits } = build({ query: "윤", enrollments: [en(), en()], classes: [MINE] });
    expect(hits).toHaveLength(1);
  });

  it("학교/학년은 압축 표기로 싣는다(공백 join 금지 규약)", () => {
    const { hits } = build({ query: "윤", enrollments: [en()], classes: [MINE] });
    expect(hits[0]!.schoolGrade).toBe("경명여중1");
  });

  it("이름이 안 맞으면 버린다 — 최종 판정은 시트와 같은 함수", () => {
    const { hits } = build({ query: "박서준", enrollments: [en()], classes: [MINE] });
    expect(hits).toEqual([]);
  });

  it("🔴 상한을 넘으면 잘라내고 truncated로 밝힌다", () => {
    const many = Array.from({ length: HUB_SEARCH_LIMIT + 3 }, (_, i) =>
      en({ studentId: `s${i}`, studentName: `윤현소${String(i).padStart(2, "0")}` }),
    );
    const { hits, truncated } = build({ query: "윤현소", enrollments: many, classes: [MINE] });
    expect(hits).toHaveLength(HUB_SEARCH_LIMIT);
    expect(truncated).toBe(true);
  });

  it("🔴 거르고 나서 상한 아래여도, 조회가 상한을 채웠으면(more) 잘렸다고 말한다", () => {
    const { hits, truncated } = build({
      query: "윤현소",
      enrollments: [en()],
      classes: [MINE],
      more: true,
    });
    expect(hits).toHaveLength(1);
    expect(truncated).toBe(true);
  });

  it("상한에 안 걸리면 truncated는 false", () => {
    const { truncated } = build({ query: "윤", enrollments: [en()], classes: [MINE] });
    expect(truncated).toBe(false);
  });

  it("🔴 빈 검색어는 **아무것도 안 내놓는다** — 시트 검색('비면 전부 통과')과 뜻이 반대다", () => {
    expect(build({ query: "", enrollments: [en()], classes: [MINE] }).hits).toEqual([]);
    expect(build({ query: "   ", enrollments: [en()], classes: [MINE] }).hits).toEqual([]);
  });

  it("🔴 와일드카드를 쳐도 DB가 찾은 행이 살아남는다 — 두 층이 **같은 정리된 검색어**를 본다", () => {
    // DB는 `%윤현%`로 찾았는데 JS가 원문 '윤%현'으로 다시 재면 전부 버려 '없습니다'가 된다.
    const { hits } = build({ query: "윤%현", enrollments: [en()], classes: [MINE] });
    expect(hits.map((h) => h.studentName)).toEqual(["윤현소"]);
  });
});

describe("hubLinkTeacherId — 결과 줄이 열 출석부", () => {
  it("🔴 강사가 보고 있으면 언제나 자기 출석부(남의 시트는 볼 수 없다)", () => {
    expect(hubLinkTeacherId(MINE, "t7")).toBe("t7");
  });

  it("사무실이면 그 반 담임", () => {
    expect(hubLinkTeacherId(MINE, null)).toBe("t1");
  });

  it("담임이 없는 반(자리)은 null — 호출부가 반별 링크로 떨어뜨린다", () => {
    expect(hubLinkTeacherId(SEAT, null)).toBeNull();
  });
});

describe("정렬·문구", () => {
  it("이름(가나다) → 반 이름 순", () => {
    const rows = [
      { studentName: "홍길동", className: "B" },
      { studentName: "강감찬", className: "Z" },
      { studentName: "홍길동", className: "A" },
    ];
    expect(sortHubHits(rows).map((r) => `${r.studentName}/${r.className}`)).toEqual([
      "강감찬/Z",
      "홍길동/A",
      "홍길동/B",
    ]);
  });

  it("0건 문구는 **왜 비었는지**를 말하고 권한 이야기는 하지 않는다", () => {
    const msg = hubEmptyMessage(" 윤현소 ", "8월 담당 반");
    expect(msg).toContain("윤현소");
    expect(msg).toContain("8월 담당 반");
    expect(msg).not.toContain("권한");
  });

  it("상한 문구는 몇 건인지와 좁히는 법을 함께 말한다", () => {
    expect(hubTruncatedNote(20)).toContain("20건");
    expect(hubTruncatedNote(20)).toContain("이름을 더");
  });
});

/**
 * 🔴 권한 회귀 가드 — 조회 본체가 **스코프 단일 소스**를 통과하는지 파일로 잠근다.
 * 여기서 `loadClassAxisRows`(스코프 없는 전건)로 갈아타면 강사가 남의 반 학생을 찾게 된다([[#77]]).
 */
describe("hub-search-queries는 스코프 단일 소스를 쓴다", () => {
  const src = readFileSync(
    join(process.cwd(), "src/features/attendance/server/hub-search-queries.ts"),
    "utf8",
  );

  it("반 목록은 loadVisibleClassAxisRows에서 온다", () => {
    expect(src).toContain("loadVisibleClassAxisRows(range.from, range.to)");
  });

  it("스코프 없는 전건 목록(loadClassAxisRows)을 직접 부르지 않는다", () => {
    expect(src).not.toMatch(/\bawait loadClassAxisRows\(/);
  });

  it("메뉴 게이트(canAccessTenant)를 통과한다", () => {
    expect(src).toContain('canAccessTenant(user.systemRole, "attendance")');
  });
});
