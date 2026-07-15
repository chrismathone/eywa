import { describe, it, expect } from "vitest";
import { evaluateBoardSafety, normBoard } from "./board-safety.mjs";

const boards = [
  { id: 1, name: "(수학)박서준", children: 2 }, // 공유(다른 두 가족)
  { id: 2, name: "(수학)안은지", children: 2 }, // 같은 학생 다계정(원장 확인 → 화이트리스트 대상)
  { id: 4, name: "(수학)강민준", children: 1 }, // 정상
  { id: 5, name: "(수학)김공유", children: 0 }, // 학부모 미연결
  { id: 6, name: "(수학)쌍둥이", children: 1 },
  { id: 7, name: "(수학)쌍둥이", children: 1 }, // 중복 보드명
];

describe("normBoard", () => {
  it("공백 전부 제거", () => {
    expect(normBoard("(수학) 안 은지")).toBe("(수학)안은지");
    expect(normBoard(null)).toBe("");
  });
});

describe("evaluateBoardSafety", () => {
  it("정상 1가족 → 발송", () => {
    expect(evaluateBoardSafety({ className: "(수학)강민준", boards }).ok).toBe(true);
  });

  it("공유 2가족(비허용) → 차단(shared)", () => {
    const r = evaluateBoardSafety({ className: "(수학)박서준", boards });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("shared");
    expect(r.occupants).toBe(2);
    expect(r.reason).toMatch(/연결 계정 2/); // "가족"이 아니라 "계정" — 한 학생이 계정 2개인 게 실제 다수(원장 확인)
  });

  it("공유지만 화이트리스트 등재 → 발송", () => {
    expect(evaluateBoardSafety({ className: "(수학)안은지", boards, allowlist: ["(수학)안은지"] }).ok).toBe(true);
  });

  it("화이트리스트 매칭은 공백 무시", () => {
    expect(evaluateBoardSafety({ className: "(수학)안은지", boards, allowlist: ["(수학) 안은지"] }).ok).toBe(true);
  });

  it("보드 없음 → 차단(no_board)", () => {
    expect(evaluateBoardSafety({ className: "(수학)없는애", boards }).code).toBe("no_board");
  });

  it("중복 보드명 → 차단(dup_board)", () => {
    expect(evaluateBoardSafety({ className: "(수학)쌍둥이", boards }).code).toBe("dup_board");
  });

  it("실시간 occupants가 board.children보다 우선", () => {
    // 캐시상 1가족이어도 실시간 2가족이면 차단
    expect(evaluateBoardSafety({ className: "(수학)강민준", boards, occupants: 2 }).ok).toBe(false);
    // 캐시상 2가족이어도 실시간 1가족이면 발송(원장이 방금 제거)
    expect(evaluateBoardSafety({ className: "(수학)박서준", boards, occupants: 1 }).ok).toBe(true);
  });

  it("0가족(미연결) → 발송(누수 아님)", () => {
    expect(evaluateBoardSafety({ className: "(수학)김공유", boards }).ok).toBe(true);
  });

  it("빈 className → 차단(no_class)", () => {
    expect(evaluateBoardSafety({ className: "", boards }).code).toBe("no_class");
  });

  // ── 2026-07-15 검수가 잡은 major 2건 — 정확히 이 두 케이스가 테스트 사각지대였다.

  it("⭐ 인원을 모르면(children=null) 차단 — '모름'을 0(안전)으로 뭉개면 게이트가 통째로 사라진다", () => {
    // ClassNote가 approved_children를 개명·누락하면 전 보드가 null이 된다. 예전엔 `?? 0`이라
    // 0 > 1 = false로 **전부 통과**했고, 감시 스캔도 같은 식이라 "공유 보드 0개"라고 보고했다(상관 실패).
    const unknown = [{ id: 9, name: "(수학)미상", children: null }];
    const v = evaluateBoardSafety({ className: "(수학)미상", boards: unknown });
    expect(v.ok).toBe(false);
    expect(v.code).toBe("unknown_occupants");
  });

  it("children 필드가 아예 없어도(undefined) 차단 — 위와 같은 사고 경로", () => {
    const noField = [{ id: 9, name: "(수학)미상" }];
    expect(evaluateBoardSafety({ className: "(수학)미상", boards: noField }).code).toBe("unknown_occupants");
  });

  it("진짜 0가족과 '모름'은 다르게 다룬다 — 0은 통과, null은 차단", () => {
    const mixed = [
      { id: 1, name: "(수학)미연결", children: 0 },
      { id: 2, name: "(수학)모름", children: null },
    ];
    expect(evaluateBoardSafety({ className: "(수학)미연결", boards: mixed }).ok).toBe(true);
    expect(evaluateBoardSafety({ className: "(수학)모름", boards: mixed }).ok).toBe(false);
  });

  it("⭐ 예외 등재돼도 확인 범위(기본 2개)를 넘으면 재차단 — 등재 후 붙은 계정은 확인된 적이 없다", () => {
    // 박서준 사고와 같은 모드: 원장이 2개 확인 후 등재 → 나중에 남의 가족이 추가 연결 → 예전엔 그냥 통과했다.
    const grown = [{ id: 3, name: "(수학)안은지", children: 3 }];
    const v = evaluateBoardSafety({ className: "(수학)안은지", boards: grown, allowlist: ["(수학)안은지"] });
    expect(v.ok).toBe(false);
    expect(v.code).toBe("shared_grown");
    expect(v.occupants).toBe(3);
  });

  it("⭐ 정상적으로 3계정인 집은 `보드명|3`으로 열 수 있다 — 재차단이 막다른 길이 되면 안 된다", () => {
    // 원장 확인(2026-07-15): 영어·수학 따로 가입 / 학부모·학생 각자 가입 → 보통 2개지만 3개도 있을 수 있다.
    const three = [{ id: 5, name: "(수학)홍길동", children: 3 }];
    expect(evaluateBoardSafety({ className: "(수학)홍길동", boards: three, allowlist: ["(수학)홍길동|3"] }).ok).toBe(true);
    // 지정한 3을 넘으면 다시 차단
    const four = [{ id: 5, name: "(수학)홍길동", children: 4 }];
    expect(evaluateBoardSafety({ className: "(수학)홍길동", boards: four, allowlist: ["(수학)홍길동|3"] }).code).toBe(
      "shared_grown",
    );
  });

  it("인원 지정은 정규화 전에 떼어낸다 — 공백이 섞여도 보드명이 맞아야 한다", () => {
    const three = [{ id: 5, name: "(수학)홍길동", children: 3 }];
    expect(evaluateBoardSafety({ className: "(수학)홍길동", boards: three, allowlist: [" (수학) 홍길동 | 3 "] }).ok).toBe(
      true,
    );
  });

  it("`|0`·`|abc` 같은 깨진 지정은 기본값(2)으로 안전하게 떨어진다", () => {
    const three = [{ id: 5, name: "(수학)홍길동", children: 3 }];
    for (const entry of ["(수학)홍길동|0", "(수학)홍길동|abc"]) {
      expect(evaluateBoardSafety({ className: "(수학)홍길동", boards: three, allowlist: [entry] }).ok).toBe(false);
    }
  });

  it("예외 등재 + 2가족(확인한 그대로)은 통과 — 오탐 4가족(이재용·이재희·주준호·안은지)이 이 경로", () => {
    const two = [{ id: 4, name: "(수학)이재용", children: 2 }];
    expect(evaluateBoardSafety({ className: "(수학)이재용", boards: two, allowlist: ["(수학)이재용"] }).ok).toBe(true);
  });

  it("실시간 occupants로도 증가가 잡힌다(캐시가 2여도 실시간 3이면 차단)", () => {
    const two = [{ id: 4, name: "(수학)이재용", children: 2 }];
    expect(
      evaluateBoardSafety({ className: "(수학)이재용", boards: two, allowlist: ["(수학)이재용"], occupants: 3 }).code,
    ).toBe("shared_grown");
  });
});
