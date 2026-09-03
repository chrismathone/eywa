import { describe, expect, it } from "vitest";
import {
  SHUTTLE_BOARD_PATH,
  SHUTTLE_LIVE_PATH,
  SHUTTLE_TODAY_PATH,
  shuttleFaces,
} from "./faces";

describe("셔틀 면 전환", () => {
  it("세 면이 사이드바 하부탭에서 파생된다", () => {
    const faces = shuttleFaces("term");
    expect(faces.map((f) => f.key)).toEqual([
      SHUTTLE_BOARD_PATH,
      SHUTTLE_TODAY_PATH,
      SHUTTLE_LIVE_PATH,
    ]);
    expect(faces.map((f) => f.label)).toEqual(["노선 편성", "오늘 등하원", "운행 현황"]);
  });

  it("면을 옮겨도 시즌이 유지된다", () => {
    // 라벨만 있고 시즌이 빠지면 방학 편성을 보다 탭을 옮길 때 학기중 명단으로 되돌아간다.
    expect(shuttleFaces("vacation").map((f) => f.href)).toEqual([
      "/shuttle?season=vacation",
      "/shuttle/today?season=vacation",
      "/shuttle/live?season=vacation",
    ]);
  });

  it("active로 쓰는 상수가 실제 면 키에 있다", () => {
    // 하부탭 href를 바꾸면 active가 어느 면과도 안 맞아 **탭이 통째로 비활성**으로 보인다.
    const keys = shuttleFaces("term").map((f) => f.key);
    expect(keys).toContain(SHUTTLE_BOARD_PATH);
    expect(keys).toContain(SHUTTLE_TODAY_PATH);
    expect(keys).toContain(SHUTTLE_LIVE_PATH);
  });
});
