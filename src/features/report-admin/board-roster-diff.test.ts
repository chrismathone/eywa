import { describe, expect, it } from "vitest";
import { checkClassRosters, childKeys, looksLikeSameName, matchMembers, summarize } from "./board-roster-diff";
import { classKey, boardKey } from "./english-writing";

const KEYS = { class: classKey, board: boardKey };
const m = (id: number, name: string, birthYear: number | null = 2014) => ({ childId: id, childName: name, birthYear });

describe("childKeys — 워커 규칙 고정", () => {
  it("원문·알파벳 제거본·영문닉(한글)의 한글을 키로 낸다", () => {
    expect([...childKeys("Jay(이재희)")].sort()).toEqual(["Jay(이재희)", "이재희"]);
  });
  it("한글(별명) 표기의 별명은 키로 승격하지 않는다 — 오매칭 연료", () => {
    // "박지민(지민)"에서 "지민"을 키로 올리면 다른 학생 지민과 붙는다.
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

describe("looksLikeSameName — 표기 차이 힌트", () => {
  it("포함 관계(박서연E ↔ 서연)", () => {
    expect(looksLikeSameName("박서연E", "서연")).toBe(true);
  });
  it("한 글자 차이(강지윈 ↔ 강지원)", () => {
    expect(looksLikeSameName("강지윈", "강지원")).toBe(true);
  });
  it("남남은 후보가 아니다", () => {
    expect(looksLikeSameName("최영서", "손라임")).toBe(false);
    // ⚠️ 한 글자 차이지만 초성이 갈린다(빈=ㅂ / 오=ㅇ) — 오타가 아니라 다른 사람이다(실측 DP5반).
    expect(looksLikeSameName("김태빈", "김태오")).toBe(false);
  });
});

describe("checkClassRosters", () => {
  const cls = [{ classId: "c1", className: "중등E_중1 TOP", teacher: "이현이", students: ["김나은", "이채아"] }];

  it("보드 원아와 1:1이면 ok", () => {
    const r = checkClassRosters(
      [{ ...cls[0]!, students: ["김나은"] }],
      [{ boardId: 10, boardName: "Hannah 중1 TOP (화수금)", members: [m(1, "김나은")] }],
      KEYS,
    );
    expect(r[0]!.status).toBe("ok");
    expect(r[0]!.students[0]!.kind).toBe("ok");
  });

  it("보드에 없는 학생은 missing — 발송 실패 예고", () => {
    const r = checkClassRosters(cls, [{ boardId: 10, boardName: "Hannah 중1 TOP (화수금)", members: [m(1, "김나은")] }], KEYS);
    expect(r[0]!.students.find((s) => s.student === "이채아")!.kind).toBe("missing");
    expect(r[0]!.status).toBe("issues");
  });

  it("생년이 같은 다중 후보 = 이중 계정(정상), 갈리면 conflict(오발송 위험)", () => {
    const same = checkClassRosters(
      [{ classId: "c", className: "JP1", teacher: null, students: ["이재희"] }],
      [{ boardId: 1, boardName: "[EIE] Junior Plus 1 (화수금 14:20~16:20)", members: [m(1, "Jay(이재희)", 2015), m(2, "이재희", 2015)] }],
      KEYS,
    );
    expect(same[0]!.students[0]!.kind).toBe("dup_account");

    const split = checkClassRosters(
      [{ classId: "c", className: "JP1", teacher: null, students: ["이재희"] }],
      [{ boardId: 1, boardName: "[EIE] Junior Plus 1 (화수금 14:20~16:20)", members: [m(1, "Jay(이재희)", 2015), m(2, "이재희", 2011)] }],
      KEYS,
    );
    expect(split[0]!.students[0]!.kind).toBe("conflict");
  });

  it("생년을 모르면 같은 아이로 단정하지 않는다(conflict)", () => {
    const r = checkClassRosters(
      [{ classId: "c", className: "JP1", teacher: null, students: ["이재희"] }],
      [{ boardId: 1, boardName: "[EIE] Junior Plus 1", members: [m(1, "Jay(이재희)", null), m(2, "이재희", null)] }],
      KEYS,
    );
    expect(r[0]!.students[0]!.kind).toBe("conflict");
  });

  it("원아 0명이면 empty_board — 반 전체가 발송 불가", () => {
    const r = checkClassRosters(cls, [{ boardId: 10, boardName: "Hannah 중1 TOP (화수금)", members: [] }], KEYS);
    expect(r[0]!.status).toBe("empty_board");
  });

  it("보드 없음 / 이름 중복은 학생 판정을 하지 않고 그 자체를 문제로 든다", () => {
    expect(checkClassRosters(cls, [], KEYS)[0]!.status).toBe("no_board");
    const dup = checkClassRosters(cls, [
      { boardId: 10, boardName: "Hannah 중1 TOP (화수금)", members: [] },
      { boardId: 11, boardName: "중1 TOP", members: [] },
    ], KEYS);
    expect(dup[0]!.status).toBe("dup_board");
  });

  it("eywa 수강이 아닌 원아는 extras — 강사가 반 보드에 쓴 글은 이들에게도 간다", () => {
    const r = checkClassRosters(
      [{ classId: "c1", className: "중등E_중1 TOP", teacher: null, students: ["김나은"] }],
      [{ boardId: 10, boardName: "Hannah 중1 TOP (화수금)", members: [m(1, "김나은"), m(2, "퇴원생")] }],
      KEYS,
    );
    expect(r[0]!.extras).toEqual(["퇴원생"]);
  });

  it("missing에 표기 차이 힌트를 단다(남는 원아 중에서만)", () => {
    const r = checkClassRosters(
      [{ classId: "c1", className: "중등E_초5 의치대", teacher: null, students: ["박서연E"] }],
      [{ boardId: 10, boardName: "Elsa 초5 의치대 (화수금)", members: [m(1, "서연")] }],
      KEYS,
    );
    expect(r[0]!.students[0]).toMatchObject({ kind: "missing", hint: "서연" });
  });
});

describe("summarize", () => {
  it("보드를 못 찾은 반의 학생도 미확인으로 센다 — 0으로 두면 문제가 사라져 보인다", () => {
    const r = checkClassRosters([{ classId: "c", className: "없는반", teacher: null, students: ["가", "나"] }], [], KEYS);
    expect(summarize(r)).toMatchObject({ classes: 1, classesWithIssue: 1, missing: 2, ok: 0 });
  });
});
