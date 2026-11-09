import { describe, expect, it } from "vitest";
import {
  LINKED_CLEAR_DIRECTOR_ONLY, LINKED_DELETE_COMPLETED, amountTokens, canEditLinkedCompletion, completionDateOk, linkedCapError, linkedCompletionLock, linkedDeleteLock, linkedEditLock, parseWon,
} from "./linked-request";

/** 이어진 환불 요청서의 잠금·상한(리뷰 r2 I6·B1 · 원장 2026-11-09) — DB 트리거 `withdrawal_report_refund_complete_guard`와 같은 규칙. */
const desk = { id: "desk", directorLevel: false };
const other = { id: "other", directorLevel: false };
const boss = { id: "boss", directorLevel: true };
const link = { deskId: "desk", deskName: "데스크", deskActive: true };

describe("이어진 환불 요청서 잠금·상한", () => {
  it("고치기 = 재직 데스크·원장급(행위자·실제 계정 둘 다) · 퇴사한 데스크는 못 한다 · 이어지지 않은 요청서는 종전대로", () => {
    expect(linkedEditLock(link, desk, desk)).toBeNull();
    expect(linkedEditLock(link, boss, boss)).toBeNull();
    expect(linkedEditLock(link, other, other)).toContain("고치는 것은 담당 데스크(데스크)와 원장만");
    expect(linkedEditLock(link, desk, other)).toContain("'다른 강사 뷰'로 보고 있습니다");
    expect(linkedEditLock({ ...link, deskActive: false }, desk, desk)).not.toBeNull();
    // 리뷰 r3 R2-m7 — 퇴사한 데스크 이름을 할 수 있는 사람으로 적지 않는다 · 데스크가 없으면 그 사실 · 원장의 '다른 강사 뷰'면 그 사실(일반 문구 대신)
    expect(linkedEditLock({ ...link, deskActive: false }, other, other)).toContain("고치는 것은 원장만(담당 데스크 퇴사)");
    expect(linkedEditLock({ deskId: null, deskName: null }, other, other)).toContain("고치는 것은 원장만(담당 데스크 없음)");
    expect(linkedEditLock(link, other, boss)).toBe("'다른 강사 뷰'로 보고 있습니다 — 이 요청서 고치기는 본인 화면에서만 할 수 있습니다(지금 보는 사람은 담당 데스크·원장이 아닙니다).");
    expect(linkedCompletionLock(link, other, boss)).toContain("환불완료일자 입력은 본인 화면에서만");
    expect(linkedDeleteLock(link, false, other, boss)).toContain("이 요청서 지우기는 본인 화면에서만");
    expect(linkedCompletionLock(link, other, other)).toBe("퇴원보고서에서 이어진 환불 요청서입니다. 환불완료일자는 담당 데스크(데스크)와 원장만 넣을 수 있고, 비우는 것은 원장만 할 수 있습니다.");
    expect(linkedEditLock(null, other, other)).toBeNull();
    expect(canEditLinkedCompletion({ deskId: null }, desk)).toBe(false);
  });
  it("🔴 완료일자 비우기는 원장급만(담당 데스크도 못 비운다 — D-13) · 넣기는 데스크·원장", () => {
    expect(linkedCompletionLock(link, desk, desk, true)).toBe(LINKED_CLEAR_DIRECTOR_ONLY);
    expect(linkedCompletionLock(link, boss, desk, true)).toBe(LINKED_CLEAR_DIRECTOR_ONLY);   // 실제 계정도 원장이어야
    expect(linkedCompletionLock(link, boss, boss, true)).toBeNull();
    expect(linkedCompletionLock(link, desk, desk)).toBeNull();
    expect(linkedCompletionLock({ ...link, superseded: true }, boss, boss)).toContain("새 요청서로 처리하세요");
  });
  it("🔴 지우기 — 완료된 것은 누구도(원장도) · 미완료는 재직 데스크·원장급", () => {
    expect(linkedDeleteLock(link, true, boss, boss)).toBe(LINKED_DELETE_COMPLETED);
    expect(linkedDeleteLock(link, false, desk, desk)).toBeNull();
    expect(linkedDeleteLock(link, false, boss, boss)).toBeNull();
    expect(linkedDeleteLock(link, false, other, other)).toContain("지우는 것은 담당 데스크(데스크)와 원장만");
    expect(linkedDeleteLock(link, false, desk, other)).not.toBeNull();
    expect(linkedDeleteLock(null, true, other, other)).toBeNull();
  });
  it("🔴 총 환불금액 = 숫자(세 자리 쉼표)와 선택 '원'만(리뷰 r3 R-2 · DB withdrawal_refund_won과 같다) · 비면 0 · 그 밖은 못 읽음(null)", () => {
    expect(parseWon("315,000원")).toBe(315000);
    expect(parseWon(" 315000 ")).toBe(315000);
    expect(parseWon("315,000 원")).toBe(315000);
    expect(parseWon("1,000,000,000,000원")).toBe(1e12);
    expect(parseWon("9".repeat(15))).toBe(Number("9".repeat(15)));
    expect(parseWon("")).toBe(0);
    expect(parseWon("\u3000")).toBe(0);
    // 표기 우회 — 옛 규칙(숫자 글자만)은 300 · 15 · 0으로 읽어 상한을 지나갔다
    for (const t of ["300만원", "1.5백만원", "삼백만 원", "삼십만 원", "3,15,000원", "315,000원(교재 30,000원 제외)", "약 315,000원", "1".repeat(16), "315,000원원", "-315,000원"]) expect(parseWon(t), t).toBeNull();
  });
  it("결제내역 금액 표기 찾기 · 완료일자 꼴(리뷰 r3 R-2·R-9 — DB 트리거와 같은 글자)", () => {
    expect(amountTokens("2026-11 수업 315,000원 · 교재 30,000 원 · 차량 300만원 · 삼백만 원 · 1.5백만원")).toEqual(["315,000원", "30,000 원", "300만원", "삼백만 원", "1.5백만원"]);
    expect(amountTokens("결제 카드 2026-11-02")).toEqual([]);
    expect(completionDateOk("")).toBe(true);
    expect(completionDateOk("2026-11-09")).toBe(true);
    for (const t of ["확인 중", "2026.11.09", "2026-11-9", " 2026-11-09", "11/09"]) expect(completionDateOk(t), t).toBe(false);
  });
  it("🔴 상한 — 넘으면 거절 · 금액 칸이 안 바뀌면 보지 않음 · 결제내역만 바꿔도 본다(DB와 같이) · 모르면 금액 칸 변경만 거절", () => {
    const prev = { totalAmount: "100,000원", paymentDetails: "결제" };
    expect(linkedCapError(100000, prev, { totalAmount: "100,000원", paymentDetails: "결제" })).toBeNull();
    expect(linkedCapError(100000, prev, { totalAmount: "90,000원", paymentDetails: "결제" })).toBeNull();
    expect(linkedCapError(100000, prev, { totalAmount: "100,001원", paymentDetails: "결제" })).toContain("상한");
    // 🔴 표기 우회(리뷰 r3 R-2) — 못 읽는 총 환불금액은 거절
    for (const t of ["300만원", "1.5백만원", "삼백만 원"]) expect(linkedCapError(100000, prev, { totalAmount: t, paymentDetails: "결제" }), t).toBe("총 환불금액은 숫자와 쉼표·'원'만 써 주세요(예: 315,000원).");
    // 총 환불금액이 안 바뀌면 다시 보지 않는다(DB와 같다) — 결제내역은 새로 들어온 금액만 본다
    expect(linkedCapError(50000, prev, { totalAmount: "100,000원", paymentDetails: "고친 결제" })).toBeNull();
    expect(linkedCapError(50000, prev, { totalAmount: "100,000원", paymentDetails: "결제" })).toBeNull();
    // 결제내역 — 못 읽는 금액은 거절 · 새 금액이 상한을 넘으면 거절 · 전에 있던 금액은 그대로 둘 수 있다
    expect(linkedCapError(100000, prev, { totalAmount: "100,000원", paymentDetails: "수업 300만원" })).toContain("결제내역의 금액 300만원은(는) 읽을 수 없습니다");
    expect(linkedCapError(100000, prev, { totalAmount: "100,000원", paymentDetails: "수업 150,000원" })).toContain("보다 큰 금액 150,000원이 새로 들어갔습니다");
    expect(linkedCapError(100000, { totalAmount: "100,000원", paymentDetails: "수업 150,000원" }, { totalAmount: "100,000원", paymentDetails: "수업 150,000원 · 카드" })).toBeNull();
    expect(linkedCapError(100000, prev, { totalAmount: "100,000원", paymentDetails: "수업 100,000원" })).toBeNull();
    expect(linkedCapError(null, prev, { totalAmount: "100,000원", paymentDetails: "결제" })).toBeNull();
    expect(linkedCapError(null, prev, { totalAmount: "1원", paymentDetails: "결제" })).toContain("알 수 없어");
    expect(linkedCapError(null, prev, { totalAmount: "100,000원", paymentDetails: "고침" })).toContain("알 수 없어");
    expect(linkedCapError(100000, null, { totalAmount: "100,000원", paymentDetails: "" })).toBeNull();
  });
});
