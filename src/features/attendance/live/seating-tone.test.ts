import { describe, expect, it } from "vitest";
import {
  pendingCountOf,
  seatingCardClass,
  seatingHeaderClass,
  seatingToneNote,
  seatingToneOf,
} from "./seating-tone";
import type { SeatMark } from "./mark-state";

const klass = (marks: SeatMark[]) => ({
  students: marks.map((mark, i) => ({ mark, studentId: String(i) })),
});

describe("pendingCountOf", () => {
  it("빈 칸(미출결)만 센다 — 대기는 아직 조치 대상이 아니다", () => {
    expect(pendingCountOf(klass(["present", "unmarked", "absent", "waiting", "unmarked"]))).toBe(2);
    expect(pendingCountOf(klass(["present", "absent", "late"]))).toBe(0);
    expect(pendingCountOf(klass([]))).toBe(0);
  });
});

describe("seatingToneOf", () => {
  it("진행 중·진행 전은 미입력과 무관하게 그대로", () => {
    expect(seatingToneOf("now", 5)).toBe("now");
    expect(seatingToneOf("now", 0)).toBe("now");
    expect(seatingToneOf("upcoming", 5)).toBe("upcoming");
  });

  it("지남은 둘로 갈린다 — 다 찍은 수업과 아무도 안 찍은 수업이 같아 보이면 안 된다", () => {
    expect(seatingToneOf("past", 0)).toBe("past_done");
    expect(seatingToneOf("past", 1)).toBe("past_pending");
  });
});

describe("seatingHeaderClass", () => {
  it("진행 중 = 네이비, 진행 전 = 회색(종전 규약 유지)", () => {
    expect(seatingHeaderClass("now")).toContain("bg-primary");
    expect(seatingHeaderClass("upcoming")).toContain("bg-att-weekend");
    expect(seatingHeaderClass("upcoming")).not.toContain("bg-primary");
  });

  it("끝난 수업이 진행 중과 같은 네이비이던 것이 사고의 절반이었다 — 넷이 전부 다른 색", () => {
    const tones = ["now", "upcoming", "past_pending", "past_done"] as const;
    expect(new Set(tones.map(seatingHeaderClass)).size).toBe(4);
  });

  it("지남·미입력 = 앰버(경고), 지남·완료 = 옅은 뉴트럴", () => {
    expect(seatingHeaderClass("past_pending")).toContain("amber");
    expect(seatingHeaderClass("past_done")).not.toContain("amber");
    expect(seatingHeaderClass("past_done")).toContain("text-text-dim");
  });

  it("globals.css에 있는 토큰만 쓴다 — amber-strong 같은 미정의 클래스 금지", () => {
    const all = (["now", "upcoming", "past_pending", "past_done"] as const)
      .flatMap((t) => [seatingHeaderClass(t), seatingCardClass(t)])
      .join(" ");
    expect(all).not.toMatch(/amber-strong|-\[#/);
  });
});

describe("seatingCardClass", () => {
  it("지남·미입력만 좌측 굵은 띠 — 흐리게(opacity) 만들지 않는다", () => {
    expect(seatingCardClass("past_pending")).toContain("border-l-4");
    expect(seatingCardClass("past_pending")).toContain("border-amber");
    const all = (["now", "upcoming", "past_pending", "past_done"] as const).map(seatingCardClass).join(" ");
    expect(all).not.toMatch(/opacity/);
  });

  it("지남·완료는 테두리만 — 그림자를 빼고 조용히 물러난다", () => {
    expect(seatingCardClass("past_done")).toContain("border");
    expect(seatingCardClass("past_done")).not.toContain("shadow");
  });
});

describe("seatingToneNote", () => {
  it("지남만 한 마디를 붙인다 — 한글, raw 코드 금지", () => {
    expect(seatingToneNote("past_pending", 3)).toBe("미입력 3");
    expect(seatingToneNote("past_done", 0)).toBe("입력 완료");
    expect(seatingToneNote("now", 3)).toBe("");
    expect(seatingToneNote("upcoming", 0)).toBe("");
  });
});
