import { describe, expect, it } from "vitest";
import { LINE_KEY, claimedKeys, claimedLines, courseOfLine, lineIds, refundTag } from "./refund-keys";

const inv = "11111111-1111-1111-1111-111111111111";
const eng = { kind: "수업", classId: "c1", description: "중등E Jane" };
const math = { kind: "수업", classId: "c2", description: "중2 수학 A" };
const book = { kind: "교재", description: "워크북" };

describe("퇴원보고서 환불 줄 키(리뷰 2026-10-29)", () => {
  it("줄 내용 기준 — 순서가 바뀌거나 줄이 끼어도 같은 줄은 같은 키", () => {
    const [e, m] = lineIds([eng, math]);
    expect(lineIds([math, book, eng])).toEqual([m, lineIds([book])[0], e]);
    expect(LINE_KEY.test(`${inv}#${e}`)).toBe(true);
    expect(LINE_KEY.test(`${inv}#all`)).toBe(true);
    expect(LINE_KEY.test(`${inv}#0;drop`)).toBe(false);
  });
  it("같은 식별값 줄은 차례 번호", () => {
    const [a, b] = lineIds([book, book]);
    expect(b).toBe(`${a}-1`);
  });
  it("표식 읽기 — 줄 표식 · 옛 표식(청구 전체)", () => {
    expect(claimedKeys(refundTag("r", [`${inv}#abc`, `${inv}#d-1`]))).toEqual([`${inv}#abc`, `${inv}#d-1`]);
    expect(claimedKeys(`퇴원보고서 환불 승인 · report:r · invoice:${inv}`)).toEqual([`${inv}#*`]);
    expect(claimedKeys("다른 문서")).toEqual([]);
  });
  it("잡힘 판정 — 그 줄 · 형제 묶음 · 맞지 않으면 청구 전체", () => {
    const ids = lineIds([eng, math, book, book]);
    expect(claimedLines(ids, new Map([[ids[0], "A"]]))).toEqual(["A", null, null, null]);
    // 같은 식별값 형제는 함께(번호 밀림 대비)
    expect(claimedLines(ids, new Map([[ids[3], "B"]]))).toEqual([null, null, "B", "B"]);
    // 옛 표식 · 지금 없는 줄(동기화로 바뀜) · 줄 없던 청구(all) → 전체
    expect(claimedLines(ids, new Map([["*", "C"]]))).toEqual(["C", "C", "C", "C"]);
    expect(claimedLines(ids, new Map([["zzz", "D"]]))).toEqual(["D", "D", "D", "D"]);
    expect(claimedLines(ids, new Map([["all", "E"]]))).toEqual(["E", "E", "E", "E"]);
    expect(claimedLines(ids, undefined)).toEqual([null, null, null, null]);
  });
  it("줄 → 반: 반 이름으로 시작하는 수납명(김덕현 11월) · 가장 긴 이름 · classId 우선", () => {
    const courses = [
      { classId: "m1", className: "중등M 중2 EL3N" },
      { classId: "e1", className: "중등E_중2 심화" },
      { classId: "e0", className: "중등E_중2" },
    ];
    expect(courseOfLine({ description: "중등E_중2 심화 Jane 월수목 16:20-18:10" }, courses)?.classId).toBe("e1");
    expect(courseOfLine({ description: "중등M 중2 EL3N 화금" }, courses)?.classId).toBe("m1");
    expect(courseOfLine({ description: "중등E_중2" }, courses)?.classId).toBe("e0");
    expect(courseOfLine({ description: "중등E_중2심화반" }, courses)).toBeNull();
    expect(courseOfLine({ description: "SRS 프로그램 사용료" }, courses)).toBeNull();
    expect(courseOfLine({ classId: "m1", description: "중등E_중2 심화 Jane" }, courses)?.classId).toBe("m1");
    expect(courseOfLine({ classId: "gone", description: "중등E_중2 심화 Jane" }, courses)?.classId).toBe("e1");
  });
});
