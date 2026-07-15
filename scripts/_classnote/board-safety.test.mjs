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
    expect(r.reason).toMatch(/연결 가족 2/);
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
});
