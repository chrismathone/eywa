import { describe, expect, it } from "vitest";
import { destinationRoomOf, type DestinationRoomSource } from "./destination-room";

/**
 * 강의실 — 배치 FK → 배치 라벨(정본) → 반 기본 강의실. 원장 2026-09-11 *"이도윤B는 왜 금요일 랩실 끝나고 1620
 * 다음수업이라고만 되어있지? 강의실이 없고? 강의실이 다 있을텐데"*.
 * 실측(읽기 전용, injaewon 2026-09-11): 수학 유효 배치 246줄 중 245줄이 배치 FK·라벨 둘 다 비어 있고, 방은 반 기본
 * 강의실(`classes.classroom_id`)에만 있다. 유효 자리 배치(랩실 57·JJ 61)는 전부 제 방이 있다.
 */
const LAB = "본원603";
const known = ["본원205", "본원302", LAB, "본원606", "바른602", "본원602"];
const src = (over: Partial<DestinationRoomSource>): DestinationRoomSource => ({
  slotRoom: null,
  roomLabel: null,
  classRoom: null,
  seatLabel: null,
  ...over,
});

describe("강의실 — 배치 FK → 배치 라벨(정본) → 반 기본 강의실", () => {
  it("배치 FK 이름이 먼저다", () => {
    expect(destinationRoomOf(src({ slotRoom: "본원606", roomLabel: "302", classRoom: "본원205" }), known)).toBe("본원606");
  });

  it("FK가 없으면 배치 라벨을 등록된 정본으로 맞춘다([[#115]])", () => {
    expect(destinationRoomOf(src({ roomLabel: "302", classRoom: "본원205" }), known)).toBe("본원302");
  });

  it("🔴 배치에 방이 없으면 반 기본 강의실 — 이도윤B 금 16:20 수학(`초등M 초4 EL2S` → 본원205)", () => {
    expect(destinationRoomOf(src({ classRoom: "본원205" }), known)).toBe("본원205");
  });

  it("🔴 자리(LAB·JJ) 배치는 반 기본 강의실을 물려받지 않는다 — 반의 방은 자리의 방이 아니다", () => {
    expect(destinationRoomOf(src({ classRoom: "본원606", seatLabel: "LAB" }), known)).toBeNull();
    expect(destinationRoomOf(src({ classRoom: "본원606", seatLabel: "JJ" }), known)).toBeNull();
    // 제 방이 있으면 그대로(실측 유효 자리 배치는 전부 이쪽이다).
    expect(destinationRoomOf(src({ roomLabel: "603", classRoom: "본원606", seatLabel: "LAB" }), known)).toBe(LAB);
  });

  it("빈 FK 이름은 라벨을 가리지 않는다", () => {
    expect(destinationRoomOf(src({ slotRoom: "  ", roomLabel: "302" }), known)).toBe("본원302");
  });

  it("⚠️ 애매한 라벨(602 = 바른602·본원602)은 손대지 않는다 — 배치 라벨이 있으니 반 기본 강의실로 넘어가지 않는다", () => {
    expect(destinationRoomOf(src({ roomLabel: "602", classRoom: "본원205" }), known)).toBe("602");
  });

  it("아무것도 없으면 null — 화면은 시각만 적는다", () => {
    expect(destinationRoomOf(src({}), known)).toBeNull();
  });
});
