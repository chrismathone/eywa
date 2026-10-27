import { describe, expect, it } from "vitest";
import {
  SHUTTLE_BOARD_PATH,
  SHUTTLE_LIVE_PATH,
  SHUTTLE_NEARBY_PATH,
  SHUTTLE_PARENT_RIDES_PATH,
  SHUTTLE_TODAY_PATH,
  SHUTTLE_TRACK_PATH,
  SHUTTLE_WEEK_PATH,
  shuttleFaces,
} from "./faces";
import { SHUTTLE_PARENTS_PATH } from "./parent-accounts/parent-access";

describe("셔틀 면 전환", () => {
  it("여섯 면이 사이드바 하부탭에서 파생된다 — 학부모 등하원은 오늘 등하원 바로 뒤", () => {
    const faces = shuttleFaces("term");
    expect(faces.map((f) => f.key)).toEqual([
      SHUTTLE_BOARD_PATH,
      SHUTTLE_WEEK_PATH,
      SHUTTLE_TODAY_PATH,
      SHUTTLE_PARENT_RIDES_PATH,
      SHUTTLE_LIVE_PATH,
    ]);
    expect(faces.map((f) => f.label)).toEqual([
      "노선 편성",
      "주간 시간표",
      "오늘 등하원",
      "학부모 등하원",
      "운행 현황",
    ]);
  });

  it("실시간 위치는 관리자에게만 — track일 때만 끝에 붙는다(2026-10-08)", () => {
    expect(shuttleFaces("term").map((f) => f.key)).not.toContain(SHUTTLE_TRACK_PATH);
    const admin = shuttleFaces("term", { track: true });
    expect(admin.at(-2)).toEqual({ key: SHUTTLE_TRACK_PATH, label: "실시간 위치", href: "/shuttle/track?season=term" });
    // 가까운 노선 찾기도 같은 관리자 전용(2026-10-26).
    expect(shuttleFaces("term").map((f) => f.key)).not.toContain(SHUTTLE_NEARBY_PATH);
    expect(admin.at(-1)).toEqual({ key: SHUTTLE_NEARBY_PATH, label: "가까운 노선 찾기", href: "/shuttle/nearby?season=term" });
  });

  it("원장·관리자 전용 '학부모 관리 현황'은 공용 탭 줄에 없다", () => {
    // 이 줄은 셔틀을 보는 모든 역할의 탭 줄이다 — 여기 있으면 강사·뷰어에게도 탭이 선다.
    expect(shuttleFaces("term").map((f) => f.key)).not.toContain(SHUTTLE_PARENTS_PATH);
  });

  it("면을 옮겨도 시즌이 유지된다", () => {
    // 라벨만 있고 시즌이 빠지면 방학 편성을 보다 탭을 옮길 때 학기중 명단으로 되돌아간다.
    expect(shuttleFaces("vacation").map((f) => f.href)).toEqual([
      "/shuttle?season=vacation",
      "/shuttle/week?season=vacation",
      "/shuttle/today?season=vacation",
      "/shuttle/parent-rides?season=vacation",
      "/shuttle/live?season=vacation",
    ]);
    expect(shuttleFaces("vacation", { track: true }).at(-2)?.href).toBe("/shuttle/track?season=vacation");
  });

  it("active로 쓰는 상수가 실제 면 키에 있다", () => {
    // 하부탭 href를 바꾸면 active가 어느 면과도 안 맞아 **탭이 통째로 비활성**으로 보인다.
    const keys = shuttleFaces("term").map((f) => f.key);
    expect(keys).toContain(SHUTTLE_BOARD_PATH);
    expect(keys).toContain(SHUTTLE_WEEK_PATH);
    expect(keys).toContain(SHUTTLE_TODAY_PATH);
    expect(keys).toContain(SHUTTLE_PARENT_RIDES_PATH);
    expect(keys).toContain(SHUTTLE_LIVE_PATH);
    expect(shuttleFaces("term", { track: true }).map((f) => f.key)).toContain(SHUTTLE_TRACK_PATH);
  });
});
