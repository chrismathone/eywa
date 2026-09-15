import { describe, expect, it } from "vitest";
import { strayAnchorRowIndex } from "./stray-reserved";

/**
 * 원반 칸이 없는 보강 예약이 **어느 교시 행에 앉는가** — 실제 제보 건(안은지 9/17 14:20~16:20)이 기준이다.
 * 수학 평일 교시표(인재원 실설정): 1-1 14:20~15:20 · 1-2 15:25~16:20 · 2-1 16:20~17:15 · 2-2 17:15~18:10 …
 */
const MATH_ROWS = [
  { time: "14:20~15:20" },
  { time: "15:25~16:20" },
  { time: "16:20~17:15" },
  { time: "17:15~18:10" },
];

describe("보강 박스 — 앉을 교시 행", () => {
  it("두 교시에 걸친 예약(14:20~16:20)은 **첫 행 하나**에만 선다", () => {
    expect(strayAnchorRowIndex(MATH_ROWS, "14:20", "16:20")).toBe(0);
  });

  it("둘째 교시만 쓰는 예약은 그 행에 선다", () => {
    expect(strayAnchorRowIndex(MATH_ROWS, "15:25", "16:20")).toBe(1);
  });

  it("🔴 경계가 맞닿는 것은 겹침이 아니다 — 15:20~16:20 예약이 1-1(…~15:20) 칸으로 올라가지 않는다", () => {
    expect(strayAnchorRowIndex(MATH_ROWS, "15:20", "16:20")).toBe(1);
    // 반대쪽 경계도 같다: 16:20에 시작하는 예약은 1-2(…~16:20)가 아니라 2-1에 선다.
    expect(strayAnchorRowIndex(MATH_ROWS, "16:20", "17:15")).toBe(2);
  });

  it("교시표 밖 시각은 세우지 않는다(-1) — '보강' 탭 몫", () => {
    expect(strayAnchorRowIndex(MATH_ROWS, "09:00", "10:00")).toBe(-1);
    expect(strayAnchorRowIndex(MATH_ROWS, "22:30", "23:30")).toBe(-1);
  });

  it("끝이 없는 폴백 행은 그 시각 한 점 — 그 시각에 걸치는 예약만 걸린다", () => {
    const rows = [{ time: "13:00" }, { time: "14:20~15:20" }];
    expect(strayAnchorRowIndex(rows, "13:00", "14:00")).toBe(0);
    expect(strayAnchorRowIndex(rows, "14:20", "15:20")).toBe(1);
  });

  it("형식이 아닌 값은 지어내지 않고 -1", () => {
    expect(strayAnchorRowIndex(MATH_ROWS, "", "")).toBe(-1);
    expect(strayAnchorRowIndex(MATH_ROWS, "14:20", "나중")).toBe(-1);
  });
});

/**
 * 병합 표식 — 실제 화면(이수진 선생님 월+목): MS1A에 9/17(목) 예약이 있고, 같은 열의 MS2A에는 예약이 없다.
 * 🔴 여기서 지켜야 하는 것은 "예약이 걸린 **그 반만** 쪼개진다"이다(적대 리뷰 2026-09-14 [중]).
 */

/**
 * 🔴 **병합 표식은 없다**(원장 2026-09-15 *"이렇게 붙어있는 수업은 그냥 붙어있게 표시해줘 다른 퇴원이나 대기처럼"*) —
 *    월+목 한 칸인 반에 목요일 예약이 걸려도 칸은 붙어 있고, 요일은 박스 줄 끝 표식이 말한다. 옛
 *    `strayMarkKey`·`cellKeyWithStrayMark`·`strayOwnerClassKey`와 그 테스트는 지웠다 — 되살리지 말 것.
 *    격자가 예약을 병합 키에 안 섞는지는 `makeup-reservation-wiring.test.ts`가 잠근다.
 */
