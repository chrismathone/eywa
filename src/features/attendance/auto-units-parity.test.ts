/**
 * 수학 자동 시수 — 앱 규칙(TS)과 소급 보정 스크립트 규칙(.mjs) **패리티**.
 *
 * `scripts/_oneoff/backfill-math-auto-units.mjs`는 plain .mjs라 TS 규칙을 못 읽어 `math-auto-units-rules.mjs`에
 * 같은 식을 따로 든다. 두 벌이 갈리면 "앱은 1.5를 넣는데 보정은 2를 넣는" 돈 사고가 된다 — 여기서 잠근다
 * (선례: 재고 가져오기 `inventory-import-rules.mjs` ↔ `inventory-wiring.test.ts`).
 * ⚠️ 이 테스트가 깨지면 **두 파일을 함께** 고칠 것(한쪽만 고치면 다시 갈린다).
 */
import { describe, expect, it } from "vitest";
import * as rules from "../../../scripts/_oneoff/math-auto-units-rules.mjs";
import { AUTO_UNITS_SUBJECTS, autoUnitsOn, unitsFromMinutes, type AutoUnitsSchedule } from "./auto-units";
import { COUNTABLE_STATUSES, MAX_SESSION_UNITS } from "./session-units";
import { SPECIAL_SLOT_ALIAS_KEYS, specialSlotLabel } from "@/features/timetable/lib/teacher-label";
import { dowKeyOf } from "@/features/class-sheets/lib/week";

describe("자동 시수 규칙 — TS ↔ 스크립트(.mjs) 두 벌이 같은 답", () => {
  it("상수(과목·소비 상태·상한)가 같다", () => {
    expect([...rules.AUTO_UNITS_SUBJECTS].sort()).toEqual([...AUTO_UNITS_SUBJECTS].sort());
    expect([...rules.COUNTABLE_STATUSES].sort()).toEqual([...COUNTABLE_STATUSES].sort());
    expect(rules.MAX_SESSION_UNITS).toBe(MAX_SESSION_UNITS);
  });

  it("분 → 시수 식이 0~2,500분 전 구간에서 같다", () => {
    for (let m = -5; m <= 2500; m++) expect(rules.unitsFromMinutes(m), String(m)).toBe(unitsFromMinutes(m));
    expect(rules.unitsFromMinutes(Number.NaN)).toBe(unitsFromMinutes(Number.NaN));
  });

  it("🔴 자리 별칭 표가 같다 — TS 표에 별칭을 더하면 여기서 깨진다", () => {
    expect([...rules.SPECIAL_SLOT_ALIASES].sort()).toEqual([...SPECIAL_SLOT_ALIAS_KEYS].sort());
    for (const k of SPECIAL_SLOT_ALIAS_KEYS) {
      for (const v of [k, k.toUpperCase(), ` ${k} `]) {
        expect(rules.isSpecialLabel(v), v).toBe(specialSlotLabel(v) != null);
      }
    }
    for (const v of ["Yoojin", "이성우", "", null, undefined, "LABS", "jj2"]) {
      expect(rules.isSpecialLabel(v), String(v)).toBe(specialSlotLabel(v) != null);
    }
  });

  it("요일 판정이 같다", () => {
    for (let d = 1; d <= 30; d++) {
      const ymd = `2026-09-${String(d).padStart(2, "0")}`;
      expect(rules.dowKeyOf(ymd), ymd).toBe(dowKeyOf(ymd));
    }
  });

  it("배치 → 자동 시수가 여러 모양에서 같다(자리·중복 시각·유효구간·HH:MM:SS)", () => {
    const s = (
      dow: AutoUnitsSchedule["dayOfWeek"],
      start: string,
      end: string,
      over: Partial<AutoUnitsSchedule> = {},
    ): AutoUnitsSchedule => ({
      dayOfWeek: dow,
      startTime: start,
      endTime: end,
      validFrom: "2026-08-01",
      validTo: null,
      slotTeacherLabel: null,
      ...over,
    });
    const fixtures: AutoUnitsSchedule[][] = [
      [s("thu", "16:00:00", "16:55:00"), s("thu", "17:00:00", "17:55:00"), s("thu", "18:00:00", "18:55:00")],
      [s("wed", "15:00", "17:00"), s("wed", "17:00", "18:00")],
      [s("mon", "14:00", "16:00"), s("mon", "16:00", "18:00")],
      [s("thu", "16:00", "17:00"), s("thu", "17:00", "18:00"), s("thu", "18:00", "19:00", { slotTeacherLabel: "이주희" })],
      [s("thu", "16:00", "17:00"), s("thu", "16:00", "17:00"), s("thu", "17:00", "18:00")],
      [s("thu", "16:00", "18:00", { validTo: "2026-09-09" }), s("thu", "16:00", "19:00", { validFrom: "2026-09-10" })],
      [s("thu", "18:00", "17:00")],
      [s("sat", "09:00", "12:00"), s("sat", "13:00", "14:00", { slotTeacherLabel: "JJ" })],
      [],
    ];
    for (const [i, rows] of fixtures.entries()) {
      for (let d = 1; d <= 30; d++) {
        const ymd = `2026-09-${String(d).padStart(2, "0")}`;
        expect(rules.autoUnitsOn(ymd, rows), `fixture ${i} ${ymd}`).toBe(autoUnitsOn(ymd, rows));
      }
    }
  });
});
