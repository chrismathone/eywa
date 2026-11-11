import { describe, expect, it } from "vitest";
import { addRating, buildAttention, cellOf, type Counts, type LateItem, type RollupClass, type RollupOwnerKind, type RollupStudent, barTextOf } from "./view-admin";
import { attentionItems, listedOwner, openRows, ownerMeta, rankByRating, rankOwners, buildTree, classLines, foldAttention, inClassOf, judge, kindStatuses, NO_CLASS, NO_CLASS_LABEL, NO_OWNER, rootOfTree, studentLines, sumCells, mixPercents } from "./view-admin-levels";

const c = (total: number, done: number, due: number, ontime: number, late = 0, o: Partial<Counts> = {}): Counts => ({ total, done, due, ontime, late, lateDone: 0, expired: 0, over7: 0, ...o });
const ok = (o: Partial<RollupOwnerKind>): RollupOwnerKind => ({ ownerId: "t1", subject: "math", kind: "attendance", period: "daily", ...c(10, 9, 10, 9, 1), ...o });
const OWNERS = { t1: "한지우", t2: "문예린" };
const CLASSES = { c1: { name: "중2 A", subject: "math", teacherId: "t1" }, c2: { name: "중2 B", subject: "math", teacherId: "t2" }, e1: { name: "LE2", subject: "english", teacherId: "t2" } };
const STUDENTS = { s1: { name: "김하준", school: "경명여중", grade: "중1" }, s2: { name: "이서아", school: null, grade: null } };

describe("judge", () => {
  it("로열티와 같은 9등급(표의 '전체' 칸과 같은 숫자 = 때가 된 업무 가운데 기한 안에 끝낸 비율) · 색 묶음 1~2 / 3~4 / 5 이하 · 결론 한 줄(다 했나 · 안 한 쪽인가 · 늦은 쪽인가 · 남은 쪽인가) + 결말 구성 + 평균과의 차이", () => {
    expect(judge(cellOf(c(10, 10, 10, 10)), { pct: 85, label: "과목" })).toMatchObject({ grade: "good", tier: 1, label: "1등급", reason: "업무 완료", gap: { label: "과목", diff: 15 }, mix: { total: 10, good: 10, lateDone: 0, missed: 0, left: 0 } });
    expect(judge(cellOf(c(10, 8, 10, 8, 2)))).toMatchObject({ grade: "warn", tier: 3, label: "3등급" });
    expect(judge(cellOf(c(10, 6, 10, 6, 4)))).toMatchObject({ grade: "warn", tier: 4, reason: "기한 내 완료율 60% · 미처리가 많음", mix: { total: 10, good: 6, lateDone: 0, missed: 4, left: 0 } });
    expect(judge(cellOf(c(10, 5, 10, 5, 5)))).toMatchObject({ grade: "bad", tier: 5, label: "5등급" });
    // 늦게라도 한 쪽이 더 많으면 '기한 후 완료가 많음'.
    expect(judge(cellOf(c(10, 9, 10, 3, 0, { lateDone: 6, expired: 1 }))).reason).toBe("기한 내 완료율 30% · 기한 후 완료가 많음");
    expect(judge(cellOf(c(0, 0, 0, 0)))).toMatchObject({ grade: "none", reason: "" });
  });
  it("🔴 때가 안 된 업무는 등급에 들지 않는다 — 기한 전의 월간 · 건별만 있으면 '평가 대기'(진행만 적는다) · 수업이 끝난 뒤 남은 것은 분모에 든다", () => {
    // 월 상담 30건(말일 기한) 중 3건을 했다 — 아직 때가 아니라 등급 없이 진행만(원장 2026-11-11 "추천으로 진행" — 달 초에 등급이 깎이지 않는다).
    expect(judge(cellOf(c(30, 3, 0, 0)))).toMatchObject({ grade: "wait", label: "평가 대기", reason: "진행 중 · 30건 중 3건 완료", mix: null });
    // 일간 21건은 다 했고 월간 19건(말일 기한)이 남은 반 — 일간 실적대로 1등급.
    //   🔴 그래도 '업무 완료'라고 적지 않는다 — 기한 전 업무가 남았으면 그 건수를 함께 적는다.
    expect(judge(cellOf(c(40, 21, 21, 21)))).toMatchObject({ grade: "good", tier: 1, reason: "기한 내 완료 · 진행 중 19건", mix: { total: 21, good: 21, left: 0 } });
    expect(judge(cellOf(c(40, 40, 21, 21))).reason).toBe("업무 완료"); // 기한 전 19건도 미리 끝냈다
    // 🔴 수업은 끝났고 아직 안 보낸 보고서(기한 전)는 '남음'으로 분모에 든다 — 남은 것이 있으면 100%가 아니다("남음이 있는데 100%는 말도 안됨").
    expect(judge(cellOf(c(10, 6, 10, 6)))).toMatchObject({ grade: "warn", tier: 4, reason: "기한 내 완료율 60% · 남은 업무가 많음", mix: { total: 10, good: 6, left: 4 } });
    // '업무 완료'는 전부 기한 안에 끝냈을 때만 — 99.9%는 1등급이어도 '대부분 기한 내 완료'라고 적는다.
    expect(judge(cellOf(c(1000, 999, 1000, 999, 1)))).toMatchObject({ tier: 1, reason: "대부분 기한 내 완료" });
  });
  it("🔴 때가 된 업무가 3건 미만이면 등급 없이 건수만 · 7일 넘은 미처리가 있어도 등급을 덮어쓰지 않는다", () => {
    expect(judge(cellOf(c(2, 0, 2, 0, 2)))).toMatchObject({ grade: "wait", reason: "지금 2건 · 3건부터 등급 산정" });
    // 🔴 세는 것은 전체가 아니라 **때가 된 업무**다 — 전체 40건이어도 때가 된 것이 2건이면 평가 대기.
    expect(judge(cellOf(c(40, 3, 2, 2)))).toMatchObject({ grade: "wait", tier: null, reason: "지금 2건 · 3건부터 등급 산정" });
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
    expect(math.cell).toMatchObject({ due: 30, ontime: 23, late: 7, pct: 76 }); // 23/30 = 76.6 → 내림
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
  it("종류별 상태 = 업무 있는 종류만 · % = 때가 된 업무 가운데 기한 안에 끝낸 비율 · 안 끝낸 것 = 전체 − 완료 − 미처리(지금 열린 것 + 확정)", () => {
    const { cells } = sumCells(rows, inClassOf("c1"));
    expect(kindStatuses(cells).map((s) => [s.label, s.cell.pct, s.upcoming, s.cell.late])).toEqual([["출결", 100, 0, 0], ["보고서 작성", 66, 2, 3]]); // 6/9 = 66.6 → 내림
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
    expect(folded.map((r) => [r.title, r.sub, r.count, r.days, r.summary])).toEqual([["문예린", "1명", 1, 10, "보고서 작성 1"], ["한지우", "2명", 3, 3, "보고서 작성 2 · 출결 1"]]);
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
  it("기한 내 완료율 높은 순 · 같은 %는 같은 등수(다음 등수는 건너뜀) · 등급 전(때가 된 업무 3건 미만)은 등수 없이 뒤 · 담당 미정 제외", () => {
    const rows = rankOwners([o("a", "가", c(10, 8, 10, 8)), o("b", "나", c(20, 20, 20, 20)), o("c", "다", c(10, 10, 10, 10)), o("d", "라", c(2, 0, 2, 0)), o(NO_OWNER, "담당 미정", c(10, 10, 10, 10))]);
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

describe("수업보고서 평점 — 합치기 · 등수", () => {
  const o = (ownerId: string, name: string, rating?: { rated: number; avg: number }) => ({ ownerId, name, cell: cellOf(c(10, 10, 10, 10)), cells: {}, classes: [], rating });
  it("합칠 때는 건수로 가중한다 · 한쪽이 없으면 있는 쪽 그대로", () => {
    expect(addRating({ rated: 10, avg: 4 }, { rated: 30, avg: 2 })).toEqual({ rated: 40, avg: 2.5 });
    expect(addRating(undefined, { rated: 3, avg: 5 })).toEqual({ rated: 3, avg: 5 });
    expect(addRating({ rated: 3, avg: 5 }, undefined)).toEqual({ rated: 3, avg: 5 });
    expect(addRating(undefined, undefined)).toBeUndefined();
  });
  it("두 과목에 걸친 선생님은 뿌리에서 한 사람으로 합친다(건수 가중) — 평점이 한 과목에만 있어도 남는다", () => {
    const tree = [
      { subject: "math", label: "수학", cell: cellOf(c(10, 10, 10, 10)), cells: {}, owners: [o("t1", "가", { rated: 10, avg: 4 }), o("t2", "나")] },
      { subject: "english", label: "영어", cell: cellOf(c(10, 10, 10, 10)), cells: {}, owners: [o("t1", "가", { rated: 30, avg: 2 }), o("t2", "나", { rated: 6, avg: 3 })] },
    ];
    const root = rootOfTree(tree);
    expect(root.owners.find((x) => x.ownerId === "t1")!.rating).toEqual({ rated: 40, avg: 2.5 });
    expect(root.owners.find((x) => x.ownerId === "t2")!.rating).toEqual({ rated: 6, avg: 3 });
  });
  it("평균 높은 순 · 같은 점수는 같은 등수 · 5건 미만은 등수 없이 뒤 · 평점 없는 사람 · 담당 미정은 뺀다", () => {
    const rows = rankByRating([o("a", "가", { rated: 20, avg: 3.2 }), o("b", "나", { rated: 9, avg: 4.1 }), o("c", "다", { rated: 50, avg: 3.2 }), o("d", "라", { rated: 4, avg: 5 }), o("e", "마"), o(NO_OWNER, "담당 미정", { rated: 9, avg: 5 })]);
    expect(rows.map((r) => [r.name, r.rank])).toEqual([["나", 1], ["다", 2], ["가", 2], ["라", null]]);
  });
});

describe("mixPercents — 판정 줄의 %", () => {
  it("🔴 표의 칸과 같은 셈 — 기한 내 = 내림 · 미처리 = 올림(칸의 '미처리 n%'와 같다) · 한 건이라도 있으면 0%라고 적지 않는다", () => {
    // 300건 중 미처리 7건 — 예전엔 판정 줄이 반올림(2%), 합계 칸은 올림(3%)이라 같은 수가 다르게 적혔다.
    const a = cellOf(c(300, 293, 300, 280, 7, { lateDone: 13 }));
    const va = judge(a);
    expect(mixPercents(va.mix!)).toEqual({ ontime: 93, lateDone: 4, missed: 3, left: 0 });
    expect(mixPercents(va.mix!).missed).toBe(barTextOf(a)!.missPct);
    expect(mixPercents(va.mix!).ontime).toBe(a.pct);
    // 300건 중 1건 — '미처리 0% 1건'이 아니라 1%. 기한 후 완료 · 남음도 한 건이면 1%.
    const b = cellOf(c(300, 298, 300, 297, 1, { lateDone: 1 }));
    expect(mixPercents(judge(b).mix!)).toEqual({ ontime: 99, lateDone: 1, missed: 1, left: 1 });
    expect(mixPercents(judge(b).mix!).missed).toBe(barTextOf(b)!.missPct);
  });
});
