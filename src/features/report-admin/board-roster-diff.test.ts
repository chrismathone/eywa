import { describe, expect, it } from "vitest";
import {
  birthYearMatches,
  checkClassRosters,
  childKeys,
  expectedBirthYear,
  looksLikeSameName,
  matchMembers,
  summarize,
} from "./board-roster-diff";
import { classKey, boardKey } from "./english-writing";

const KEYS = { class: classKey, board: boardKey };
const YEAR = 2026; // 학년도 고정 — 실행 시점에 따라 결과가 바뀌면 테스트가 아니다
const m = (id: number, name: string, birthYear: number | null = 2014) => ({ childId: id, childName: name, birthYear });
const stu = (id: string, name: string, grade: string | null = "중1") => ({ studentId: id, name, grade });

describe("childKeys — 워커 규칙 고정", () => {
  it("원문·알파벳 제거본·영문닉(한글)의 한글을 키로 낸다", () => {
    expect([...childKeys("Jay(이재희)")].sort()).toEqual(["Jay(이재희)", "이재희"]);
  });
  it("한글(별명) 표기의 별명은 키로 승격하지 않는다 — 오매칭 연료", () => {
    expect(childKeys("박지민(지민)").has("지민")).toBe(false);
  });
  it("빈 이름은 키 없음", () => {
    expect(childKeys("  ").size).toBe(0);
  });
});

describe("matchMembers — 발송 후보 선정 재현", () => {
  it("영문닉 계정과 한글 계정이 둘 다 걸린다(실측 이재희)", () => {
    const hit = matchMembers("이재희", [m(1, "Jay(이재희)"), m(2, "이재희"), m(3, "김하윤")]);
    expect(hit.map((h) => h.childId)).toEqual([1, 2]);
  });
  it("보드에 없으면 빈 배열", () => {
    expect(matchMembers("엄채율", [m(1, "박세욱")])).toEqual([]);
  });
});

describe("생년 대조 — 🔴 오발송 방지의 마지막 관문", () => {
  it("학년에서 출생연도를 역산한다(2026학년도 초5 = 2015년생)", () => {
    expect(expectedBirthYear("초5", YEAR)).toBe(2015);
    expect(expectedBirthYear("중1", YEAR)).toBe(2013);
  });
  it("±1년까지 허용(조기입학·유급·학부모 오입력)", () => {
    expect(birthYearMatches("초5", 2015, YEAR)).toBe(true);
    expect(birthYearMatches("초5", 2014, YEAR)).toBe(true);
    expect(birthYearMatches("초5", 2016, YEAR)).toBe(true);
    expect(birthYearMatches("초5", 2013, YEAR)).toBe(false);
  });
  it("**모르면 거부** — 생년이 없거나 학년을 모르면 연결 불가", () => {
    expect(birthYearMatches("초5", null, YEAR)).toBe(false);
    expect(birthYearMatches(null, 2015, YEAR)).toBe(false);
    expect(birthYearMatches("유치부", 2015, YEAR)).toBe(false);
  });
});

describe("looksLikeSameName — 표기 차이 힌트", () => {
  it("포함 관계(박서연E ↔ 서연)", () => {
    expect(looksLikeSameName("박서연E", "서연")).toBe(true);
  });
  it("한 글자 차이 + 초성 동일(강지윈 ↔ 강지원)", () => {
    expect(looksLikeSameName("강지윈", "강지원")).toBe(true);
  });
  it("남남은 후보가 아니다", () => {
    expect(looksLikeSameName("최영서", "손라임")).toBe(false);
    // ⚠️ 한 글자 차이지만 초성이 갈린다(빈=ㅂ / 오=ㅇ) — 오타가 아니라 다른 사람이다(실측 DP5반).
    expect(looksLikeSameName("김태빈", "김태오")).toBe(false);
  });
});

describe("checkClassRosters", () => {
  const cls = [
    { classId: "c1", className: "중등E_중1 TOP", teacher: "이현이", students: [stu("s1", "김나은"), stu("s2", "이채아")] },
  ];
  const board = (members: ReturnType<typeof m>[]) => [{ boardId: 10, boardName: "Hannah 중1 TOP (화수금)", members }];

  it("보드 원아와 1:1이면 ok", () => {
    const r = checkClassRosters([{ ...cls[0]!, students: [stu("s1", "김나은")] }], board([m(1, "김나은")]), KEYS, {
      schoolYear: YEAR,
    });
    expect(r[0]!.status).toBe("ok");
    expect(r[0]!.students[0]!.kind).toBe("ok");
  });

  it("보드에 없는 학생은 missing — 발송 실패 예고", () => {
    const r = checkClassRosters(cls, board([m(1, "김나은")]), KEYS, { schoolYear: YEAR });
    expect(r[0]!.students.find((s) => s.student === "이채아")!.kind).toBe("missing");
    expect(r[0]!.status).toBe("issues");
  });

  it("생년이 같은 다중 후보 = 이중 계정(정상), 갈리면 conflict(오발송 위험)", () => {
    const same = checkClassRosters(
      [{ classId: "c", className: "JP1", teacher: null, students: [stu("s", "이재희", "초6")] }],
      [
        {
          boardId: 1,
          boardName: "[EIE] Junior Plus 1 (화수금 14:20~16:20)",
          members: [m(1, "Jay(이재희)", 2015), m(2, "이재희", 2015)],
        },
      ],
      KEYS,
      { schoolYear: YEAR },
    );
    expect(same[0]!.students[0]!.kind).toBe("dup_account");

    const split = checkClassRosters(
      [{ classId: "c", className: "JP1", teacher: null, students: [stu("s", "이재희", "초6")] }],
      [
        {
          boardId: 1,
          boardName: "[EIE] Junior Plus 1 (화수금 14:20~16:20)",
          members: [m(1, "Jay(이재희)", 2015), m(2, "이재희", 2011)],
        },
      ],
      KEYS,
      { schoolYear: YEAR },
    );
    expect(split[0]!.students[0]!.kind).toBe("conflict");
  });

  it("생년을 모르면 같은 아이로 단정하지 않는다(conflict)", () => {
    const r = checkClassRosters(
      [{ classId: "c", className: "JP1", teacher: null, students: [stu("s", "이재희")] }],
      [{ boardId: 1, boardName: "[EIE] Junior Plus 1", members: [m(1, "Jay(이재희)", null), m(2, "이재희", null)] }],
      KEYS,
      { schoolYear: YEAR },
    );
    expect(r[0]!.students[0]!.kind).toBe("conflict");
  });

  it("원아 0명이면 empty_board — 반 전체가 발송 불가", () => {
    const r = checkClassRosters(cls, board([]), KEYS, { schoolYear: YEAR });
    expect(r[0]!.status).toBe("empty_board");
  });

  it("보드 없음 / 이름 중복은 학생 판정을 하지 않고 그 자체를 문제로 든다", () => {
    expect(checkClassRosters(cls, [], KEYS, { schoolYear: YEAR })[0]!.status).toBe("no_board");
    const dup = checkClassRosters(
      cls,
      [
        { boardId: 10, boardName: "Hannah 중1 TOP (화수금)", members: [] },
        { boardId: 11, boardName: "중1 TOP", members: [] },
      ],
      KEYS,
      { schoolYear: YEAR },
    );
    expect(dup[0]!.status).toBe("dup_board");
  });

  it("aywa 수강이 아닌 원아는 extras — 강사가 반 보드에 쓴 글은 이들에게도 간다", () => {
    const r = checkClassRosters(
      [{ classId: "c1", className: "중등E_중1 TOP", teacher: null, students: [stu("s1", "김나은")] }],
      board([m(1, "김나은"), m(2, "퇴원생")]),
      KEYS,
      { schoolYear: YEAR },
    );
    expect(r[0]!.extras).toEqual(["퇴원생"]);
  });

  it("missing에 표기 차이 힌트를 단다(남는 원아 중에서만)", () => {
    const r = checkClassRosters(
      [{ classId: "c1", className: "중등E_초5 의치대", teacher: null, students: [stu("s1", "박서연E", "초5")] }],
      [{ boardId: 10, boardName: "Elsa 초5 의치대 (화수금)", members: [m(1, "서연", 2015)] }],
      KEYS,
      { schoolYear: YEAR },
    );
    expect(r[0]!.students[0]).toMatchObject({ kind: "missing", hint: "서연" });
  });
});

describe("고정 연결(pin) — 🔴 오발송 방지", () => {
  const 초5반 = [
    { classId: "c1", className: "중등E_초5 의치대", teacher: "JJ", students: [stu("s1", "박서연E", "초5")] },
  ];
  const 보드 = (members: ReturnType<typeof m>[]) => [{ boardId: 10, boardName: "부원장 초5 의치대 (화수금)", members }];
  const link = { studentId: "s1", boardId: 10, childId: 1, childNameAtLink: "서연" };

  it("연결하면 이름이 달라도 ok — 실측 박서연E ↔ 서연", () => {
    const r = checkClassRosters(초5반, 보드([m(1, "서연", 2015)]), KEYS, { links: [link], schoolYear: YEAR });
    expect(r[0]!.status).toBe("ok");
    expect(r[0]!.students[0]).toMatchObject({ kind: "ok", pinned: { childId: 1, childName: "서연", renamed: false } });
    expect(r[0]!.extras).toEqual([]); // 연결된 원아는 '남는 원아'가 아니다
  });

  it("🔴 연결해 둔 원아가 보드에서 사라지면 연결을 **무시**하고 미배정으로 되돌린다(fail-safe)", () => {
    const r = checkClassRosters(초5반, 보드([m(9, "다른아이", 2015)]), KEYS, { links: [link], schoolYear: YEAR });
    expect(r[0]!.students[0]!.kind).toBe("missing");
    expect(r[0]!.students[0]!.pinBroken).toContain("서연");
  });

  it("연결 후 원아 이름이 바뀌면 renamed로 밝힌다 — 조용히 넘어가지 않는다", () => {
    const r = checkClassRosters(초5반, 보드([m(1, "박서연", 2015)]), KEYS, { links: [link], schoolYear: YEAR });
    expect(r[0]!.students[0]!.pinned).toMatchObject({ renamed: true });
  });

  it("🔴 연결로 임자가 있는 원아는 **다른 학생의 이름 매칭에서 제외**된다(뺏김 방지)", () => {
    const r = checkClassRosters(
      [
        {
          classId: "c1",
          className: "중등E_초5 의치대",
          teacher: null,
          students: [stu("s1", "박서연E", "초5"), stu("s2", "서연", "초5")],
        },
      ],
      보드([m(1, "서연", 2015)]),
      KEYS,
      { links: [link], schoolYear: YEAR },
    );
    expect(r[0]!.students.find((s) => s.studentId === "s1")!.kind).toBe("ok");
    expect(r[0]!.students.find((s) => s.studentId === "s2")!.kind).toBe("missing");
  });

  it("연결 후보는 **생년이 맞는 원아만** 오른다 — 안 맞으면 버튼이 안 뜬다", () => {
    const ok = checkClassRosters(초5반, 보드([m(1, "서연", 2015)]), KEYS, { schoolYear: YEAR });
    expect(ok[0]!.students[0]!.pinCandidates!.map((c) => c.childId)).toEqual([1]);

    const bad = checkClassRosters(초5반, 보드([m(1, "서연", 2011)]), KEYS, { schoolYear: YEAR });
    expect(bad[0]!.students[0]!.pinCandidates).toEqual([]);

    const unknown = checkClassRosters(초5반, 보드([m(1, "서연", null)]), KEYS, { schoolYear: YEAR });
    expect(unknown[0]!.students[0]!.pinCandidates).toEqual([]);
  });

  it("이름이 비슷한 후보가 먼저 온다 — 사람이 고를 때 오선택을 줄인다", () => {
    const r = checkClassRosters(초5반, 보드([m(1, "김하나", 2015), m(2, "서연", 2015)]), KEYS, { schoolYear: YEAR });
    expect(r[0]!.students[0]!.pinCandidates!.map((c) => c.childName)).toEqual(["서연", "김하나"]);
  });

  it("이미 다른 학생이 이름으로 잡은 원아는 후보에 없다", () => {
    const r = checkClassRosters(
      [
        {
          classId: "c1",
          className: "중등E_초5 의치대",
          teacher: null,
          students: [stu("s0", "김하나", "초5"), stu("s1", "박서연E", "초5")],
        },
      ],
      보드([m(1, "김하나", 2015)]),
      KEYS,
      { schoolYear: YEAR },
    );
    expect(r[0]!.students.find((s) => s.studentId === "s1")!.pinCandidates).toEqual([]);
  });
});

describe("summarize", () => {
  it("보드를 못 찾은 반의 학생도 미확인으로 센다 — 0으로 두면 문제가 사라져 보인다", () => {
    const r = checkClassRosters(
      [{ classId: "c", className: "없는반", teacher: null, students: [stu("a", "가나"), stu("b", "다라")] }],
      [],
      KEYS,
      { schoolYear: YEAR },
    );
    expect(summarize(r)).toMatchObject({ classes: 1, classesWithIssue: 1, missing: 2, ok: 0 });
  });
});
