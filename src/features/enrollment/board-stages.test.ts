import { describe, expect, it } from "vitest";
import {
  ASSIGNED_DRAG_BLOCKED,
  BOARD_STAGES,
  ENROLLED_REVERT_BLOCKED,
  cardMarkOf,
  dropBlockReason,
  outcomeForDrop,
  stageOfCard,
  stageOfOutcome,
} from "./board-stages";
import { OUTCOME_PILL } from "./outcome-meta";

const card = (over: Partial<Parameters<typeof cardMarkOf>[0]> = {}) => ({
  outcome: "pending",
  assignedClassCount: 0,
  fromPublicIntake: false,
  hasAudio: false,
  ...over,
});

describe("칸 묶음 — enum 7개가 칸 4개로", () => {
  it("옛 5칸의 outcome이 새 4칸으로 빠짐없이 들어간다", () => {
    expect(stageOfOutcome("pending")).toBe("before");
    expect(stageOfOutcome("scheduled")).toBe("before");
    expect(stageOfOutcome("consulted")).toBe("consulted");
    expect(stageOfOutcome("ai_done")).toBe("consulted");
    expect(stageOfOutcome("declined")).toBe("unregistered");
    expect(stageOfOutcome("no_show")).toBe("unregistered");
    expect(stageOfOutcome("enrolled")).toBe("enrolled");
  });

  // 🔴 enum이 늘어난 날 카드가 조용히 사라지지 않게 — outcome-meta(정본)와 칸 묶음을 함께 잠근다.
  it("outcome 정본(OUTCOME_PILL)의 모든 값이 정확히 한 칸에만 속한다", () => {
    for (const outcome of Object.keys(OUTCOME_PILL)) {
      const owners = BOARD_STAGES.filter((s) => s.outcomes.includes(outcome));
      expect(owners.map((s) => s.key)).toHaveLength(1);
    }
    const covered = BOARD_STAGES.flatMap((s) => s.outcomes).sort();
    expect(covered).toEqual(Object.keys(OUTCOME_PILL).sort());
  });

  it("모르는 값도 사라지지 않고 '상담 전'에 선다", () => {
    expect(stageOfOutcome("무언가_새로운_상태")).toBe("before");
  });

  it("반 배정(수강 ≥ 1)이 outcome을 이긴다 — 어느 outcome이든 '등록 완료' 칸", () => {
    expect(stageOfCard({ outcome: "pending", assignedClassCount: 2 })).toBe("enrolled");
    expect(stageOfCard({ outcome: "declined", assignedClassCount: 1 })).toBe("enrolled");
    expect(stageOfCard({ outcome: "declined", assignedClassCount: 0 })).toBe("unregistered");
  });
});

describe("드롭 대표값 — 원래 값이 그 칸 안이면 유지", () => {
  it("상담 전 ← pending, 단 scheduled는 유지", () => {
    expect(outcomeForDrop("before", "consulted")).toBe("pending");
    expect(outcomeForDrop("before", "scheduled")).toBe("scheduled");
  });

  it("상담 완료 ← consulted, 단 ai_done은 유지(AI 완료라는 사실을 드래그로 지우지 않는다)", () => {
    expect(outcomeForDrop("consulted", "pending")).toBe("consulted");
    expect(outcomeForDrop("consulted", "ai_done")).toBe("ai_done");
  });

  it("미등록 ← declined, 단 no_show는 유지", () => {
    expect(outcomeForDrop("unregistered", "consulted")).toBe("declined");
    expect(outcomeForDrop("unregistered", "no_show")).toBe("no_show");
  });

  it("등록 완료 ← enrolled", () => {
    expect(outcomeForDrop("enrolled", "pending")).toBe("enrolled");
    expect(outcomeForDrop("enrolled", "enrolled")).toBe("enrolled");
  });

  it("모르는 칸이 오면 값을 바꾸지 않는다", () => {
    expect(outcomeForDrop("nope" as never, "ai_done")).toBe("ai_done");
  });
});

describe("드롭 차단 — 화면이 먼저 막고 서버가 다시 검증한다", () => {
  it("반 배정 완료 카드는 어느 칸으로도 못 옮긴다", () => {
    const assigned = { outcome: "enrolled", assignedClassCount: 1 };
    for (const s of BOARD_STAGES) expect(dropBlockReason(assigned, s.key)).toBe(ASSIGNED_DRAG_BLOCKED);
  });

  it("재원생 등록은 뒤로 못 가고 '미등록'(거절)으로만 내려간다 — 서버 규칙과 같다", () => {
    const enrolled = { outcome: "enrolled", assignedClassCount: 0 };
    expect(dropBlockReason(enrolled, "before")).toBe(ENROLLED_REVERT_BLOCKED);
    expect(dropBlockReason(enrolled, "consulted")).toBe(ENROLLED_REVERT_BLOCKED);
    expect(dropBlockReason(enrolled, "unregistered")).toBeNull();
    expect(dropBlockReason(enrolled, "enrolled")).toBeNull();
  });

  it("그 밖의 카드는 자유롭게 오간다", () => {
    for (const s of BOARD_STAGES) {
      expect(dropBlockReason({ outcome: "consulted", assignedClassCount: 0 }, s.key)).toBeNull();
    }
  });
});

describe("카드 표식 — 칸마다 최대 하나", () => {
  it("상담 전: QR 접수만 라벨을 달고 나머지는 아무것도 안 단다", () => {
    expect(cardMarkOf(card({ fromPublicIntake: true }))).toBe("qr");
    expect(cardMarkOf(card())).toBeNull();
    expect(cardMarkOf(card({ outcome: "scheduled" }))).toBeNull();
  });

  it("상담 완료: 녹음이 있으면 녹음 표식 하나만", () => {
    expect(cardMarkOf(card({ outcome: "ai_done", hasAudio: true }))).toBe("audio");
    // 분석이 아직 안 끝난 녹음 건도 같은 표식 — 녹음이 끝나면 분석은 자동으로 이어진다.
    expect(cardMarkOf(card({ outcome: "consulted", hasAudio: true }))).toBe("audio");
  });

  // 🔴 'AI 완료' 배지는 없앴다(원장 2026-09-01) — 텍스트 분석 버튼을 없애 분석 경로가 녹음 하나가 됐다.
  it("녹음이 없으면 아무 표식도 안 단다(AI 완료 배지 폐기)", () => {
    expect(cardMarkOf(card({ outcome: "ai_done" }))).toBeNull();
    expect(cardMarkOf(card({ outcome: "consulted" }))).toBeNull();
  });

  it("QR 접수 라벨은 '상담 전'에서만 — 다른 칸에서 표식이 두 개가 되지 않게", () => {
    expect(cardMarkOf(card({ outcome: "consulted", fromPublicIntake: true, hasAudio: true }))).toBe("audio");
    expect(cardMarkOf(card({ outcome: "declined", fromPublicIntake: true }))).toBeNull();
  });

  it("반 배정까지 끝난 건에만 '반 배정 완료'", () => {
    expect(cardMarkOf(card({ outcome: "enrolled", assignedClassCount: 1 }))).toBe("assigned");
    expect(cardMarkOf(card({ outcome: "enrolled" }))).toBeNull();
  });
});
