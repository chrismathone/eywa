/**
 * 강사 전체 보기 **몫 판정**(저장 쪽) — 화면(월간 매트릭스 `ownsSlot`)과 같은 함수·같은 재료인지 잠근다.
 * 원장 제보 2026-09-11 실례: 중등E_중2 정규 A 9/10(목) = 16:20 자리 JJ · 17:20 Charlie · 18:20 Charlie.
 * 저장 판정은 담임 시작일을 안 쓴다(반응속도 1순위, 2026-09-11) — 그 차이가 **서버가 더 넓게 받는 쪽**으로만 나는지도 잠근다.
 */
import { describe, expect, it } from "vitest";
import {
  buildScopeOwner,
  isScopeClassIds,
  isScopeTeacherId,
  scopeRoleOf,
  scopeTeaches,
  type ScopeClassFacts,
} from "./scope-ownership";
import { ownsAttendanceSlot, type AxisSlot } from "./teacher-axis";
import type { DayTargetRow } from "./scoped-split";

const CLASS = "c-mid2a";
const HOMEROOM = "t-homeroom";
const CHARLIE = "t-charlie";
const D = "2026-09-10"; // 목요일

const thu = (startTime: string, teacherId: string | null, label: string | null = null): AxisSlot => ({
  dayOfWeek: "thu",
  startTime,
  teacherId,
  slotTeacherLabel: label,
  validFrom: "2026-09-01",
  validTo: null,
});
const MID2A: ScopeClassFacts = {
  homeroomTeacherId: HOMEROOM,
  slots: [thu("16:20:00", null, "JJ"), thu("17:20:00", CHARLIE), thu("18:20:00", CHARLIE)],
};
const facts = new Map([[CLASS, MID2A]]);
const row = (slot_start: string | null, seat_label: string | null = null): DayTargetRow => ({
  id: `r-${slot_start}`,
  slot_start,
  seat_label,
});
const ROWS = [
  row("16:20:00"),
  row("17:20:00"),
  row("18:20:00"),
  row(null),
  row("19:40:00", "LAB"),
  row("17:20:00", "  "),
];

describe("buildScopeOwner — 원장 제보 2026-09-11 실례", () => {
  const owns = buildScopeOwner({ teacherId: CHARLIE, facts });

  it("🔴 Charlie 몫 = 17:20·18:20 · 자리 JJ(16:20)는 아무의 몫도 아니다", () => {
    expect(owns(CLASS, D, row("17:20:00"))).toBe(true);
    expect(owns(CLASS, D, row("18:20:00"))).toBe(true);
    expect(owns(CLASS, D, row("16:20:00"))).toBe(false);
  });

  it("교시를 안 남긴 기록(day-level)은 좁히지 않는다 · 자리 라벨 행은 누구 몫도 아니다(화면 규칙 그대로)", () => {
    expect(owns(CLASS, D, row(null))).toBe(true);
    expect(owns(CLASS, D, row("17:20:00", "LAB"))).toBe(false);
  });

  it("재료가 없는 반은 몫이 아닌 것으로 본다", () => {
    expect(owns("c-unknown", D, row(null))).toBe(false);
  });
});

describe("🔴 화면(월간 매트릭스 ownsSlot)과 같은 답 — 같은 입력으로 ownsAttendanceSlot을 부른다", () => {
  it("담임 시작일 근거가 없는 칸(교시 담당 반·근거 없는 담임 반)은 교시·자리·day-level 전부 일치", () => {
    for (const who of [CHARLIE, HOMEROOM]) {
      const owns = buildScopeOwner({ teacherId: who, facts });
      for (const r of ROWS) {
        // server/queries.ts `ownsSlot`과 같은 인자(담임 시작일 = null).
        const view = ownsAttendanceSlot({
          scopeTeacherId: who,
          homeroomTeacherId: HOMEROOM,
          slots: MID2A.slots,
          date: D,
          slotStart: r.slot_start ?? null,
          homeroomSince: null,
          seatLabel: r.seat_label ?? null,
        });
        expect(owns(CLASS, D, r), `${who} ${r.slot_start} ${r.seat_label}`).toBe(view);
      }
    }
  });
});

describe("🔴 담임 시작일은 저장 판정에 없다 — 인계일 이전 칸의 문지기는 격자(반응속도 1순위, 2026-09-11)", () => {
  const MATH = "c-math";
  const mathFacts: ScopeClassFacts = { homeroomTeacherId: HOMEROOM, slots: [thu("16:20:00", null)] };

  it("담임 폴백 반의 인계일 이전 칸도 서버는 몫으로 본다(화면은 빗금 notMine으로 잠근다)", () => {
    const owns = buildScopeOwner({ teacherId: HOMEROOM, facts: new Map([[MATH, mathFacts]]) });
    expect(owns(MATH, "2026-09-03", row(null))).toBe(true);
    expect(owns(MATH, D, row(null))).toBe(true);
  });

  it("🔴 화면이 몫이라 한 행은 서버도 몫이다 — 차이는 서버가 더 넓게 받는 쪽으로만 난다", () => {
    const cases: [string, ScopeClassFacts][] = [
      [CLASS, MID2A],
      [MATH, mathFacts],
    ];
    for (const [classId, f] of cases) {
      for (const who of [CHARLIE, HOMEROOM]) {
        const owns = buildScopeOwner({ teacherId: who, facts: new Map([[classId, f]]) });
        for (const since of [null, "2026-09-01", "2026-09-10", "2026-09-15"]) {
          for (const date of ["2026-09-03", D, "2026-09-17"]) {
            for (const r of ROWS) {
              const view = ownsAttendanceSlot({
                scopeTeacherId: who,
                homeroomTeacherId: f.homeroomTeacherId,
                slots: f.slots,
                date,
                slotStart: r.slot_start ?? null,
                homeroomSince: since,
                seatLabel: r.seat_label ?? null,
              });
              if (view) expect(owns(classId, date, r), `${classId} ${who} ${since} ${date} ${r.slot_start}`).toBe(true);
            }
          }
        }
      }
    }
  });
});

describe("scopeTeaches · scopeRoleOf — page.tsx classTaughtBy와 같은 판정", () => {
  it("그 달 교시 담당·담임은 맡는다 · 모르는 사람·재료 없는 반은 아니다", () => {
    expect(scopeRoleOf(MID2A, CHARLIE, D)).toBe("slot");
    expect(scopeRoleOf(MID2A, HOMEROOM, D)).toBe("homeroom");
    expect(scopeRoleOf({ homeroomTeacherId: CHARLIE, slots: [thu("17:20:00", CHARLIE)] }, CHARLIE, D)).toBe("both");
    expect(scopeTeaches(MID2A, "t-stranger", D)).toBe(false);
    expect(scopeTeaches(undefined, CHARLIE, D)).toBe(false);
  });

  it("그 달에 끝난 교시는 그 달 담당이 아니다 — 월간 출석부와 같은 달 창", () => {
    const ended: ScopeClassFacts = {
      homeroomTeacherId: HOMEROOM,
      slots: [
        {
          dayOfWeek: "thu",
          startTime: "17:20:00",
          teacherId: CHARLIE,
          slotTeacherLabel: null,
          validFrom: "2026-07-01",
          validTo: "2026-08-31",
        },
      ],
    };
    expect(scopeTeaches(ended, CHARLIE, "2026-08-27")).toBe(true);
    expect(scopeTeaches(ended, CHARLIE, D)).toBe(false);
  });
});

describe("isScopeTeacherId", () => {
  it("users.id(uuid)만 받는다", () => {
    expect(isScopeTeacherId("55555555-5555-5555-5555-555555555555")).toBe(true);
    for (const bad of ["", "abc", "55555555-5555-5555-5555-55555555555", "t-charlie", null, 3]) {
      expect(isScopeTeacherId(bad), String(bad)).toBe(false);
    }
  });
});

describe("isScopeClassIds", () => {
  it("uuid 배열만 받는다 — 빈 배열은 '스코프 반 없음'이라 통과", () => {
    const ID = "55555555-5555-5555-5555-555555555555";
    expect(isScopeClassIds([ID])).toBe(true);
    expect(isScopeClassIds([])).toBe(true);
    for (const bad of [ID, "abc", null, 3, new Set([ID]), [ID, "x"], [ID, 3], { 0: ID, length: 1 }]) {
      expect(isScopeClassIds(bad), String(bad)).toBe(false);
    }
  });
});
