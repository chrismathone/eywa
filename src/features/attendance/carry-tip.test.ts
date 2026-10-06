import { describe, expect, it } from "vitest";
import { decodeTip, encodeTip } from "@/components/hover-tip/tip";
import { carryTipCard } from "./carry-tip";
import type { AttendanceCarryMark } from "./class-billing";

const card = (mark: AttendanceCarryMark, notes: (string | null)[] = [], lang: "ko" | "en" = "ko") =>
  decodeTip(encodeTip(carryTipCard(mark, "U", lang, notes)))!;

describe("출석부 이월 표식 카드 (원장 2026-10-06)", () => {
  it("받은 이월 — 어느 달에서 몇 회차·얼마인지 적는다", () => {
    const tip = card({ ins: [{ amount: 25000, period: "2026-08", units: 2 }], inState: "applied", out: null });
    // 제목은 회차 확정 화면과 같은 말 — 회차(시수) 이월이라는 다른 물건이 있다.
    expect(tip.title).toBe("금액 이월");
    expect(tip.rows).toEqual([["8월에서 받음", "2.0 U · 25,000원"]]);
    // 실린 이월엔 '아직 안 실렸다'를 적지 않는다. 회차가 나눈 값이라는 설명만 남는다.
    expect(tip.lines).toHaveLength(1);
    expect(tip.lines[0]).toContain("확정 단가로 나눈 값");
  });

  it("🔴 청구액에 아직 안 실린 받은 이월은 그 이유와 할 일을 적는다", () => {
    const tip = card({ ins: [{ amount: 25000, period: "2026-08", units: 2 }], inState: "pending", out: null });
    expect(tip.lines[0]).toContain("아직 청구액에 실리지 않았습니다");
    expect(tip.lines[0]).toContain("수납 배분을 저장");
  });

  it("🔴 받는 줄이 환불이면 '배분을 저장하면 실린다'고 하지 않는다 — 할 일이 다르다", () => {
    const tip = card({ ins: [{ amount: 25000, period: "2026-08", units: 2 }], inState: "refunded", out: null });
    expect(tip.lines[0]).toContain("환불 처리돼 이월을 싣지 않았습니다");
    expect(tip.lines.join(" ")).not.toContain("수납 배분을 저장하면");
  });

  it("보낸 이월 — 가는 달과 함께. 보낸 것만 있는 줄엔 '안 실렸다' 문구가 없다", () => {
    const tip = card({ ins: [], inState: "pending", out: { amount: 25000, period: "2026-09", units: 2 } });
    expect(tip.rows).toEqual([["9월로 보냄", "2.0 U · 25,000원"]]);
    expect(tip.lines.join(" ")).not.toContain("실리지 않았습니다");
  });

  it("0.1 단위로 안 떨어지는 회차는 '약', 회차를 못 구하면 금액만 — 회차를 지어내지 않는다", () => {
    const approx = card({ ins: [{ amount: 10000, period: "2026-08", units: 10000 / 24000 }], inState: "applied", out: null });
    expect(approx.rows[0]![1]).toBe("약 0.4 U · 10,000원");
    const amountOnly = card({ ins: [{ amount: 10000, period: "2026-08", units: null }], inState: "applied", out: null });
    expect(amountOnly.rows).toEqual([["8월에서 받음", "10,000원"]]);
    // 회차를 적지 않은 카드엔 나눈 값 설명도 없다 — 줄이 하나도 없어도 카드는 뜬다(라벨 줄이 있다).
    expect(amountOnly.lines).toEqual([]);
    // 0.1 단위로 반올림하면 0이 되는 작은 금액은 '약 0.0'이라 적지 않는다 — 금액만.
    const tiny = card({ ins: [{ amount: 500, period: "2026-08", units: 500 / 24000 }], inState: "applied", out: null });
    expect(tiny.rows).toEqual([["8월에서 받음", "500원"]]);
    expect(tiny.lines).toEqual([]);
  });

  it("달을 모르면 지어내지 않는다 · 칸이 원래 띄우던 설명은 카드 줄로 옮겨 싣는다", () => {
    const tip = card({ ins: [{ amount: 5000, period: "", units: null }], inState: "applied", out: { amount: 5000, period: "", units: null } }, ["반 전체 등록 26.0 U 중 이 선생님 담당 21.0 U", null]);
    expect(tip.rows.map((r) => r[0])).toEqual(["지난 달에서 받음", "다음 달로 보냄"]);
    expect(tip.lines).toEqual(["반 전체 등록 26.0 U 중 이 선생님 담당 21.0 U"]);
  });

  it("영어 화면 — 달 이름과 문구가 번역된다(한글이 새지 않는다)", () => {
    const tip = card({ ins: [{ amount: 25000, period: "2026-08", units: 2 }], inState: "pending", out: { amount: 12500, period: "2026-10", units: 1 } }, [], "en");
    expect(tip.title).toBe("Carry-over");
    expect(tip.rows).toEqual([["From August 2026", "2.0 U · ₩25,000"], ["To October 2026", "1.0 U · ₩12,500"]]);
    expect([tip.title, ...tip.rows.flat(), ...tip.lines].join(" ")).not.toMatch(/[가-힣]/);
  });
});
