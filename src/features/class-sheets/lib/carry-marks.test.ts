import { describe, expect, it } from "vitest";
import { carryRoster, carrySummary, planCarryMarks, type PastMarkRow } from "./carry-marks";

const past = (
  studentId: string,
  markDate: string,
  listeningLevel: string | null,
  memorizedWords: string | null,
  slotStart: string | null = "16:20",
): PastMarkRow => ({ studentId, markDate, slotStart, listeningLevel, memorizedWords });

describe("planCarryMarks(JJ 이어받기)", () => {
  it("빈 칸을 지난 기록의 값으로 채운다", () => {
    const out = planCarryMarks({
      roster: ["s1"],
      past: [past("s1", "2026-08-12", "L3", "1200")],
      target: [],
    });
    expect(out).toEqual([
      {
        studentId: "s1",
        listeningLevel: "L3",
        memorizedWords: "1200",
        filled: ["listeningLevel", "memorizedWords"],
        sourceDate: "2026-08-12",
      },
    ]);
  });

  it("🔴 이미 쓴 칸은 덮어쓰지 않고, 그 값을 그대로 다시 담는다(한 번의 upsert로 보내도 안 지워지게)", () => {
    const out = planCarryMarks({
      roster: ["s1"],
      past: [past("s1", "2026-08-12", "L3", "1200")],
      target: [{ studentId: "s1", listeningLevel: "L5", memorizedWords: null }],
    });
    expect(out[0]).toMatchObject({
      listeningLevel: "L5",
      memorizedWords: "1200",
      filled: ["memorizedWords"],
    });
  });

  it("채울 칸이 하나도 없으면 그 학생은 쓰기 목록에 안 넣는다", () => {
    const out = planCarryMarks({
      roster: ["s1"],
      past: [past("s1", "2026-08-12", "L3", "1200")],
      target: [{ studentId: "s1", listeningLevel: "L5", memorizedWords: "1400" }],
    });
    expect(out).toEqual([]);
  });

  it("칸마다 **따로** 최신값을 찾는다 — 지난 수업에 한쪽만 적혀 있어도 둘 다 채워진다", () => {
    const out = planCarryMarks({
      roster: ["s1"],
      past: [
        past("s1", "2026-08-12", "L4", null), // 최근엔 레벨만
        past("s1", "2026-08-05", "L3", "900"), // 단어수는 그 전 기록에서
      ],
      target: [],
    });
    expect(out[0]).toMatchObject({ listeningLevel: "L4", memorizedWords: "900" });
    // 안내 문구엔 **가장 늦은 날**을 싣는다
    expect(out[0]?.sourceDate).toBe("2026-08-12");
  });

  it("같은 날 JJ가 두 교시면 뒤 교시가 최신이다(#112 — 대표 행을 정렬로 흉내 내지 않는다)", () => {
    const out = planCarryMarks({
      roster: ["s1"],
      past: [
        past("s1", "2026-08-12", "L2", "800", "16:20"),
        past("s1", "2026-08-12", "L6", "1500", "18:20"),
      ],
      target: [],
    });
    expect(out[0]).toMatchObject({ listeningLevel: "L6", memorizedWords: "1500" });
  });

  it("공백만 있는 칸은 빈 칸으로 본다(원본도 대상도)", () => {
    const out = planCarryMarks({
      roster: ["s1"],
      past: [past("s1", "2026-08-12", "   ", "1200"), past("s1", "2026-08-05", "L1", null)],
      target: [{ studentId: "s1", listeningLevel: " ", memorizedWords: null }],
    });
    expect(out[0]).toMatchObject({ listeningLevel: "L1", memorizedWords: "1200" });
  });

  it("🔴 명단 밖 학생에겐 행을 만들지 않는다(빈 행이 남으면 명단·각주 건수에 잡힌다)", () => {
    const out = planCarryMarks({
      roster: ["s1"],
      past: [past("s1", "2026-08-12", "L3", null), past("s9", "2026-08-12", "L9", "9999")],
      target: [],
    });
    expect(out.map((p) => p.studentId)).toEqual(["s1"]);
  });

  it("지난 기록이 없는 학생은 건너뛴다", () => {
    expect(planCarryMarks({ roster: ["s1", "s2"], past: [past("s2", "2026-08-12", "L3", null)], target: [] }))
      .toHaveLength(1);
  });

  it("값을 저장한 뒤에도 멱등 — 두 번째 호출은 채울 게 없다", () => {
    const first = planCarryMarks({
      roster: ["s1"],
      past: [past("s1", "2026-08-12", "L3", "1200")],
      target: [],
    });
    const second = planCarryMarks({
      roster: ["s1"],
      past: [past("s1", "2026-08-12", "L3", "1200")],
      target: first.map((p) => ({
        studentId: p.studentId,
        listeningLevel: p.listeningLevel,
        memorizedWords: p.memorizedWords,
      })),
    });
    expect(second).toEqual([]);
  });
});

describe("carryRoster(이어받기 명단)", () => {
  const slotStart = "16:20";

  it("수강 자격 학생을 그대로 담는다(출결 기록이 아직 없어도)", () => {
    expect(carryRoster({ eligible: ["s1", "s2"], attendance: [], slotStart }).sort()).toEqual(["s1", "s2"]);
  });

  it("보강(수업외) — 수강행은 없지만 그날 기록이 있으면 명단에 넣는다", () => {
    const out = carryRoster({
      eligible: ["s1"],
      attendance: [{ studentId: "s9", slotStart, status: "present" }],
      slotStart,
    });
    expect(out.sort()).toEqual(["s1", "s9"]);
  });

  it("🔴 그 칸에 결석으로 찍힌 학생은 뺀다(오지 않은 아이 칸에 값을 적지 않는다)", () => {
    const out = carryRoster({
      eligible: ["s1", "s2"],
      attendance: [{ studentId: "s2", slotStart, status: "absent" }],
      slotStart,
    });
    expect(out).toEqual(["s1"]);
  });

  it("인정결석(excused)도 뺀다 · 지각·조퇴는 수업에 있었으므로 남긴다", () => {
    const out = carryRoster({
      eligible: ["s1", "s2", "s3", "s4"],
      attendance: [
        { studentId: "s2", slotStart, status: "excused" },
        { studentId: "s3", slotStart, status: "late" },
        { studentId: "s4", slotStart, status: "early_leave" },
      ],
      slotStart,
    });
    expect(out.sort()).toEqual(["s1", "s3", "s4"]);
  });

  it("다른 교시 결석은 이 칸을 막지 않는다(4교시 결석 ≠ 6교시 결석)", () => {
    const out = carryRoster({
      eligible: ["s1"],
      attendance: [{ studentId: "s1", slotStart: "18:20", status: "absent" }],
      slotStart,
    });
    expect(out).toEqual(["s1"]);
  });

  it("교시 없는 옛 기록(그날 전체)의 결석은 이 칸도 막는다", () => {
    const out = carryRoster({
      eligible: ["s1"],
      attendance: [{ studentId: "s1", slotStart: null, status: "absent" }],
      slotStart,
    });
    expect(out).toEqual([]);
  });

  it("⚠️ 출결을 아직 안 찍은 칸은 빼지 않는다(모름 ≠ 결석)", () => {
    expect(carryRoster({ eligible: ["s1"], attendance: [], slotStart })).toEqual(["s1"]);
  });
});

describe("carrySummary", () => {
  it("채운 칸만 폼 머리와 같은 낱말로 센다", () => {
    const patches = planCarryMarks({
      roster: ["s1", "s2"],
      past: [past("s1", "2026-08-12", "L3", "1200"), past("s2", "2026-08-12", "L4", null)],
      target: [],
    });
    expect(carrySummary(patches)).toBe("듣기 레벨 2명 · 누적 암기 단어수 1명");
  });

  it("빈 목록은 빈 문자열", () => {
    expect(carrySummary([])).toBe("");
  });
});
