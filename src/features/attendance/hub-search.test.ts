import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { schoolGradeLabel } from "@/lib/format/school-grade";
import {
  HUB_SEARCH_LIMIT,
  attendDowCount,
  buildHubHits,
  groupHitsBySubject,
  hubEnrollmentAsOf,
  hubSearchTerm,
  hubEmptyMessage,
  hubLinkTeacherId,
  hubSearchPattern,
  hubSubjectHeading,
  hubTruncatedNote,
  sortHubHits,
  type HubSearchClass,
  type HubSearchEnrollment,
} from "./hub-search";

const MINE: HubSearchClass = {
  id: "c1",
  className: "고등M 고1 BS4A",
  subject: "math",
  teacherId: "t1",
  teacherName: "김윤하",
};
const ALSO_MINE: HubSearchClass = {
  id: "c2",
  className: "DP-1",
  subject: "english",
  teacherId: "t1",
  teacherName: "김윤하",
};
const SEAT: HubSearchClass = {
  id: "c9",
  className: "LAB 자리",
  subject: "math",
  teacherId: null,
  teacherName: null,
};

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

/**
 * 🔴 원장 2026-08-24: *"지나간 수업은 검색할 필요 없음. 현재 수강중인 수업만 검색되어야함"*.
 * '겹치는 달'이 아니라 **기준일 하루**로 재야 8/4에 끝난 반이 8월 검색에서 빠진다.
 */
describe("hubEnrollmentAsOf — '지금 수강 중'을 잴 하루", () => {
  it("이번 달을 보고 있으면 오늘", () => {
    expect(hubEnrollmentAsOf("2026-08-24", "2026-08-01", "2026-08-31")).toBe("2026-08-24");
  });

  it("🔴 지난 달을 열면 그 달 말일 — 그때 다니던 반이 통째로 사라지지 않게", () => {
    expect(hubEnrollmentAsOf("2026-08-24", "2026-07-01", "2026-07-31")).toBe("2026-07-31");
  });

  it("다음 달을 열면 그 달 1일", () => {
    expect(hubEnrollmentAsOf("2026-08-24", "2026-09-01", "2026-09-30")).toBe("2026-09-01");
  });

  it("경계일(1일·말일)은 그대로 오늘", () => {
    expect(hubEnrollmentAsOf("2026-08-01", "2026-08-01", "2026-08-31")).toBe("2026-08-01");
    expect(hubEnrollmentAsOf("2026-08-31", "2026-08-01", "2026-08-31")).toBe("2026-08-31");
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
  it("요일 수가 같으면 이름(가나다) → 반 이름 순", () => {
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

  it("🔴 요일이 **많은 수업**이 먼저(원장 2026-08-24) — 요일 없는 줄은 맨 뒤", () => {
    const rows = [
      { studentName: "가", className: "1일", attendLabel: "수" },
      { studentName: "가", className: "슬롯없음", attendLabel: "" },
      { studentName: "가", className: "3일", attendLabel: "월·화·수" },
      { studentName: "가", className: "2일", attendLabel: "화·금" },
    ];
    expect(sortHubHits(rows).map((r) => r.className)).toEqual(["3일", "2일", "1일", "슬롯없음"]);
  });

  it("요일 수 세기 — 빈 라벨·공백은 0", () => {
    expect(attendDowCount("월·화·수·목·금")).toBe(5);
    expect(attendDowCount("월·목")).toBe(2);
    expect(attendDowCount("수")).toBe(1);
    expect(attendDowCount("")).toBe(0);
    expect(attendDowCount(undefined)).toBe(0);
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

  /**
   * 🔴 등원요일 회귀 가드 — 요일을 **어디서 어떻게** 읽는지 파일로 잠근다.
   * 조용히 틀리는 두 가지(만료 슬롯 혼입 · 자리 슬롯 누락)는 화면만 봐서는 안 드러난다.
   */
  it("반 요일은 `class_schedules`를 **유효구간으로 좁혀** 읽는다([[#88]])", () => {
    expect(src).toContain('.from("class_schedules")');
    expect(src).toContain('.lte("valid_from", range.to)');
    expect(src).toContain("valid_to.is.null,valid_to.gte.${range.from}");
  });

  // ⚠️ 주석에는 남아 있다(왜 안 쓰는지가 사라지면 다음 사람이 다시 갈아끼운다) — **호출**만 잠근다.
  it("🔴 `loadSlotAxisByClass`를 부르지 않는다 — 자리(LAB·JJ) 슬롯이 통째로 빠진다", () => {
    expect(src).not.toMatch(/loadSlotAxisByClass\s*\(/);
    expect(src).not.toMatch(/import[^;]*loadSlotAxisByClass/);
  });

  it("요일 판정은 시트와 **같은 단일 소스**(dowsFromKeys)", () => {
    expect(src).toContain("dowsFromKeys(keys)");
  });

  /** 🔴 원장 2026-08-24 — '겹치는 달'로 되돌리면 지난 수업이 다시 섞인다. */
  it("수강은 **기준일 하루**로 좁힌다 — 달 경계(range.from/to)로 재지 않는다", () => {
    expect(src).toContain("hubEnrollmentAsOf(kstToday(), range.from, range.to)");
    expect(src).toContain('.lte("start_date", asOf)');
    expect(src).toContain("end_date.is.null,end_date.gte.${asOf}");
    expect(src).not.toContain('.lte("start_date", range.to)');
  });
});

/**
 * 등원요일 라벨 — **그 학생이 그 반에 오는 요일**(반 운영 요일이 아니다).
 * 원장 지시 2026-08-24: *"월별 출석부에서 학생 검색시, 학생이 등원하는 요일도 같이 정보로 나오게"*.
 */
describe("buildHubHits — 등원요일 라벨", () => {
  const dows = (m: Record<string, number[]>) => new Map(Object.entries(m));

  it("분리등원이 없으면(빈 배열) 반 운영 요일 전부", () => {
    const { hits } = build({
      query: "윤",
      enrollments: [en({ attendanceDays: [] })],
      classes: [MINE],
      classDows: dows({ c1: [1, 4] }),
    });
    expect(hits[0]!.attendLabel).toBe("월·목");
  });

  it("🔴 분리등원이 있으면 **그 학생 요일**만(반 요일로 퉁치면 실제로 틀린다 — 704건 중 83건)", () => {
    const { hits } = build({
      query: "윤",
      enrollments: [en({ attendanceDays: ["tue", "fri"] })],
      classes: [MINE],
      classDows: dows({ c1: [2, 5] }),
    });
    expect(hits[0]!.attendLabel).toBe("화·금");
  });

  it("반이 운영하지 않는 요일이 분리등원에 남아 있으면 반 요일로 좁힌다(스케줄이 진실)", () => {
    const { hits } = build({
      query: "윤",
      enrollments: [en({ attendanceDays: ["mon", "sat"] })],
      classes: [MINE],
      classDows: dows({ c1: [1, 4] }),
    });
    expect(hits[0]!.attendLabel).toBe("월");
  });

  it("🔴 그 달 유효 슬롯이 0인 반은 **빈 문자열** — 화면이 아무것도 안 그린다(자리표시 금지)", () => {
    const { hits } = build({
      query: "윤",
      enrollments: [en({ attendanceDays: [] })],
      classes: [MINE],
      classDows: dows({}),
    });
    expect(hits[0]!.attendLabel).toBe("");
  });

  it("알 수 없는 요일 키는 버리고 반 요일로 떨어진다(raw 코드 노출 금지)", () => {
    const { hits } = build({
      query: "윤",
      enrollments: [en({ attendanceDays: ["funday", null] })],
      classes: [MINE],
      classDows: dows({ c1: [3] }),
    });
    expect(hits[0]!.attendLabel).toBe("수");
  });

  it("🔴 맵을 안 넘겨도 동작한다 — 라벨만 빈다(기존 호출부 회귀 가드)", () => {
    const { hits } = build({ query: "윤", enrollments: [en()], classes: [MINE] });
    expect(hits[0]!.attendLabel).toBe("");
    expect(hits[0]!.className).toBe("고등M 고1 BS4A");
  });

  it("🔴 그룹(과목) 안에서 요일 많은 반이 먼저 — 원장 스크린샷의 최하림 순서", () => {
    const { hits } = build({
      query: "최하림",
      enrollments: [
        en({ classId: "c1", studentName: "최하림", attendanceDays: [] }), // 수(1일)
        en({ classId: "c2", studentName: "최하림", attendanceDays: ["tue", "fri"] }), // 화·금(2일)
      ],
      classes: [MINE, { ...ALSO_MINE, subject: "math" }],
      classDows: dows({ c1: [3], c2: [2, 5] }),
    });
    expect(hits.map((h) => h.attendLabel)).toEqual(["화·금", "수"]);
  });

  it("같은 학생·다른 반이면 줄마다 **다른** 요일이 붙는다(원장 스크린샷의 최하림)", () => {
    const { hits } = build({
      query: "윤현소",
      enrollments: [
        en({ classId: "c1", attendanceDays: [] }),
        en({ classId: "c2", attendanceDays: ["tue", "fri"] }),
      ],
      classes: [MINE, ALSO_MINE],
      classDows: dows({ c1: [1, 4], c2: [2, 5] }),
    });
    expect(hits.map((h) => `${h.className}/${h.attendLabel}`)).toEqual([
      "고등M 고1 BS4A/월·목",
      "DP-1/화·금",
    ]);
  });
});

/**
 * 과목 그룹 — 머리글 + 구분선의 재료(원장 2026-08-24 *"과목 라벨을 붙이라는 소리임"*).
 * 🔴 순서는 **학원설정**(인자로 받은 order)이 정한다 — 이 모듈이 과목 순서를 알면 그게 하드코딩이다.
 */
describe("groupHitsBySubject — 과목 묶기", () => {
  const hit = (subject: string, className: string) => ({ subject, className });

  it("그룹 순서는 학원설정 과목 순서를 따른다", () => {
    const groups = groupHitsBySubject(
      [hit("english", "DP-1"), hit("math", "BS3Q"), hit("english", "PL-2")],
      ["math", "english", "science"],
    );
    expect(groups.map((g) => g.subject)).toEqual(["math", "english"]);
    expect(groups[1]!.hits.map((h) => h.className)).toEqual(["DP-1", "PL-2"]);
  });

  it("🔴 설정에 없는 과목 키는 **맨 뒤**로 — 사라지지 않는다(그 반 학생이 증발하면 검색이 거짓말)", () => {
    const groups = groupHitsBySubject(
      [hit("subject_9", "폐기반"), hit("english", "DP-1"), hit("math", "BS3Q")],
      ["math", "english"],
    );
    expect(groups.map((g) => g.subject)).toEqual(["math", "english", "subject_9"]);
  });

  it("미등록 과목끼리는 처음 나온 순서를 지킨다(순서가 매번 흔들리지 않게)", () => {
    const groups = groupHitsBySubject([hit("zz", "A"), hit("aa", "B"), hit("zz", "C")], []);
    expect(groups.map((g) => g.subject)).toEqual(["zz", "aa"]);
    expect(groups[0]!.hits.map((h) => h.className)).toEqual(["A", "C"]);
  });

  it("그룹 안 순서는 손대지 않는다 — 이미 sortHubHits가 정했다", () => {
    const groups = groupHitsBySubject(
      [hit("math", "3일"), hit("math", "2일"), hit("math", "1일")],
      ["math"],
    );
    expect(groups[0]!.hits.map((h) => h.className)).toEqual(["3일", "2일", "1일"]);
  });

  it("0건이면 그룹도 0개(머리글만 남은 빈 패널이 안 생긴다)", () => {
    expect(groupHitsBySubject([], ["math"])).toEqual([]);
  });
});

describe("hubSubjectHeading — 머리글 라벨", () => {
  const labelOf = (key: string) => ({ math: "수학", english: "영어" })[key] ?? key;

  it("라벨은 학원설정에서 온다", () => {
    expect(hubSubjectHeading("math", labelOf)).toBe("수학");
    expect(hubSubjectHeading("english", labelOf)).toBe("영어");
  });

  it("🔴 라벨을 못 찾아 키가 그대로 돌아오면 `기타` — raw 키를 화면에 내보내지 않는다", () => {
    expect(hubSubjectHeading("subject_3", labelOf)).toBe("기타");
    expect(hubSubjectHeading("", labelOf)).toBe("기타");
    expect(hubSubjectHeading("math", () => "")).toBe("기타");
  });
});
