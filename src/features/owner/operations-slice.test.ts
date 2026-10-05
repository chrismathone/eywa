import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "./defaults";
import { GENERIC_SETTINGS } from "./generic-defaults";
import { resolveSettings } from "./resolve";
import {
  OPERATIONS_FACE_KEYS,
  OPERATIONS_UNOWNED_KEYS,
  TIMETABLE_SUBJECT_KEYS,
  applyOperationsFace,
  applySubjectFields,
  operationsFaceCanonical,
  operationsFaceSnapshot,
  removeSubjectRow,
  subjectFieldsRequestSchema,
  subjectRemoveRequestSchema,
} from "./operations-slice";
import { operationsSchema, type OperationsSettings, type SubjectSetting } from "./settings-types";

/**
 * 운영 섹션 "제 몫만 얹기" 규칙(2026-10-05) — 쓰는 곳이 여럿인 섹션을 통째로 갈아끼우던 것을 막는다.
 * 합성 값만 쓴다.
 */
const base = (): OperationsSettings => structuredClone(DEFAULT_SETTINGS.operations);
const subject = (ops: OperationsSettings, key: string): SubjectSetting => ops.subjects.find((s) => s.key === key)!;
const withSubject = (ops: OperationsSettings, key: string, patch: Partial<SubjectSetting>): OperationsSettings => ({
  ...ops,
  subjects: ops.subjects.map((s) => (s.key === key ? { ...s, ...patch } : s)),
});
const GROUPS = [{ id: "g1", title: "1교시", classIds: ["c1", "c2"] }];

describe("칸의 주인", () => {
  it("🔴 운영 섹션의 모든 칸은 어느 면이 맡는지(또는 아무도 안 맡는지) 정해져 있다 — 새 칸을 더하면 여기서 정한다", () => {
    const owned = [...OPERATIONS_FACE_KEYS.operations, ...OPERATIONS_FACE_KEYS.subjects, ...OPERATIONS_UNOWNED_KEYS];
    expect([...owned].sort()).toEqual(Object.keys(DEFAULT_SETTINGS.operations).sort());
    expect(new Set(owned).size).toBe(owned.length);
    // 일반판 기본값도 같은 칸 집합이다(프리셋이 칸을 더하거나 빼지 않는다).
    expect(Object.keys(GENERIC_SETTINGS.operations).sort()).toEqual(Object.keys(DEFAULT_SETTINGS.operations).sort());
  });
});

describe("applyOperationsFace — 면 저장은 그 면의 칸만 바꾼다", () => {
  it("운영 체계 면: 휴원일·PIN은 반영되고, 함께 실려 온 과목 변경은 버려진다", () => {
    const fresh = base();
    const incoming = withSubject(
      { ...base(), holidays: [{ date: "2026-10-09", name: "한글날" }], seatPins: { lab: "1111", jj: "" } },
      "english",
      { label: "옛 화면의 영어" },
    );
    const next = applyOperationsFace(fresh, incoming, "operations");
    expect(next.holidays).toEqual([{ date: "2026-10-09", name: "한글날" }]);
    expect(next.seatPins).toEqual({ lab: "1111", jj: "" });
    expect(next.subjects).toEqual(fresh.subjects);
  });

  it("과목 운영 면: 과목·요일 병합은 반영되고, 함께 실려 온 휴원일·PIN은 버려진다", () => {
    const fresh = { ...base(), holidays: [{ date: "2026-12-25", name: "성탄절" }], seatPins: { lab: "7777", jj: "8888" } };
    const incoming = withSubject({ ...base(), holidays: [], seatPins: { lab: "", jj: "" } }, "english", { label: "영어(새 이름)" });
    const next = applyOperationsFace(fresh, incoming, "subjects");
    expect(subject(next, "english").label).toBe("영어(새 이름)");
    expect(next.holidays).toEqual([{ date: "2026-12-25", name: "성탄절" }]);
    expect(next.seatPins).toEqual({ lab: "7777", jj: "8888" });
  });

  it("어느 면도 맡지 않는 칸(교시 방식·학교 별칭·학기)은 어떤 저장에서도 방금 읽은 값 그대로다", () => {
    const fresh: OperationsSettings = { ...base(), periodStyle: "plain", schoolSaveAliases: [], terms: [{ name: "1학기", start: "2026-03-01", end: "2026-07-20" }] };
    const incoming: OperationsSettings = { ...base(), periodStyle: "chinsan", terms: [] };
    for (const face of ["operations", "subjects"] as const) {
      const next = applyOperationsFace(fresh, incoming, face);
      expect(next.periodStyle).toBe("plain");
      expect(next.schoolSaveAliases).toEqual([]);
      expect(next.terms).toEqual(fresh.terms);
    }
  });

  it("🔴 과목 행의 시간표 칸은 방금 읽은 값이 이긴다 — 화면이 들고 있던 옛 강사 순서·그룹을 되살리지 않는다", () => {
    const fresh = withSubject(base(), "english", { teacherViewOrder: ["T1", "T2"], integrationGroups: GROUPS, integrationGroupsEnabled: true });
    const incoming = withSubject(base(), "english", { label: "영어B", teacherViewOrder: ["옛순서"], integrationGroups: [] });
    const english = subject(applyOperationsFace(fresh, incoming, "subjects"), "english");
    expect(english.label).toBe("영어B");
    expect(english.teacherViewOrder).toEqual(["T1", "T2"]);
    expect(english.integrationGroups).toEqual(GROUPS);
    expect(english.integrationGroupsEnabled).toBe(true);
  });

  it("🔴 방금 읽은 값에서 **없어진** 시간표 칸은 없는 채로 — 화면의 옛 값이 부활하지 않는다", () => {
    const fresh = base(); // english에 teacherViewOrder·integrationOthersTitle 없음
    const incoming = withSubject(base(), "english", { teacherViewOrder: ["옛순서"], integrationOthersTitle: "옛 제목" });
    const english = subject(applyOperationsFace(fresh, incoming, "subjects"), "english");
    expect("teacherViewOrder" in english).toBe(false);
    expect("integrationOthersTitle" in english).toBe(false);
  });

  it("새 과목은 시간표 칸 없이 받는다(과목 운영 면이 맡지 않는 값을 실어 보낼 수 없다)", () => {
    const incoming: OperationsSettings = {
      ...base(),
      subjects: [...base().subjects, { key: "subject_9", label: "논술", color: "neutral", weekdayGrouping: "mon-thu", testMax: 5, integrationGroups: GROUPS }],
    };
    const added = subject(applyOperationsFace(base(), incoming, "subjects"), "subject_9");
    expect(added.label).toBe("논술");
    expect("integrationGroups" in added).toBe(false);
  });

  it("과목 순서는 화면이 보낸 대로, 시간표 칸은 과목 키를 따라간다", () => {
    const fresh = withSubject(base(), "math", { teacherViewOrder: ["수학T"] });
    const reversed: OperationsSettings = { ...base(), subjects: [...base().subjects].reverse() };
    const next = applyOperationsFace(fresh, reversed, "subjects");
    expect(next.subjects.map((s) => s.key)).toEqual(reversed.subjects.map((s) => s.key));
    expect(subject(next, "math").teacherViewOrder).toEqual(["수학T"]);
  });

  it("면이 맡는 칸만 뽑은 사본 — 과목 삭제 응답이 화면에 돌려주는 값", () => {
    const snapshot = operationsFaceSnapshot(base(), "subjects");
    expect(Object.keys(snapshot).sort()).toEqual([...OPERATIONS_FACE_KEYS.subjects].sort());
    expect(JSON.stringify(operationsFaceSnapshot(base(), "subjects"))).not.toContain("seatPins");
  });

  it("원본을 변형하지 않는다", () => {
    const fresh = withSubject(base(), "english", { teacherViewOrder: ["T1"] });
    const before = JSON.stringify(fresh);
    applyOperationsFace(fresh, withSubject(base(), "english", { label: "X" }), "subjects");
    expect(JSON.stringify(fresh)).toBe(before);
  });
});

describe("applySubjectFields — 시간표 쪽 저장은 한 과목의 보낸 칸만", () => {
  it("보낸 칸은 바뀌고, null은 그 칸을 지우고, 안 보낸 칸은 그대로다", () => {
    const fresh = withSubject(base(), "english", { teacherViewOrder: ["옛"], integrationOthersTitle: "기타", integrationShowOthers: true });
    const next = applySubjectFields(fresh, "english", { teacherViewOrder: ["새1", "새2"], integrationOthersTitle: null })!;
    const english = subject(next, "english");
    expect(english.teacherViewOrder).toEqual(["새1", "새2"]);
    expect("integrationOthersTitle" in english).toBe(false);
    expect(english.integrationShowOthers).toBe(true);
  });

  it("다른 과목·다른 칸은 건드리지 않는다", () => {
    const fresh = base();
    const next = applySubjectFields(fresh, "english", { integrationGroups: GROUPS })!;
    expect(subject(next, "math")).toBe(subject(fresh, "math"));
    expect(next.holidays).toBe(fresh.holidays);
    expect(subject(next, "english").label).toBe(subject(fresh, "english").label);
  });

  it("없는 과목이면 null — 과목을 만들지 않는다", () => {
    expect(applySubjectFields(base(), "nope", { teacherViewOrder: ["A"] })).toBeNull();
  });
});

describe("removeSubjectRow", () => {
  it("그 과목 행만 빠진다 · 없으면 그대로", () => {
    const fresh = base();
    const { next, removed } = removeSubjectRow(fresh, "english");
    expect(removed).toBe(true);
    expect(next.subjects.map((s) => s.key)).toEqual(fresh.subjects.filter((s) => s.key !== "english").map((s) => s.key));
    expect(removeSubjectRow(fresh, "nope")).toEqual({ next: fresh, removed: false });
  });
});

describe("요청 형식", () => {
  it("시간표 칸 여섯 개 밖의 속성은 거절한다", () => {
    expect(subjectFieldsRequestSchema.safeParse({ subject: "english", fields: { teacherViewOrder: ["A"] } }).success).toBe(true);
    expect(subjectFieldsRequestSchema.safeParse({ subject: "english", fields: { integrationOthersTitle: null } }).success).toBe(true);
    expect(subjectFieldsRequestSchema.safeParse({ subject: "english", fields: { label: "가로채기" } }).success).toBe(false);
    expect(subjectFieldsRequestSchema.safeParse({ subject: "english", fields: {}, extra: 1 }).success).toBe(false);
    expect(subjectFieldsRequestSchema.safeParse({ subject: "ENG LISH", fields: {} }).success).toBe(false);
    expect([...TIMETABLE_SUBJECT_KEYS].sort()).toEqual(Object.keys(subjectFieldsRequestSchema.shape.fields.shape).sort());
  });

  it("과목 삭제 요청은 키 하나뿐이다", () => {
    expect(subjectRemoveRequestSchema.safeParse({ key: "english" }).success).toBe(true);
    expect(subjectRemoveRequestSchema.safeParse({ key: "english", subjects: [] }).success).toBe(false);
  });
});

describe("operationsFaceCanonical — 면의 '그사이 바뀌었나' 판정", () => {
  it("🔴 옛 저장 행의 '칸 없음'과 스키마 기본값은 같은 값이다(시간표 저장이 기본값을 채워도 충돌이 아니다)", () => {
    const legacyRow = { key: "english", label: "영어" } as unknown as SubjectSetting; // color·weekdayGrouping·testMax 없음
    const legacy = resolveSettings({ operations: { subjects: [legacyRow] } }, { name: "" }).operations;
    const filled: OperationsSettings = {
      ...legacy,
      subjects: legacy.subjects.map((s) => ({ ...s, color: "neutral", weekdayGrouping: "mon-thu", testMax: 5 })),
    };
    expect(operationsFaceCanonical(legacy, "subjects")).toBe(operationsFaceCanonical(filled, "subjects"));
  });

  it("시간표 칸이 바뀌어도 과목 운영 면은 그대로다 · 과목 이름이 바뀌면 달라진다", () => {
    const a = base();
    expect(operationsFaceCanonical(withSubject(a, "english", { teacherViewOrder: ["T1"], integrationGroups: GROUPS }), "subjects")).toBe(
      operationsFaceCanonical(a, "subjects"),
    );
    expect(operationsFaceCanonical(withSubject(a, "english", { label: "영어B" }), "subjects")).not.toBe(operationsFaceCanonical(a, "subjects"));
  });

  it("면은 서로의 변경에 영향받지 않는다", () => {
    const a = base();
    const holidayChanged = { ...a, holidays: [{ date: "2026-10-09", name: "한글날" }] };
    const subjectChanged = withSubject(a, "math", { label: "수학B" });
    expect(operationsFaceCanonical(holidayChanged, "subjects")).toBe(operationsFaceCanonical(a, "subjects"));
    expect(operationsFaceCanonical(holidayChanged, "operations")).not.toBe(operationsFaceCanonical(a, "operations"));
    expect(operationsFaceCanonical(subjectChanged, "operations")).toBe(operationsFaceCanonical(a, "operations"));
    expect(operationsFaceCanonical({ ...a, seatPins: { lab: "1", jj: "2" } }, "operations")).not.toBe(operationsFaceCanonical(a, "operations"));
  });

  it("객체 키 순서는 무관하고, 배열(과목) 순서는 의미가 있다", () => {
    const a = base();
    const shuffledKeys: OperationsSettings = {
      ...a,
      subjects: a.subjects.map((s) => Object.fromEntries(Object.entries(s).reverse()) as SubjectSetting),
    };
    expect(operationsFaceCanonical(shuffledKeys, "subjects")).toBe(operationsFaceCanonical(a, "subjects"));
    expect(operationsFaceCanonical({ ...a, subjects: [...a.subjects].reverse() }, "subjects")).not.toBe(operationsFaceCanonical(a, "subjects"));
  });

  it("스키마에 안 맞는 저장값도 같은 경로로 비교한다(원본 그대로) — 던지지 않는다", () => {
    const broken = { ...base(), subjects: [...base().subjects, base().subjects[0]!] }; // 과목 키 중복
    expect(operationsFaceCanonical(broken, "subjects")).toBe(operationsFaceCanonical(structuredClone(broken), "subjects"));
    expect(operationsFaceCanonical(broken, "subjects")).not.toBe(operationsFaceCanonical(base(), "subjects"));
  });

  it("스키마 정규화는 한 번 더 태워도 같다(화면·저장이 같은 값을 본다)", () => {
    for (const ops of [DEFAULT_SETTINGS.operations, GENERIC_SETTINGS.operations]) {
      const once = operationsSchema.parse(ops);
      for (const face of ["operations", "subjects"] as const) {
        expect(operationsFaceCanonical(once, face)).toBe(operationsFaceCanonical(ops, face));
        expect(operationsFaceCanonical(operationsSchema.parse(once), face)).toBe(operationsFaceCanonical(ops, face));
      }
    }
  });
});
