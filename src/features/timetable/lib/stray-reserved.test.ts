import { describe, expect, it } from "vitest";
import {
  cellKeyWithStrayMark,
  strayAnchorRowIndex,
  strayMarkKey,
  strayOwnerClassKey,
} from "./stray-reserved";

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
describe("보강 박스 — 병합 표식", () => {
  const MS1A = "ms1a-id";
  const MS2A = "ms2a-id";
  const TEACHER = "이수진";
  const marks = new Set([strayMarkKey(TEACHER, "thu", MS1A)]);
  const keyOf = (classKey: string, day: string, set: ReadonlySet<string> = marks) =>
    cellKeyWithStrayMark(classKey, TEACHER, day, set);

  it("예약이 걸린 반은 그 요일만 키가 갈린다 — 월+목 한 칸이 두 칸으로", () => {
    expect(keyOf(MS1A, "thu")).not.toBe(keyOf(MS1A, "mon"));
    expect(keyOf(MS1A, "mon")).toBe(MS1A); // 월요일은 손대지 않는다
  });

  it("🔴 예약이 **없는 다른 반**의 월+목 병합은 그대로다 — 축에 반 키가 빠지면 여기서 깨진다", () => {
    expect(keyOf(MS2A, "thu")).toBe(keyOf(MS2A, "mon"));
    expect(keyOf(MS2A, "thu")).toBe(MS2A);
  });

  it("🔴 같은 (강사·요일·반)은 **교시 행이 달라도** 같은 키 — 세로 병합이 안 깨진다", () => {
    // 격자가 부르는 모양 그대로 미니 격자를 만든다: MS1A가 1-1·1-2 두 행, MS2A가 2-1·2-2 두 행.
    // (행마다 **그 칸의 반 키**를 넘긴다 — 표식 축에 행이 들어가면 앵커 행만 표식을 받아 아래 단언이 깨진다.)
    const GRID: Record<number, string> = { 0: MS1A, 1: MS1A, 2: MS2A, 3: MS2A };
    const keyAt = (row: number, day: string) => cellKeyWithStrayMark(GRID[row]!, TEACHER, day, marks);
    // 세로: 예약이 걸린 MS1A도 두 행의 키가 같다(한 반이 1-1/1-2 두 칸으로 쪼개지지 않는다).
    expect(keyAt(0, "thu")).toBe(keyAt(1, "thu"));
    // 가로: 그 반만 요일이 갈린다.
    expect(keyAt(0, "thu")).not.toBe(keyAt(0, "mon"));
    // 예약 없는 반은 세로·가로 모두 그대로.
    expect(keyAt(2, "thu")).toBe(keyAt(3, "thu"));
    expect(keyAt(2, "thu")).toBe(keyAt(2, "mon"));
  });

  it("월·목 양쪽에 예약이면 서로 다른 키 — 도로 붙지 않는다(붙으면 월요일 칸에 목요일 예약이 보인다)", () => {
    const both = new Set([strayMarkKey(TEACHER, "thu", MS1A), strayMarkKey(TEACHER, "mon", MS1A)]);
    expect(keyOf(MS1A, "thu", both)).not.toBe(keyOf(MS1A, "mon", both));
  });

  it("빈 칸은 표식 없이 그대로 — 없던 병합이 생기지 않는다", () => {
    expect(keyOf("", "thu")).toBe("");
  });

  it("다른 강사 열은 영향 없음", () => {
    expect(cellKeyWithStrayMark(MS1A, "김은정", "thu", marks)).toBe(MS1A);
  });
});

/**
 * 표식을 **붙일 수 있는 칸인가** — 박스를 그리지 못하는 칸이면 쪼개기만 하고 이익이 없다(재리뷰 [중]).
 */
describe("보강 박스 — 표식을 붙일 반", () => {
  it("반이 하나인 칸만 주인이 있다(같은 반이 두 줄이어도 하나)", () => {
    expect(strayOwnerClassKey(["ms1a-id"])).toBe("ms1a-id");
    expect(strayOwnerClassKey(["ms1a-id", "ms1a-id"])).toBe("ms1a-id");
  });

  it("🔴 합반 칸(2반 이상)은 주인이 없다 — 박스를 못 그리는 칸이라 표식도 안 붙는다", () => {
    expect(strayOwnerClassKey(["a-id", "b-id"])).toBeNull();
  });

  it("빈 칸도 주인이 없다(1×1이라 병합이 없다)", () => {
    expect(strayOwnerClassKey([])).toBeNull();
    expect(strayOwnerClassKey([""])).toBeNull();
  });

  it("🔴 합반 칸 키엔 접미사가 안 붙는다 — 월+목 병합이 그대로다", () => {
    const noMarks = new Set<string>(); // 합반이라 표식이 안 들어갔다
    expect(cellKeyWithStrayMark("a-id|b-id", "이수진", "thu", noMarks)).toBe("a-id|b-id");
    expect(cellKeyWithStrayMark("a-id|b-id", "이수진", "thu", noMarks)).toBe(
      cellKeyWithStrayMark("a-id|b-id", "이수진", "mon", noMarks),
    );
  });
});
