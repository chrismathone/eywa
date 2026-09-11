/**
 * 9월 소급 보정 스크립트(`scripts/_oneoff/backfill-math-auto-units.mjs`)의 **판정**(순수) — 적대 리뷰 2026-09-11.
 *   · 보강 칸은 기본 제외(확인창에서 시수를 보고 고른 기록이라 null=1이 명시일 수 있다 — 오늘 앱도 1로 남긴다)
 *   · `--apply`엔 기준 시각이 필수(배포 뒤 강사가 명시로 친 1 = DB에선 기본 1과 같은 null을 덮지 않게)
 *   · 칸 판정(교시별 행 섞임·이미 시수·자리 행·기준 시각 뒤) — 드라이런 목록과 적용이 같은 함수를 쓴다
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as rules from "../../../scripts/_oneoff/math-auto-units-rules.mjs";

describe("스크립트 배선 — 판정 함수를 실제로 쓴다(스크립트는 DB가 필요해 여기선 소스로 본다)", () => {
  const SCRIPT = readFileSync(join(process.cwd(), "scripts/_oneoff/backfill-math-auto-units.mjs"), "utf8");
  it("🔴 적용 전제(기준 시각)는 DB에 붙기 **전에** 본다", () => {
    const guardAt = SCRIPT.indexOf("const guard = backfillApplyError({ apply: APPLY, recordedBefore });");
    expect(guardAt).toBeGreaterThan(-1);
    expect(guardAt).toBeLessThan(SCRIPT.indexOf("postgres(process.env.DATABASE_URL"));
    expect(SCRIPT).toMatch(/if \(guard\) \{\s*console\.error\(guard\);\s*process\.exit\(1\);/);
  });
  it("🔴 보강 제외·기준 시각이 목록과 UPDATE까지 같은 값으로 간다", () => {
    expect(SCRIPT).toContain('const INCLUDE_MAKEUP = process.argv.includes("--include-makeup");');
    expect(SCRIPT).toContain("pickBackfillCandidates(rows, { recordedBefore })");
    expect(SCRIPT).toContain("partitionBackfillItems(withUnits, { includeMakeup: INCLUDE_MAKEUP })");
    expect(SCRIPT).toContain("backfillStatuses({ includeMakeup: INCLUDE_MAKEUP })");
    expect(SCRIPT).toMatch(/and recorded_at < \$\{recordedBefore\}/);
  });
});

const row = (over: Record<string, unknown> = {}) => ({
  id: "r1",
  student_id: "s1",
  class_id: "c1",
  session_date: "2026-09-10",
  slot_start: null as string | null,
  status: "present",
  session_units: null as unknown,
  seat_label: null as string | null,
  recorded_at: new Date("2026-09-10T08:00:00Z") as unknown,
  ...over,
});

describe("backfillStatuses — 보강은 기본 제외", () => {
  it("🔴 기본 = 출석·지각·조퇴 · --include-makeup이면 보강까지", () => {
    expect([...rules.backfillStatuses()].sort()).toEqual(["early_leave", "late", "present"]);
    expect([...rules.backfillStatuses({ includeMakeup: true })].sort()).toEqual([...rules.COUNTABLE_STATUSES].sort());
  });
});

describe("partitionBackfillItems — 바꿀 칸 / 보강이라 뺀 칸", () => {
  const items = [
    { id: "a", status: "present" },
    { id: "b", status: "makeup" },
    { id: "c", status: "late" },
  ];
  it("🔴 기본은 보강 칸을 적용 목록에서 뺀다(보고서에 따로)", () => {
    const got = rules.partitionBackfillItems(items);
    expect(got.apply.map((i) => i.id)).toEqual(["a", "c"]);
    expect(got.excluded.map((i) => i.id)).toEqual(["b"]);
  });
  it("원장이 넣기로 하면(--include-makeup) 전부", () => {
    const got = rules.partitionBackfillItems(items, { includeMakeup: true });
    expect(got.apply.map((i) => i.id)).toEqual(["a", "b", "c"]);
    expect(got.excluded).toEqual([]);
  });
});

describe("backfillApplyError — --apply엔 기준 시각 필수", () => {
  it("🔴 적용인데 기준 시각이 없으면 멈춘다", () => {
    expect(rules.backfillApplyError({ apply: true, recordedBefore: null })).toMatch(/--recorded-before/);
  });
  it("드라이런은 기준 시각 없이도 된다 · 적용 + 기준 시각이면 진행", () => {
    expect(rules.backfillApplyError({ apply: false, recordedBefore: null })).toBeNull();
    expect(rules.backfillApplyError({ apply: true, recordedBefore: new Date("2026-09-11T06:00:00Z") })).toBeNull();
  });
});

describe("pickBackfillCandidates — 칸 판정", () => {
  it("교시 없는 '그날 전체' 행 + 소비 상태 + 시수 없음만 후보 — 보강도 여기선 후보(뺄지는 partition이 정한다)", () => {
    const { cands, skip, scanned } = rules.pickBackfillCandidates([
      row(),
      row({ student_id: "s2", status: "makeup" }),
      row({ student_id: "s3", status: "absent" }),
      row({ student_id: "s4", session_units: "1.5" }),
      row({ student_id: "s5", seat_label: "JJ" }),
      // 같은 칸에 교시별 행이 섞였다 — 그날 전체 행에 얹으면 이중 계상.
      row({ student_id: "s6" }),
      row({ student_id: "s6", slot_start: "16:20:00" }),
      // 교시별 행만 있는 칸(자리) — 대상 밖, 사유로도 안 센다.
      row({ student_id: "s7", slot_start: "18:00:00" }),
    ]);
    expect(cands.map((r) => r.student_id)).toEqual(["s1", "s2"]);
    expect(skip).toEqual({ mixed: 1, notCountable: 1, alreadySet: 1, seat: 1, recordedAfter: 0 });
    expect(scanned).toBe(7);
  });

  it("🔴 기준 시각 뒤에 손댄 행은 뺀다 — 배포 뒤 강사가 명시로 친 1일 수 있다", () => {
    const cutoff = new Date("2026-09-11T06:00:00Z");
    const { cands, skip } = rules.pickBackfillCandidates(
      [row({ recorded_at: new Date("2026-09-11T05:59:59Z") }), row({ student_id: "s2", recorded_at: cutoff })],
      { recordedBefore: cutoff },
    );
    expect(cands.map((r) => r.student_id)).toEqual(["s1"]);
    expect(skip.recordedAfter).toBe(1);
  });
});
