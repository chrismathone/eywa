import { describe, expect, it } from "vitest";
import { isAdminSendable } from "./report-filters";

// 관리자 최초 발송 대상 판정 — 서버 하드필터(sendClassnoteForUnsent)와 계약이 같아야 한다.
// 핵심: 발송 이력이 있는 행(어떤 상태든)과 이관분은 절대 대상 아님 = 중복발송·이관 재게시 차단.
describe("isAdminSendable", () => {
  it("미발송 native 행만 발송 가능", () => {
    expect(isAdminSendable({ classnoteStatus: null, source: "onescreen" })).toBe(true);
  });

  it("발송 이력이 있으면 상태 불문 거부(중복발송 방어) — success 포함", () => {
    for (const status of ["queued", "processing", "success", "failed", "too_old", "name_conflict", "blocked_shared"]) {
      expect(isAdminSendable({ classnoteStatus: status, source: "onescreen" })).toBe(false);
    }
  });

  it("이관(edutrix_import)은 미발송이어도 거부 — Edutrix가 이미 학부모에게 발송한 기록", () => {
    expect(isAdminSendable({ classnoteStatus: null, source: "edutrix_import" })).toBe(false);
  });

  it("source 미상(null)은 미발송이면 통과 — 서버 게이트(too_old·과목)가 최종 방어", () => {
    expect(isAdminSendable({ classnoteStatus: null, source: null })).toBe(true);
  });
});
