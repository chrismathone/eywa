import { describe, expect, it } from "vitest";
import {
  assistantLinkHref,
  collectLinkCandidates,
  parseStoredLinks,
  pickLinksForAnswer,
  type AssistantLink,
} from "./links";

const ID = (n: number) => `0000000${n}-0000-4000-8000-00000000000${n}`;

describe("collectLinkCandidates", () => {
  it("툴 결과 JSON에서 (id, 이름) 쌍만 결정론적으로 수집", () => {
    const results = [
      JSON.stringify({
        total: 2,
        students: [
          { studentId: ID(1), name: "김민수", school: "경명여중" },
          { studentId: ID(2), name: "이서연" },
        ],
      }),
      JSON.stringify({ classes: [{ classId: ID(3), className: "고등M 고1 BS4A" }] }),
      JSON.stringify({ staff: [{ staffId: ID(4), name: "박소선" }] }),
      JSON.stringify({ meetings: [{ meetingId: ID(5), title: "8월 정기 회의" }] }),
    ];
    expect(collectLinkCandidates(results)).toEqual([
      { kind: "student", id: ID(1), label: "김민수" },
      { kind: "student", id: ID(2), label: "이서연" },
      { kind: "class", id: ID(3), label: "고등M 고1 BS4A" },
      { kind: "staff", id: ID(4), label: "박소선" },
      { kind: "meeting", id: ID(5), label: "8월 정기 회의" },
    ]);
  });

  it("JSON이 아닌 툴 결과(오류 문자열)는 조용히 건너뛴다", () => {
    expect(collectLinkCandidates(["오류: 알 수 없는 툴 foo", "not json"])).toEqual([]);
  });

  it("uuid가 아닌 id·이름 없는 항목은 후보가 아니다(환각 링크 차단)", () => {
    const results = [
      JSON.stringify({
        students: [
          { studentId: "12345", name: "가짜" },
          { studentId: ID(1), name: "" },
          { studentId: ID(2), name: "정상" },
        ],
      }),
    ];
    expect(collectLinkCandidates(results)).toEqual([{ kind: "student", id: ID(2), label: "정상" }]);
  });

  it("중첩(반 상세 안 수강생 명단)도 훑는다", () => {
    const results = [JSON.stringify({ className: "DP5", students: [{ studentId: ID(7), name: "최지우" }] })];
    expect(collectLinkCandidates(results)).toEqual([{ kind: "student", id: ID(7), label: "최지우" }]);
  });
});

describe("pickLinksForAnswer", () => {
  const cands: AssistantLink[] = [
    { kind: "student", id: ID(1), label: "김민수" },
    { kind: "student", id: ID(2), label: "이서연" },
    { kind: "class", id: ID(3), label: "DP5" },
  ];

  it("본문에 실제로 등장한 이름만 버튼이 된다([[#86]])", () => {
    const { links, omitted } = pickLinksForAnswer("김민수 학생은 최근 결석이 잦습니다.", cands);
    expect(links).toEqual([{ kind: "student", id: ID(1), label: "김민수" }]);
    expect(omitted).toBe(0);
  });

  it("등장 순서대로 정렬", () => {
    const { links } = pickLinksForAnswer("DP5 반에서 이서연 학생이 결석했습니다.", cands);
    expect(links.map((l) => l.label)).toEqual(["DP5", "이서연"]);
  });

  it("동명이인은 통째로 제외(어느 쪽인지 모르는 버튼은 없느니만 못하다)", () => {
    const dup: AssistantLink[] = [
      { kind: "student", id: ID(1), label: "김민수" },
      { kind: "student", id: ID(2), label: "김민수" },
    ];
    expect(pickLinksForAnswer("김민수 학생 두 명이 있습니다.", dup).links).toEqual([]);
  });

  it("더 긴 이름에 포함되는 짧은 이름은 제외", () => {
    const overlap: AssistantLink[] = [
      { kind: "student", id: ID(1), label: "김민" },
      { kind: "student", id: ID(2), label: "김민수" },
    ];
    expect(pickLinksForAnswer("김민수 학생 상담이 필요합니다.", overlap).links).toEqual([
      { kind: "student", id: ID(2), label: "김민수" },
    ]);
  });

  it("한 글자 라벨은 본문 어디에나 걸리므로 제외", () => {
    expect(pickLinksForAnswer("김 선생님", [{ kind: "staff", id: ID(1), label: "김" }]).links).toEqual([]);
  });

  it("상한을 넘으면 잘라내고 남은 수를 함께 돌려준다(붙인 게 전부인 척 금지)", () => {
    const many: AssistantLink[] = Array.from({ length: 10 }, (_, i) => ({
      kind: "student" as const,
      id: `0000000${i}-0000-4000-8000-00000000000${i}`,
      label: `학생${i}`,
    }));
    const answer = many.map((m) => m.label).join(", ");
    const { links, omitted } = pickLinksForAnswer(answer, many, 8);
    expect(links).toHaveLength(8);
    expect(omitted).toBe(2);
  });

  it("빈 답변·후보 없음은 빈 결과", () => {
    expect(pickLinksForAnswer("", cands)).toEqual({ links: [], omitted: 0 });
    expect(pickLinksForAnswer("답변", [])).toEqual({ links: [], omitted: 0 });
  });
});

describe("parseStoredLinks — DB jsonb 불신", () => {
  it("종류 화이트리스트·uuid·라벨을 항목별로 검증하고 어긋난 것만 버린다", () => {
    expect(
      parseStoredLinks([
        { kind: "student", id: ID(1), label: "김민수" },
        { kind: "payroll", id: ID(2), label: "급여" }, // 허용 밖 종류
        { kind: "student", id: "../../etc", label: "경로 주입" }, // uuid 아님
        { kind: "class", id: ID(3), label: "   " }, // 빈 라벨
        "문자열",
        null,
      ]),
    ).toEqual([{ kind: "student", id: ID(1), label: "김민수" }]);
  });

  it("배열이 아니면 빈 배열", () => {
    expect(parseStoredLinks(null)).toEqual([]);
    expect(parseStoredLinks({ kind: "student" })).toEqual([]);
  });

  it("긴 라벨은 상한으로 자르고 중복 id는 1개만", () => {
    const [only] = parseStoredLinks([
      { kind: "meeting", id: ID(1), label: "가".repeat(200) },
      { kind: "meeting", id: ID(1), label: "같은 회의" },
    ]);
    expect(only!.label).toHaveLength(60);
  });
});

describe("assistantLinkHref", () => {
  it("종류별 상세 경로", () => {
    expect(assistantLinkHref({ kind: "student", id: ID(1), label: "x" })).toBe(`/students/${ID(1)}`);
    expect(assistantLinkHref({ kind: "class", id: ID(1), label: "x" })).toBe(`/classes/${ID(1)}`);
    expect(assistantLinkHref({ kind: "staff", id: ID(1), label: "x" })).toBe(`/staff/${ID(1)}`);
    expect(assistantLinkHref({ kind: "meeting", id: ID(1), label: "x" })).toBe(`/meetings/${ID(1)}`);
  });
});
