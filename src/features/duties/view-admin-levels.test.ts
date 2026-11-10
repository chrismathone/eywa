import { describe, expect, it } from "vitest";
import { buildAttention, cellOf, type Counts, type LateItem, type RollupClass, type RollupOwnerKind, type RollupStudent } from "./view-admin";
import { attentionItems, listedOwner, openRows, ownerMeta, rankOwners, buildTree, classLines, foldAttention, inClassOf, judge, kindStatuses, NO_CLASS, NO_CLASS_LABEL, NO_OWNER, rootOfTree, studentLines, sumCells } from "./view-admin-levels";

const c = (total: number, done: number, due: number, ontime: number, late = 0, o: Partial<Counts> = {}): Counts => ({ total, done, due, ontime, late, lateDone: 0, expired: 0, over7: 0, ...o });
const ok = (o: Partial<RollupOwnerKind>): RollupOwnerKind => ({ ownerId: "t1", subject: "math", kind: "attendance", period: "daily", ...c(10, 9, 10, 9, 1), ...o });
const OWNERS = { t1: "한지우", t2: "문예린" };
const CLASSES = { c1: { name: "중2 A", subject: "math", teacherId: "t1" }, c2: { name: "중2 B", subject: "math", teacherId: "t2" }, e1: { name: "LE2", subject: "english", teacherId: "t2" } };
const STUDENTS = { s1: { name: "김하준", school: "경명여중", grade: "중1" }, s2: { name: "이서아", school: null, grade: null } };

describe("judge", () => {
  it("로열티와 같은 9등급(전체 % 기준) · 색 묶음 1~2 / 3~4 / 5 이하 · 결론 한 줄(제때인가 · 늦게 하는 쪽인가 · 안 하는 쪽인가) + 결말 구성 + 평균과의 차이", () => {
    expect(judge(cellOf(c(10, 10, 10, 10)), { pct: 85, label: "과목" })).toMatchObject({ grade: "good", tier: 1, label: "1등급", reason: "전부 제때 처리했습니다.", gap: { label: "과목", diff: 15 }, mix: { due: 10, ontime: 10, lateDone: 0, missed: 0, late: 0 } });
    expect(judge(cellOf(c(10, 8, 10, 8, 2)))).toMatchObject({ grade: "warn", tier: 3, label: "3등급" });
    expect(judge(cellOf(c(10, 6, 10, 6, 4)))).toMatchObject({ grade: "warn", tier: 4, reason: "40%를 제때 못 했습니다 — 주로 하지 않은 업무입니다.", mix: { due: 10, ontime: 6, lateDone: 0, missed: 4, late: 4 } });
    expect(judge(cellOf(c(10, 5, 10, 5, 5)))).toMatchObject({ grade: "bad", tier: 5, label: "5등급" });
    // 늦게라도 한 쪽이 더 많으면 '주로 늦게 처리한 업무'.
    expect(judge(cellOf(c(10, 10, 10, 3, 0, { lateDone: 6, expired: 1 }))).reason).toBe("70%를 제때 못 했습니다 — 주로 늦게 처리한 업무입니다.");
    expect(judge(cellOf(c(0, 0, 0, 0)))).toMatchObject({ grade: "none", reason: "" });
  });
  it("🔴 기한 전 의무만 있으면 '평가 대기' — 달 초·수업 전에 미흡이 되지 않는다", () => {
    expect(judge(cellOf(c(30, 3, 0, 0)))).toMatchObject({ grade: "wait", label: "평가 대기", reason: "아직 기한 전입니다 — 3/30건 완료." });
    // 일간은 다 했는데 월간(말일 기한)이 남은 반 — 일간 실적대로 1등급.
    expect(judge(cellOf(c(40, 21, 21, 21)))).toMatchObject({ grade: "good", reason: "전부 제때 처리했습니다." });
  });
  it("🔴 기한 온 것이 3건 미만이면 등급 없이 건수만 · 7일 넘은 지연이 있어도 등급을 덮어쓰지 않는다", () => {
    expect(judge(cellOf(c(2, 0, 2, 0, 2)))).toMatchObject({ grade: "wait", reason: "기한이 된 업무가 2건뿐이라 아직 등급을 매기지 않습니다." });
    expect(judge(cellOf(c(20, 19, 20, 19, 1, { over7: 1 }))).grade).toBe("good");
  });
});

describe("buildTree · rootOfTree", () => {
  const ok_ = [
    ok({ ownerId: "t1", kind: "attendance", ...c(10, 10, 10, 10) }), ok({ ownerId: "t1", kind: "report_write", ...c(10, 8, 10, 8, 2) }),
    ok({ ownerId: "t2", kind: "attendance", ...c(10, 5, 10, 5, 5) }), ok({ ownerId: "t2", subject: "english", kind: "attendance", ...c(4, 4, 4, 4) }),
    ok({ ownerId: null, subject: null, kind: "report_write", ...c(2, 0, 2, 0, 2) }), ok({ ownerId: "t1", subject: "subject_9", kind: "attendance", ...c(1, 1, 1, 1) }),
  ];
  const cls: RollupClass[] = [
    { classId: "c1", ownerId: "t1", subject: "math", ...c(20, 18, 20, 18, 2) }, { classId: "c2", ownerId: "t2", subject: "math", ...c(10, 5, 10, 5, 5) },
    { classId: "e1", ownerId: "t2", subject: "english", ...c(4, 4, 4, 4) }, { classId: null, ownerId: "t1", subject: "math", ...c(3, 1, 0, 0) },
  ];
  const LABELS = { math: "수학", english: "영어" };
  it("과목 → 선생님 → 반 · 지연 많은 순 · 과목 미정은 맨 뒤 · 설정에 없는 과목 키는 '기타 과목' · 반 없는 의무는 신규생 줄", () => {
    const tree = buildTree(ok_, cls, OWNERS, CLASSES, LABELS);
    expect(tree.map((s) => s.label)).toEqual(["기타 과목", "수학", "영어", "과목 미정"]);
    const math = tree[1]!;
    expect(math.owners.map((o) => o.name)).toEqual(["문예린", "한지우"]);
    expect(math.cell).toMatchObject({ due: 30, ontime: 23, late: 7, pct: 77 });
    expect(math.owners[1]!.classes.map((x) => [x.name, x.classId])).toEqual([["중2 A", "c1"], [NO_CLASS_LABEL, NO_CLASS]]);
    expect(math.owners[1]!.cells.report_write).toMatchObject({ pct: 80, late: 2 });
    expect(tree[3]!.owners[0]).toMatchObject({ name: "담당 미정", ownerId: NO_OWNER });
  });
  it("뿌리 = 전 과목 합 · 같은 선생님은 합친다(반은 양쪽 다)", () => {
    const root = rootOfTree(buildTree(ok_, cls, OWNERS, CLASSES, LABELS));
    expect(root.cell.total).toBe(37);
    const t2 = root.owners.find((o) => o.name === "문예린")!;
    expect(t2.cell).toMatchObject({ total: 14, done: 9 });
    expect(t2.classes.map((x) => x.name).sort()).toEqual(["LE2", "중2 B"]);
  });
});

describe("kindStatuses · studentLines · classLines · sumCells", () => {
  const rows: RollupStudent[] = [
    { studentId: "s1", classId: "c1", kind: "attendance", ...c(5, 5, 5, 5), lastDue: null },
    { studentId: "s1", classId: "c1", kind: "report_write", ...c(5, 2, 4, 2, 2), lastDue: null },
    { studentId: "s2", classId: "c1", kind: "report_write", ...c(5, 4, 4, 4), lastDue: null },
    { studentId: null, classId: "c1", kind: "report_write", ...c(1, 0, 1, 0, 1), lastDue: null },
  ];
  it("종류별 상태 = 의무 있는 종류만 · 기한 전 = 전체 − 완료 − 지금 지연 − 미이행", () => {
    const { cells } = sumCells(rows, inClassOf("c1"));
    expect(kindStatuses(cells).map((s) => [s.label, s.cell.pct, s.upcoming, s.cell.late])).toEqual([["출결", 100, 0, 0], ["보고서 작성", 67, 2, 3]]);
  });
  it("🔴 반 없는 의무(신규생 정착)의 합과 학생 줄은 같은 비교를 쓴다 — 합만 비지 않는다", () => {
    const none: RollupStudent[] = [{ studentId: "s9", classId: null, kind: "newcomer_call", ...c(4, 0, 3, 0, 3), lastDue: null }];
    expect(sumCells(none, inClassOf(NO_CLASS)).all).toMatchObject({ total: 4, late: 3 });
    expect(studentLines(none, {}, NO_CLASS)).toHaveLength(1);
  });
  it("반 줄(선생님 단계) = 반마다 한 줄 · 학생 수 · 신규생 줄 · 지연 많은 반 먼저", () => {
    const lines = classLines([...rows, { studentId: "s9", classId: null, kind: "newcomer_call", ...c(2, 0, 2, 0, 1), lastDue: null }], CLASSES);
    expect(lines.map((l) => [l.name, l.classId, l.students, l.all.late])).toEqual([["중2 A", "c1", 2, 3], [NO_CLASS_LABEL, NO_CLASS, 1, 1]]);
  });
  it("학생 줄 = 지연 있는 학생 먼저 · 이름 옆 학교학년", () => {
    const lines = studentLines(rows, STUDENTS, "c1");
    expect(lines.map((l) => [l.name, l.sub, l.all.late])).toEqual([["김하준", "경명여중1", 2], ["이서아", "", 0]]);
  });
});

describe("foldAttention", () => {
  const late = (o: Partial<LateItem>): LateItem => ({ id: Math.random().toString(36).slice(2), kind: "report_write", period: "daily", cycle: "2026-11-09", status: "open", dueAt: "2026-11-09T15:00:00.000Z", doneAt: null, voidReason: null,
    school: null, grade: null, studentId: "s1", studentName: "김하준", classId: "c1", className: "중2 A", subject: "math", escalation: 1, ownerId: "t1", inherited: false, ...o });
  const NOW = Date.parse("2026-11-12T15:00:00.000Z");
  it("선생님 단위로 접으면 — 사람마다 자기 몫만 · 학생 수는 서로 다른 학생 · 오래된 사람 먼저", () => {
    const rows = buildAttention([late({}), late({ kind: "attendance" }), late({ studentId: "s2", studentName: "이서아", classId: "c2", className: "중2 B" }),
      late({ ownerId: "t2", subject: "english", classId: "e1", className: "LE2", dueAt: "2026-11-02T15:00:00.000Z" })], OWNERS, undefined, NOW);
    const folded = foldAttention(rows, "owner");
    expect(folded.map((r) => [r.title, r.sub, r.count, r.days, r.summary])).toEqual([["문예린", "1명", 1, 10, "수업보고서 작성 1"], ["한지우", "2명", 3, 3, "수업보고서 작성 2 · 출결 입력 1"]]);
    expect(foldAttention(rows.filter((r) => r.ownerId === "t1"), "class").map((r) => [r.title, r.classId, r.sub])).toEqual([["중2 A", "c1", "1명"], ["중2 B", "c2", "1명"]]);
  });
});

describe("attentionItems — 지연 줄이 가리키는 의무", () => {
  const it0 = (ownerId: string | null, classId: string | null, studentId: string | null) => ({ ownerId, classId, studentId });
  const all = [it0("t1", "c1", "s1"), it0("t1", "c1", "s2"), it0("t1", null, "s3"), it0("t2", "c1", "s1"), it0(null, "c2", null)];
  it("잎 줄 = 담당자 × 반 × 학생 한 묶음 · 접은 줄 = 그 선생님(담당 미정 포함) · 그 반(반 없는 의무 포함) 전부", () => {
    expect(attentionItems(all, { key: "t1|c1|s1", ownerId: "t1", classId: "c1", studentId: "s1" })).toEqual([all[0]]);
    expect(attentionItems(all, { key: "owner:t1", ownerId: "t1", classId: null, studentId: null })).toHaveLength(3);
    expect(attentionItems(all, { key: "owner:", ownerId: null, classId: null, studentId: null })).toEqual([all[4]]);
    expect(attentionItems(all.filter((x) => x.ownerId === "t1"), { key: `class:${NO_CLASS}`, ownerId: "t1", classId: NO_CLASS, studentId: null })).toEqual([all[2]]);
  });
});

describe("rankOwners — 선생님 등수", () => {
  const o = (ownerId: string, name: string, cnt: Counts, cells: Record<string, Counts> = {}) => ({ ownerId, name, cell: cellOf(cnt), cells: Object.fromEntries(Object.entries(cells).map(([k, v]) => [k, cellOf(v)])), classes: [] });
  it("기한 준수율 높은 순 · 같은 %는 같은 등수(다음 등수는 건너뜀) · 등급 전은 등수 없이 뒤 · 담당 미정 제외", () => {
    const rows = rankOwners([o("a", "가", c(10, 8, 10, 8)), o("b", "나", c(20, 20, 20, 20)), o("c", "다", c(10, 10, 10, 10)), o("d", "라", c(5, 0, 2, 0)), o(NO_OWNER, "담당 미정", c(10, 10, 10, 10))]);
    expect(rows.map((r) => [r.name, r.rank])).toEqual([["나", 1], ["다", 1], ["가", 3], ["라", null]]);
  });
  it("항목별 — 그 종류의 칸으로 매기고, 그 종류가 없는 사람은 뺀다", () => {
    const rows = rankOwners([o("a", "가", c(10, 10, 10, 10), { attendance: c(10, 5, 10, 5) }), o("b", "나", c(10, 5, 10, 5), { attendance: c(10, 10, 10, 10) }), o("c", "다", c(10, 10, 10, 10))], "attendance");
    expect(rows.map((r) => [r.name, r.rank])).toEqual([["나", 1], ["가", 2]]);
  });
});

describe("openRows — 오늘 미완료", () => {
  const o = (ownerId: string, name: string, cells: Record<string, Counts>) => { const list = Object.values(cells); const sum = list.reduce((a, b) => c(a.total + b.total, a.done + b.done, 0, 0), c(0, 0, 0, 0)); return { ownerId, name, cell: cellOf(sum), cells: Object.fromEntries(Object.entries(cells).map(([k, v]) => [k, cellOf(v)])), classes: [] }; };
  it("남은 것이 많은 순 · 종류별 남은 수(많은 것부터) · 다 끝낸 사람은 뒤", () => {
    const rows = openRows([o("a", "가", { attendance: c(10, 10, 0, 0), report_write: c(10, 10, 0, 0) }), o("b", "나", { attendance: c(10, 7, 0, 0), report_write: c(10, 2, 0, 0) }), o("c", "다", { attendance: c(5, 4, 0, 0) })]);
    expect(rows.map((r) => [r.name, r.left])).toEqual([["나", 11], ["다", 1], ["가", 0]]);
    expect(rows[0]!.kinds).toEqual([{ kind: "report_write", label: "보고서 작성", left: 8 }, { kind: "attendance", label: "출결", left: 3 }]);
  });
});

describe("이름 옆 글 · 관리자 제외", () => {
  it("과목 · 반 수 · 학생 수(모르는 값은 뺀다) · 관리자 역할이면서 맡은 반이 없으면 등수·오늘 미완료에서 뺀다(반을 맡았으면 넣는다)", () => {
    expect(ownerMeta({ load: { subjects: ["수학"], classes: 5, students: 27, manager: false } })).toBe("수학 · 반 5 · 학생 27");
    expect(ownerMeta({ load: { subjects: ["수학", "영어"], classes: 0, students: 0, manager: false } })).toBe("수학·영어");
    expect(listedOwner({ load: { subjects: [], classes: 0, students: 3, manager: true } })).toBe(false);
    expect(listedOwner({ load: { subjects: [], classes: 2, students: 3, manager: true } })).toBe(true);
    expect(listedOwner({ load: { subjects: [], classes: 0, students: 0, manager: false } })).toBe(true);
    const mgr = { ownerId: "m", name: "관리", cell: cellOf(c(10, 10, 10, 10)), cells: {}, classes: [], load: { subjects: [], classes: 0, students: 0, manager: true } };
    expect(rankOwners([mgr])).toEqual([]);
    expect(openRows([{ ...mgr, cell: cellOf(c(10, 2, 0, 0)) }])).toEqual([]);
  });
});
