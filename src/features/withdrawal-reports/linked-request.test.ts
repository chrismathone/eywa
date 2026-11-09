import { describe, expect, it } from "vitest";
import {
  LINKED_CLEAR_DIRECTOR_ONLY, LINKED_DELETE_COMPLETED, canEditLinkedCompletion, linkedCapError, linkedCompletionLock, linkedDeleteLock, linkedEditLock, parseWon,
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
  it("총 환불금액 숫자 = 숫자 글자만(DB withdrawal_refund_won과 같다) · 비면 0 · 15자리까지", () => {
    expect(parseWon("315,000원")).toBe(315000);
    expect(parseWon("")).toBe(0);
    expect(parseWon("삼십만 원")).toBe(0);
    expect(parseWon("315,000원(교재 30,000원 제외)")).toBe(31500030000);   // 숫자 두 번 → 이어 붙어 커진다(상한에 걸리는 쪽)
    expect(parseWon("1".repeat(20))).toBe(Number("1".repeat(15)));
  });
  it("🔴 상한 — 넘으면 거절 · 금액 칸이 안 바뀌면 보지 않음 · 결제내역만 바꿔도 본다(DB와 같이) · 모르면 금액 칸 변경만 거절", () => {
    const prev = { totalAmount: "100,000원", paymentDetails: "결제" };
    expect(linkedCapError(100000, prev, { totalAmount: "100,000원", paymentDetails: "결제" })).toBeNull();
    expect(linkedCapError(100000, prev, { totalAmount: "90,000원", paymentDetails: "결제" })).toBeNull();
    expect(linkedCapError(100000, prev, { totalAmount: "100,001원", paymentDetails: "결제" })).toContain("상한");
    // 이미 넘은 금액(옛 앱이 쓴 값)이면 결제내역만 고쳐도 막힌다 — DB가 같은 조건으로 막는다
    expect(linkedCapError(50000, prev, { totalAmount: "100,000원", paymentDetails: "고친 결제" })).toContain("상한");
    expect(linkedCapError(50000, prev, { totalAmount: "100,000원", paymentDetails: "결제" })).toBeNull();
    expect(linkedCapError(null, prev, { totalAmount: "100,000원", paymentDetails: "결제" })).toBeNull();
    expect(linkedCapError(null, prev, { totalAmount: "1원", paymentDetails: "결제" })).toContain("알 수 없어");
    expect(linkedCapError(null, prev, { totalAmount: "100,000원", paymentDetails: "고침" })).toContain("알 수 없어");
    expect(linkedCapError(100000, null, { totalAmount: "100,000원", paymentDetails: "" })).toBeNull();
  });
});
