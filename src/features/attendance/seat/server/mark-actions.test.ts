import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * JJ 전용 칸 쓰기는 **출결 행·자리 시수와 분리**돼야 한다.
 * 여기에 attendance_records나 seat_label이 섞이면 담임 정산이 조용히 갈린다.
 */
const src = readFileSync(join(__dirname, "mark-actions.ts"), "utf8");

describe("JJ 전용 칸 쓰기 가드", () => {
  it("class_sheet_student_marks만 쓰고 출결·시수 컬럼은 안 건드린다", () => {
    expect(src).toMatch(/class_sheet_student_marks/);
    expect(src).not.toMatch(/attendance_records/);
    expect(src).not.toMatch(/seat_label\s*:/);
  });

  it("칸이 없는 자리(랩실)에서는 거부한다", () => {
    expect(src).toMatch(/seatHasJjFields/);
  });

  /**
   * 🔵 공개 PIN(비로그인)도 쓴다(2026-08-19) — 화면이 그리는 칸을 서버가 거절하면 "되는 것처럼 보이는데
   * 저장이 안 되는 칸"이 남는다. 대신 보호는 출결 쓰기와 **똑같이** 붙어 있어야 한다.
   */
  it("PIN 쓰기를 열되 게이트·명단 화이트리스트를 그대로 통과시킨다", () => {
    // 게이트(자리·오늘·PIN 쿠키)를 먼저 통과한다.
    expect(src).toMatch(/gateSeatWrite\(input\.seat, input\.date\)/);
    // 명단 밖 학생은 거절 — 로그인 없는 사람이 학원 전체 학생에 닿는 길을 만들지 않는다.
    expect(src).toMatch(/이 교시 명단에 없는 학생입니다/);
    // PIN 경로는 세션이 없어 RLS로 명단을 못 읽는다 → admin + 쿠키 tenantId로 화이트리스트를 만든다.
    expect(src).toMatch(/rosterKeys\([\s\S]{0,120}g\.via === "pin" \? g\.tenantId : null, g\.tenantId\)/);
    // "로그인 출석부에서만" 거절 문구는 사라져야 한다(화면엔 있는데 서버가 거절 = 금지).
    expect(src).not.toMatch(/로그인 출석부에서만/);
  });

  it("admin 클라이언트는 tenant_id를 명시 필터한다(RLS 우회)", () => {
    expect(src).toMatch(/\.eq\("tenant_id", g\.tenantId\)/);
    expect(src).toMatch(/tenant_id: g\.tenantId/);
  });

  it("동시 입력은 upsert로 받는다(select+insert는 unique 충돌)", () => {
    expect(src).toMatch(/\.upsert\(/);
    expect(src).toMatch(/onConflict/);
    expect(src).not.toMatch(/실패했습니다: \$\{/);
  });
});
