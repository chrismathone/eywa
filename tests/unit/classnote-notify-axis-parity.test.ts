import { describe, expect, it } from "vitest";
// 워커(.mjs)는 TS를 못 읽어 앱 규칙의 사본을 든다 — 이 파일이 두 벌을 같은 입력으로 대조한다(앱을 바꾸면 여기가 빨개진다).
import {
  SEAT_ALIAS_KEYS,
  buildHomeroomHistory,
  classTeachersNow,
  homeroomOnDate,
  taughtTeachersOf,
  transitionClassId,
  uniqueClassNameIndex,
} from "../../scripts/_classnote/notify-axis.mjs";
import { classTeacherIdsInRange, resolveTaughtBy, type AxisSlot } from "@/features/attendance/teacher-axis";
import { isDelegationActiveOn } from "@/features/classes/delegation-window";
import {
  buildHomeroomHistoryIndex,
  buildUniqueClassNameIndex,
  homeroomTeacherOnDate,
  resolveTransitionClassId,
  type TeacherTransition,
} from "@/features/classes/teacher-as-of";
import { SPECIAL_SLOT_ALIAS_KEYS } from "@/features/timetable/lib/teacher-label";

const slot = (p: Partial<AxisSlot>): AxisSlot => ({
  dayOfWeek: "mon",
  startTime: "16:20:00",
  teacherId: null,
  slotTeacherLabel: null,
  validFrom: "2026-01-01",
  validTo: null,
  ...p,
});

// 2026-09-28 = 월요일
const CASES: { name: string; homeroom: string | null; slots: AxisSlot[]; date: string; slotStart?: string | null }[] = [
  { name: "시간표 없는 날(보강) → 담임", homeroom: "H", slots: [slot({ dayOfWeek: "tue" })], date: "2026-09-28" },
  { name: "담당 미지정(수학) → 담임", homeroom: "H", slots: [slot({})], date: "2026-09-28" },
  { name: "교시 담당 유일", homeroom: "H", slots: [slot({ teacherId: "S" })], date: "2026-09-28" },
  { name: "자리(LAB)만 → 사람 없음", homeroom: "H", slots: [slot({ slotTeacherLabel: "LAB" })], date: "2026-09-28" },
  { name: "자리 별칭(랩실)", homeroom: "H", slots: [slot({ slotTeacherLabel: " 랩실 " })], date: "2026-09-28" },
  { name: "자리+정규(미지정) → 담임", homeroom: "H", slots: [slot({ slotTeacherLabel: "JJ" }), slot({ startTime: "18:20" })], date: "2026-09-28" },
  { name: "끝난 이력 슬롯은 안 본다", homeroom: "H", slots: [slot({ teacherId: "OLD", validTo: "2026-08-31" })], date: "2026-09-28" },
  { name: "미래 시작 슬롯은 안 본다", homeroom: "H", slots: [slot({ teacherId: "NEW", validFrom: "2026-10-01" })], date: "2026-09-28" },
  { name: "교시 일치만", homeroom: "H", slots: [slot({ teacherId: "A" }), slot({ teacherId: "B", startTime: "18:20" })], date: "2026-09-28", slotStart: "18:20:00" },
  { name: "교시 불일치 → 담임", homeroom: "H", slots: [slot({ teacherId: "A" })], date: "2026-09-28", slotStart: "20:00" },
  { name: "담임 없음", homeroom: null, slots: [], date: "2026-09-28" },
  { name: "날짜 형식 깨짐 → 담임", homeroom: "H", slots: [slot({ teacherId: "A" })], date: "9/28" },
];

describe("taughtTeachersOf ≡ resolveTaughtBy (워커 사본 패리티)", () => {
  for (const c of CASES) {
    it(c.name, () => {
      const app = resolveTaughtBy({ homeroomTeacherId: c.homeroom, slots: c.slots, date: c.date, slotStart: c.slotStart ?? null });
      const mine = taughtTeachersOf({ homeroomTeacherId: c.homeroom, slots: c.slots, date: c.date, slotStart: c.slotStart ?? null });
      expect(mine).toEqual(app.teacherId ? [app.teacherId] : []);
    });
  }

  it("유일한 차이 — 한 교시에 담당이 둘(ambiguous)이면 앱은 비우고 워커는 둘 다(둘 다 가르쳤다)", () => {
    const slots = [slot({ teacherId: "A" }), slot({ teacherId: "B" })];
    expect(resolveTaughtBy({ homeroomTeacherId: "H", slots, date: "2026-09-28" }).source).toBe("ambiguous");
    expect(taughtTeachersOf({ homeroomTeacherId: "H", slots, date: "2026-09-28" }).sort()).toEqual(["A", "B"]);
  });
});

describe("classTeachersNow ≡ classTeacherIdsInRange(오늘) ∪ 오늘 위임", () => {
  const slots = [
    slot({ teacherId: "S1" }),
    slot({ teacherId: "S_OLD", validTo: "2026-08-31" }),
    slot({ teacherId: "S_FUT", validFrom: "2026-10-05" }),
    slot({ slotTeacherLabel: "LAB" }),
    slot({ dayOfWeek: "fri", teacherId: "S2" }), // 요일 무관 — 지금 유효한 배치면 부담임
  ];
  const delegations = [
    { delegateUserId: "D1", fromDate: "2026-09-28", toDate: "2026-09-30", revokedAt: null },
    { delegateUserId: "D2", fromDate: "2026-09-01", toDate: "2026-09-05", revokedAt: null },
    { delegateUserId: "D3", fromDate: "2026-09-28", toDate: "2026-09-30", revokedAt: "2026-09-28T01:00:00Z" },
  ];
  it("같은 사람들", () => {
    const today = "2026-09-29";
    const app = new Set([
      ...classTeacherIdsInRange({ homeroomTeacherId: "H", slots, from: today, to: today }),
      ...delegations.filter((d) => isDelegationActiveOn(d, today)).map((d) => d.delegateUserId),
    ]);
    expect(new Set(classTeachersNow({ homeroomTeacherId: "H", slots, delegations, today }))).toEqual(app);
    expect(app).toEqual(new Set(["H", "S1", "S2", "D1"]));
  });
});

describe("담임 이력 사본 ≡ teacher-as-of", () => {
  const transitions: TeacherTransition[] = [
    { classId: "C1", date: "2026-08-04", teacherName: null, teacherId: "B", previousTeacherId: "A" },
    { classId: "C1", date: "2026-09-02", teacherName: null, teacherId: "C" },
    { classId: "C1", date: "2026-09-02", teacherName: null, teacherId: "D" }, // 같은 날 재변경
    { classId: "C2", date: "2026-08-10", teacherName: null, teacherId: "X" }, // 이전 담임 모름
    { classId: "", date: "2026-08-10", teacherName: null, teacherId: "Z" }, // 반 모름 → 버림
  ];
  const app = buildHomeroomHistoryIndex(transitions);
  const mine = buildHomeroomHistory(transitions);
  it("구간이 같다", () => expect([...mine.entries()]).toEqual([...app.entries()]));
  const probes: [string, string | null, string][] = [
    ["C1", "D", "2026-07-01"],
    ["C1", "D", "2026-08-04"],
    ["C1", "D", "2026-09-01"],
    ["C1", "D", "2026-09-02"],
    ["C1", "Q", "2026-09-20"], // 마지막 로그와 현재 담임이 어긋나면 현재 값
    ["C2", "X", "2026-05-08"], // 첫 전이 전 + 이전 담임 모름 → null
    ["C2", "X", "2026-08-10"],
    ["C3", "H", "2026-05-08"], // 이력 없음 → 현재 담임
  ];
  for (const [cls, cur, date] of probes) {
    it(`${cls} ${date}`, () => {
      expect(homeroomOnDate(mine.get(cls), cur, date)).toBe(homeroomTeacherOnDate(app.get(cls), cur, date));
    });
  }
});

describe("감사로그 반 해석 사본 ≡ teacher-as-of", () => {
  const rows = [
    { id: "c1", name: "중등M 중3 BS3Q" },
    { id: "c2", name: "겹치는 반" },
    { id: "c3", name: "겹치는 반" },
    { id: "c4", name: "  " },
  ];
  const app = buildUniqueClassNameIndex(rows);
  const mine = uniqueClassNameIndex(rows);
  it("유일한 이름만 잇는다", () => expect([...mine.entries()]).toEqual([...app.entries()]));
  const inputs = [
    { metaClassId: "meta-id", targetLabel: "중등M 중3 BS3Q" },
    { metaClassId: null, targetLabel: "중등M 중3 BS3Q" },
    { metaClassId: null, targetLabel: "겹치는 반" },
    { metaClassId: "  ", targetLabel: null },
  ];
  for (const x of inputs) {
    it(JSON.stringify(x), () => {
      expect(transitionClassId(x, mine)).toBe(resolveTransitionClassId({ ...x, classIdByUniqueName: app }));
    });
  }
});

it("자리 별칭 표가 앱과 같다", () => {
  expect([...SEAT_ALIAS_KEYS].sort()).toEqual([...SPECIAL_SLOT_ALIAS_KEYS].sort());
});
