import { describe, expect, it } from "vitest";
import {
  clampMemoSize,
  formatMemoStamp,
  isCellMemoSubject,
  isMondayYmd,
  isYmd,
  MEMO_BOX,
  memoDateOf,
  memoPlaceLabel,
  memosInRange,
  normalizeMemoBody,
  primaryMemo,
  weekRange,
  type CellMemo,
} from "./rules";

const memo = (over: Partial<CellMemo>): CellMemo => ({
  id: "m1", date: "2026-10-22", col: "김태건", startMin: 980, body: "메모", width: null, height: null,
  version: 1, updatedAt: "2026-10-22T09:40:00.000Z", updatedByName: "박소선", ...over,
});

describe("칸 메모 표시 형식 — `yy.mm.dd hh:mm 이름`(원장 지정)", () => {
  it("KST로 그린다 — UTC 09:40은 18:40", () => {
    expect(formatMemoStamp("2026-10-22T09:40:00.000Z", "박소선")).toBe("26.10.22 18:40 박소선");
  });
  it("자정을 넘는 UTC 15시는 다음 날 0시(날짜도 KST)", () => {
    expect(formatMemoStamp("2026-10-22T15:05:00.000Z", "김태건")).toBe("26.10.23 00:05 김태건");
  });
  it("이름이 없으면 시각만 · 시각이 없거나 깨졌으면 빈 줄", () => {
    expect(formatMemoStamp("2026-01-02T00:00:00.000Z", null)).toBe("26.01.02 09:00");
    expect(formatMemoStamp(null, "박소선")).toBe("");
    expect(formatMemoStamp("not-a-date", "박소선")).toBe("");
  });
});

describe("날짜 칸 — 메모는 그 날짜에만(원장 '그 날짜 칸에만')", () => {
  it("주(월요일) + 요일 = 그 칸의 날짜 · 그 주 범위는 월~일 7일", () => {
    expect(memoDateOf("2026-10-19", "thu")).toBe("2026-10-22");
    expect(memoDateOf("2026-12-28", "sun")).toBe("2027-01-03");
    expect(weekRange("2026-10-19")).toEqual({ from: "2026-10-19", to: "2026-10-25" });
  });
  it("주 열쇠는 월요일만 · 없는 날짜는 거절", () => {
    expect(isMondayYmd("2026-10-19")).toBe(true);
    expect(isMondayYmd("2026-10-22")).toBe(false);
    expect(isYmd("2026-02-30")).toBe(false);
    expect(isYmd("2026-10-22")).toBe(true);
  });
  it("영어만", () => {
    expect(isCellMemoSubject("english")).toBe(true);
    expect(isCellMemoSubject("math")).toBe(false);
  });
  it("감사로그 대상 문구 = 10/22(목) 16:20 김태건", () => {
    expect(memoPlaceLabel("2026-10-22", 980, "김태건")).toBe("10/22(목) 16:20 김태건");
  });
});

describe("행 간격이 바뀌어도 메모는 그 시각을 품은 칸에", () => {
  const list = [memo({ id: "a", startMin: 980 }), memo({ id: "b", startMin: 960 }), memo({ id: "c", date: "2026-10-29", startMin: 980 })];
  it("10분 칸 = 그 시각 메모 하나 · 30분 칸(16:00~16:30) = 16:00·16:20 둘 다(시각순)", () => {
    expect(memosInRange(list, "김태건", "2026-10-22", 980, 990).map((m) => m.id)).toEqual(["a"]);
    expect(memosInRange(list, "김태건", "2026-10-22", 960, 990).map((m) => m.id)).toEqual(["b", "a"]);
  });
  it("🔴 다른 날짜·다른 강사 열의 메모는 섞이지 않는다(주를 넘겨도 빈 칸)", () => {
    expect(memosInRange(list, "김태건", "2026-10-29", 960, 990).map((m) => m.id)).toEqual(["c"]);
    expect(memosInRange(list, "이현이", "2026-10-22", 960, 990)).toEqual([]);
  });
  it("편집 대상 = 칸 열쇠 시각과 같은 메모, 없으면 가장 이른 것", () => {
    const both = memosInRange(list, "김태건", "2026-10-22", 960, 990);
    expect(primaryMemo(both, 980)?.id).toBe("a");
    expect(primaryMemo(both, 970)?.id).toBe("b");
    expect(primaryMemo([], 970)).toBeNull();
  });
});

describe("본문·크기 저장 규칙", () => {
  it("공백뿐이면 빈 메모(=지우기 대상) · 줄바꿈은 \\n으로 · 상한 넘으면 too_long", () => {
    expect(normalizeMemoBody("  \n ")).toBeNull();
    expect(normalizeMemoBody("a\r\nb")).toBe("a\nb");
    expect(normalizeMemoBody("가".repeat(2001))).toBe("too_long");
    expect(normalizeMemoBody(42)).toBeNull();
  });
  it("크기는 저장 범위로 자르고 없으면 기본", () => {
    expect(clampMemoSize(null, undefined)).toEqual({ width: MEMO_BOX.defaultW, height: MEMO_BOX.defaultH });
    expect(clampMemoSize(10, 9999)).toEqual({ width: MEMO_BOX.minW, height: MEMO_BOX.maxH });
    expect(clampMemoSize(300.4, 150.6)).toEqual({ width: 300, height: 151 });
  });
});
