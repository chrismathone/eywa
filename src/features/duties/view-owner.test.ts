import { describe, expect, it } from "vitest";
import { DUTY_REQUEST_SOURCE } from "./late-request";
import type { Cell, LateItem } from "./view-admin";
import type { TreeSubject } from "./view-admin-levels";
import { ownerRows } from "./view-owner";

const NOW = Date.parse("2026-11-10T03:00:00Z");
const cell = (o: Partial<Cell>): Cell => ({ total: 10, done: 9, due: 10, ontime: 9, lateDone: 0, late: 0, expired: 0, over7: 0, pct: 90, ...o });
const subject = (key: string, owners: [string, Partial<Cell>][], c: Partial<Cell> = {}): TreeSubject => ({ subject: key, label: key === "math" ? "수학" : "영어", cell: cell(c), cells: {}, owners: owners.map(([id, oc]) => ({ ownerId: id, name: id, cell: cell(oc), cells: {}, classes: [] })) });
const late = (o: Partial<LateItem>): LateItem => ({ id: "x", kind: "attendance", period: "daily", cycle: "2026-11-09", status: "open", dueAt: "2026-11-09T15:00:00Z", doneAt: null, voidReason: null, studentId: "s", studentName: "학생", school: null, grade: null, classId: "c", className: "반", subject: "math", escalation: 0, ownerId: "t1", inherited: false, ...o });
const req = (o: object) => ({ id: "w", source: DUTY_REQUEST_SOURCE, status: "working" as const, createdAt: "2026-11-09T00:00:00Z", dueOn: "2026-11-12", steps: [{ user: { id: "t1" } }], ...o }) as Parameters<typeof ownerRows>[2][number];

describe("ownerRows — 과목 관리자별 현황", () => {
  const tree = [subject("english", [["e1", {}]]), subject("math", [["t1", { pct: 50, ontime: 5, late: 2 }], ["t2", { pct: 80, ontime: 8 }]], { pct: 70 })];
  it("지연은 그 과목 것만 · 이관은 따로 · 3일·7일 이상을 가른다 · 손댈 것이 많은 과목이 먼저", () => {
    const rows = ownerRows(tree, [late({}), late({ ownerId: "t2", dueAt: "2026-11-06T15:00:00Z" }), late({ dueAt: "2026-11-01T15:00:00Z" }), late({ inherited: true, dueAt: "2026-10-01T15:00:00Z" }), late({ subject: "english", ownerId: "e1" })], [], { math: ["김관리"] }, {}, NOW, "2026-11-10");
    expect(rows.map((r) => r.subject)).toEqual(["math", "english"]);
    expect(rows[0]).toMatchObject({ late: 3, late3: 2, late7: 1, lateTeachers: 2, requested: 0, inherited: 1, managers: ["김관리"], bad: 1, warn: 1 });
    expect(rows[1]).toMatchObject({ late: 1, late3: 0, late7: 0, managers: [] });
  });
  it("처리 요청 = 지연 선생님 가운데 끝나지 않은 요청이 나간 사람 · 요청 기한 지남 · 끝난 요청·다른 출처는 안 센다", () => {
    const items = [late({}), late({ ownerId: "t2" })];
    const rows = ownerRows(tree, items, [req({ dueOn: "2026-11-09" }), req({ id: "w2", status: "closed", steps: [{ user: { id: "t2" } }] }), req({ id: "w3", source: "check:absence", steps: [{ user: { id: "t2" } }] })], {}, {}, NOW, "2026-11-10");
    expect(rows[0]).toMatchObject({ subject: "math", lateTeachers: 2, requested: 1, requestsOpen: 1, requestsLate: 1 });
  });
  it("🔴 다른 과목 요청은 이 과목 줄에 안 잡힌다(두 과목을 가르치는 선생님) · 과목을 가리지 않는 요청은 양쪽에", () => {
    const both = [subject("english", [["t1", {}]]), subject("math", [["t1", {}]])];
    const items = [late({}), late({ subject: "english" })];
    const only = ownerRows(both, items, [req({ source: "duty:late:english" })], {}, {}, NOW, "2026-11-10");
    expect(only.find((r) => r.subject === "math")).toMatchObject({ requested: 0, requestsOpen: 0 });
    expect(only.find((r) => r.subject === "english")).toMatchObject({ requested: 1, requestsOpen: 1 });
    expect(ownerRows(both, items, [req({})], {}, {}, NOW, "2026-11-10").map((r) => r.requested)).toEqual([1, 1]);
  });
  it("🔴 이 기간 트리에 없는 과목의 지연도 줄로 남는다(줄의 합 = 지금 열린 지연 전체) · 그 줄은 내려갈 단계가 없다", () => {
    const items = [late({}), late({ subject: "science" }), late({ subject: null }), late({ subject: "science", inherited: true })];
    const rows = ownerRows([subject("math", [["t1", {}]])], items, [], {}, { science: "과학" }, NOW, "2026-11-10");
    expect(rows.reduce((n, r) => n + r.late, 0)).toBe(3);
    expect(rows.find((r) => r.subject === "science")).toMatchObject({ label: "과학", inTree: false, late: 1 });
    expect(rows.find((r) => r.subject === null)).toMatchObject({ label: "과목 미정", inTree: false });
  });
});
