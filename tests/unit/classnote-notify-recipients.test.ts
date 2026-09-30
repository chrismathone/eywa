import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  NOTIFY_RECIPIENT_CAP,
  classWideRecipients,
  dedupePlanRows,
  eventDedupeKey,
  finalizeRecipients,
  newGuardStats,
  planNotifyRecipients,
} from "../../scripts/_classnote/notify-recipients.mjs";
import {
  classBoardClassOf,
  computeNotifyRecipients,
  loadClassBoardClasses,
  loadVerifiedStudentPairs,
} from "../../scripts/_classnote/notify-recipients-db.mjs";
import { buildClassBoardChildMap, classBoardMatch } from "../../scripts/_classnote/class-board-keys.mjs";
import {
  classWideTargets,
  oneBoardChildConflict,
  pollParentCommentsOnce,
  pollParentPostsOnce,
  recipientsFor,
} from "../../scripts/_classnote/classnote-feed-core.mjs";
import { formatWorkerResults } from "@/features/report-admin/worker-results";

/**
 * 학부모 글·댓글 벨 수신자 — 원장 2026-09-30 정정 *"'현재 담당 중인 선생님'에게만 알림이 가면 되는 것."*
 * + *"가드를 좀 제법 쳐서 알림 이상하게 가지 않도록 해."* — 가드 (1)~(8)을 하나씩 잠근다.
 */

const T = "t1";
const TODAY = "2026-09-30";
const u = (over: Partial<{ tenantId: string; active: boolean; role: string }> = {}) => ({ tenantId: T, active: true, role: "teacher", ...over });
const cls = (homeroomTeacherId: string | null, over: Record<string, unknown> = {}) => ({
  subject: "math",
  isActive: true,
  homeroomTeacherId,
  slots: [] as unknown[],
  ...over,
});
const enr = (classId: string, over: Record<string, unknown> = {}) => ({
  studentId: "s1",
  classId,
  startDate: "2026-03-02",
  endDate: null as string | null,
  isTransferred: false,
  ...over,
});
const liveSlot = (teacherId: string, over: Record<string, unknown> = {}) => ({
  teacherId,
  slotTeacherLabel: null,
  validFrom: "2026-09-01",
  validTo: null,
  ...over,
});

type PlanInput = Parameters<typeof planNotifyRecipients>[0];
function plan(over: Partial<PlanInput> = {}) {
  return planNotifyRecipients({
    studentIds: ["s1"],
    enrollments: [enr("A")],
    classes: new Map([["A", cls("HA")]]),
    delegations: [],
    users: new Map([["HA", u()]]),
    keys: ["math", "subject_1"],
    tenant: T,
    today: TODAY,
    ...over,
  }).get("s1")!;
}

describe("받는 사람 = 그 학생의 지금 담당 선생님", () => {
  it("지금 반 담임", () => {
    expect(plan().ids).toEqual(["HA"]);
  });

  it("⭐ 부담임(오늘 유효한 교시 담당)·오늘 임시 위임도 받는다 — 끝난 교시·미래 교시·지난 위임은 아니다", () => {
    const got = plan({
      classes: new Map([
        ["A", cls("HA", { slots: [liveSlot("SUB"), liveSlot("OLD", { validTo: "2026-08-31" }), liveSlot("FUT", { validFrom: "2026-10-05" })] })],
      ]),
      delegations: [
        { classId: "A", delegateUserId: "DEL", fromDate: "2026-09-29", toDate: "2026-10-01", revokedAt: null },
        { classId: "A", delegateUserId: "PAST", fromDate: "2026-09-01", toDate: "2026-09-05", revokedAt: null },
      ],
      users: new Map(["HA", "SUB", "OLD", "FUT", "DEL", "PAST"].map((id) => [id, u()])),
    });
    expect(new Set(got.ids)).toEqual(new Set(["HA", "SUB", "DEL"]));
    expect(got.homerooms).toEqual(["HA"]);
  });

  it("⭐ 반이동한 옛 반 담당은 받지 않는다 — 이동 당일부터 새 반만(반열림)", () => {
    const moved = {
      enrollments: [enr("OLD", { endDate: TODAY, isTransferred: true }), enr("NEW", { startDate: TODAY })],
      classes: new Map([["OLD", cls("HOLD")], ["NEW", cls("HNEW")]]),
      users: new Map([["HOLD", u()], ["HNEW", u()]]),
    };
    expect(plan(moved).ids).toEqual(["HNEW"]);
    // 전날엔 옛 반만(새 반은 아직 시작 전)
    expect(plan({ ...moved, today: "2026-09-29" }).ids).toEqual(["HOLD"]);
  });

  it("⭐ 일반 종료는 종료일 당일까지 다닌다(반이동과 다르다)", () => {
    expect(plan({ enrollments: [enr("A", { endDate: TODAY })] }).ids).toEqual(["HA"]);
    expect(plan({ enrollments: [enr("A", { endDate: "2026-09-29" })] }).ids).toEqual([]);
  });

  it("⭐ 미래 시작 수강은 빼고 · 퇴원 예약(미래 종료일) 수강은 넣는다", () => {
    expect(plan({ enrollments: [enr("A", { startDate: "2026-10-05" })] }).ids).toEqual([]);
    expect(plan({ enrollments: [enr("A", { endDate: "2026-10-31" })] }).ids).toEqual(["HA"]);
  });

  it("⭐ 종강(is_active=false) 반은 뺀다", () => {
    expect(plan({ classes: new Map([["A", cls("HA", { isActive: false })]]) }).ids).toEqual([]);
  });

  it("⭐ 퇴사·비활성·학생 계정·다른 지점 계정은 뺀다(담임이어도)", () => {
    for (const bad of [u({ active: false }), u({ role: "student" }), u({ tenantId: "other" })]) {
      expect(plan({ users: new Map([["HA", bad]]) }).ids).toEqual([]);
    }
    expect(plan({ users: new Map() }).ids).toEqual([]); // 계정 행이 없으면(모르면) 안 보낸다
  });

  it("보고서 작성자·과거 출결 강사로 넓히지 않는다 — 입력 자체가 없다(지금 반 담당만)", () => {
    const got = plan({
      enrollments: [enr("A"), enr("PAST", { endDate: "2026-05-31" })],
      classes: new Map([["A", cls("HA")], ["PAST", cls("HPAST")]]),
      users: new Map([["HA", u()], ["HPAST", u()]]),
    });
    expect(got.ids).toEqual(["HA"]);
  });

  it("같은 사람은 한 번만(담임이면서 교시 담당, 두 반 담임)", () => {
    const got = plan({
      enrollments: [enr("A"), enr("B")],
      classes: new Map([["A", cls("HA", { slots: [liveSlot("HA")] })], ["B", cls("HA")]]),
    });
    expect(got.ids).toEqual(["HA"]);
  });

  it("자리(LAB) 배치는 사람이 아니다", () => {
    const got = plan({ classes: new Map([["A", cls("HA", { slots: [{ teacherId: null, slotTeacherLabel: "LAB", validFrom: "2026-09-01", validTo: null }] })]]) });
    expect(got.ids).toEqual(["HA"]);
  });
});

describe("(3) 과목 가드", () => {
  it("⭐ 수학 보드 글에 영어 반 담당은 안 간다 — 막은 사람을 센다", () => {
    const got = plan({
      enrollments: [enr("A"), enr("ENG")],
      classes: new Map([["A", cls("HA")], ["ENG", cls("HE", { subject: "english", slots: [liveSlot("NATIVE")] })]]),
      users: new Map([["HA", u()], ["HE", u()], ["NATIVE", u()]]),
    });
    expect(got.ids).toEqual(["HA"]);
    expect(new Set(got.subjectBlocked)).toEqual(new Set(["HE", "NATIVE"]));
  });

  it("두 과목을 다 맡은 사람은 수학 쪽으로 받는다(막은 수에 안 센다)", () => {
    const got = plan({
      enrollments: [enr("A"), enr("ENG")],
      classes: new Map([["A", cls("HA")], ["ENG", cls("HA", { subject: "english" })]]),
    });
    expect(got.ids).toEqual(["HA"]);
    expect(got.subjectBlocked).toEqual([]);
  });

  it("반 전체 글 — 반 과목이 보드 과목과 다르면 아무도 안 받는다", () => {
    const users = new Map([["HE", u()]]);
    const got = classWideRecipients({ classInfo: cls("HE", { subject: "english" }), users, keys: ["math"], tenant: T, today: TODAY });
    expect(got.ids).toEqual([]);
    expect(got.subjectBlocked).toEqual(["HE"]);
  });
});

describe("(2) 재검증 가드 · (4) 상한 가드", () => {
  const planned = (ids: string[], homerooms: string[]) => new Map([["s1", { ids, homerooms, subjectBlocked: [] }]]);

  it("⭐ 다른 쿼리가 확인하지 않은 사람은 뺀다(센다)", () => {
    const got = finalizeRecipients(planned(["HA", "SUB"], ["HA"]), new Set(["s1|HA"])).get("s1")!;
    expect(got.ids).toEqual(["HA"]);
    expect(got.blocked.verify).toBe(1);
  });

  it("재검증 조회가 빈손이면 아무에게도 안 간다(계산만 믿지 않는다)", () => {
    expect(finalizeRecipients(planned(["HA"], ["HA"]), new Set()).get("s1")!.ids).toEqual([]);
  });

  it(`⭐ 수신자가 ${NOTIFY_RECIPIENT_CAP}명을 넘으면 지금 반 담임만으로 좁힌다`, () => {
    const many = ["HA", "S1", "S2", "S3", "S4", "S5"];
    const got = finalizeRecipients(planned(many, ["HA"]), new Set(many.map((id) => `s1|${id}`))).get("s1")!;
    expect(got.ids).toEqual(["HA"]);
    expect(got.narrowed).toBe(true);
    expect(got.blocked.cap).toBe(5);
  });

  it("상한 이하는 그대로", () => {
    const ids = ["HA", "S1", "S2", "S3", "S4"];
    const got = finalizeRecipients(planned(ids, ["HA"]), new Set(ids.map((id) => `s1|${id}`))).get("s1")!;
    expect(got.ids).toEqual(ids);
    expect(got.narrowed).toBe(false);
  });

  it("⭐ 재검증 쿼리 모양 — 같은 지점·활성·학생 계정 아님·보드 과목·운영 반·오늘 다니는 수강·담임/교시/위임", async () => {
    const f = fakeSql(() => []);
    await loadVerifiedStudentPairs(f.sql, T, ["s1"], ["HA"], ["math"], TODAY);
    const q = f.queries.find((x) => x.includes("u.id as user_id"))!;
    expect(q).toBeTruthy();
    expect(q).toMatch(/u\.tenant_id = e\.tenant_id/);
    expect(q).toMatch(/u\.status = 'active'/);
    expect(q).toMatch(/u\.system_role <> 'student'/);
    expect(q).toMatch(/c\.is_active and c\.subject in/);
    expect(q).toMatch(/e\.start_date <= /);
    expect(q, "반이동 당일(반열림)·일반 종료 당일(포함) 규약").toMatch(/e\.end_date = \?::date and not e\.is_transferred/);
    expect(q).toMatch(/c\.teacher_id = u\.id/);
    expect(q).toMatch(/from class_schedules s/);
    expect(q).toMatch(/from class_delegations d/);
  });

  it("⭐ 계산과 재검증이 어긋나면 보내지 않는다(DB 경로 전체)", async () => {
    const f = fakeSql(dbRoute({ slotTeachers: ["SUB"], verified: ["HA"] })); // SUB는 재검증 불합격
    const got = (await computeNotifyRecipients(f.sql, T, ["s1"], ["math"], { today: TODAY })).get("s1")!;
    expect(got.ids).toEqual(["HA"]);
    expect(got.blocked.verify).toBe(1);
  });

  it("지점을 모르면 계산하지 않는다(throw → 호출부 폴백)", async () => {
    const f = fakeSql(() => []);
    await expect(computeNotifyRecipients(f.sql, "", ["s1"], ["math"], { today: TODAY })).rejects.toThrow(/지점/);
    expect(f.queries).toEqual([]);
  });
});

describe("(1) 학생 확정 가드", () => {
  const row = (over: Record<string, unknown> = {}) => ({ boardId: 70, childId: 5, studentId: "sA", name: "김근우A", linkedStudentId: null, ...over });

  it("보드 번호 + 원아 id가 맞을 때만 학생을 정한다", () => {
    const map = buildClassBoardChildMap([row()]);
    expect(classBoardMatch(map, { cls: 70, childId: 5 }).student?.id).toBe("sA");
    expect(classBoardMatch(map, { cls: 71, childId: 5 })).toEqual({ student: null, blocked: null }); // 다른 보드
    expect(classBoardMatch(map, { cls: 70, childId: 6 })).toEqual({ student: null, blocked: null }); // 다른 원아
  });

  it("⭐ 보드 번호가 없으면 이름으로 찾지 않는다(학생 미확정)", () => {
    const map = buildClassBoardChildMap([row()]);
    expect(classBoardMatch(map, { cls: null, childId: 5 })).toEqual({ student: null, blocked: "보드 번호 없음" });
  });

  it("⭐ 한 원아가 두 학생에 걸리면 학생 미확정 — 반 보드 판정끼리 달라도", () => {
    const map = buildClassBoardChildMap([row(), row({ boardId: 80, studentId: "sB", name: "형제" })]);
    expect(classBoardMatch(map, { cls: 70, childId: 5 })).toEqual({ student: null, blocked: "원아가 여러 학생에 걸림" });
    expect(classBoardMatch(map, { cls: 80, childId: 5 }).blocked).toBe("원아가 여러 학생에 걸림");
  });

  it("⭐ 원아 링크(0185a)가 다른 학생이면 학생 미확정(실측 형제 3명)", () => {
    const map = buildClassBoardChildMap([row({ linkedStudentId: "sB" })]);
    expect(classBoardMatch(map, { cls: 70, childId: 5 }).blocked).toBe("원아가 여러 학생에 걸림");
    expect(classBoardMatch(buildClassBoardChildMap([row({ linkedStudentId: "sA" })]), { cls: 70, childId: 5 }).student?.id).toBe("sA");
  });

  it("같은 학생에 원아가 둘(안은지 — 보호자·학생이 각자 가입)은 정상", () => {
    const map = buildClassBoardChildMap([row({ childId: 5 }), row({ childId: 6 })]);
    expect(classBoardMatch(map, { cls: 70, childId: 5 }).student?.id).toBe("sA");
    expect(classBoardMatch(map, { cls: 70, childId: 6 }).student?.id).toBe("sA");
  });

  it("⭐ 1인 보드 — 게이트를 통과해도 글 원아가 다른 학생에 연결돼 있으면 학생을 정하지 않는다(링크 없으면 게이트를 믿는다)", () => {
    const links = new Map([[5, "sB"], [6, "sA"]]);
    expect(oneBoardChildConflict(links, 5, "sA")).toBe(true);
    expect(oneBoardChildConflict(links, "6", "sA")).toBe(false);
    expect(oneBoardChildConflict(links, 7, "sA")).toBe(false);
  });
});

describe("(5) 반 전체 글 가드", () => {
  it("⭐ 보드 번호로 0302a 기록의 반 하나가 정해질 때만 — 이름으로는 잇지 않는다", async () => {
    const f = fakeSql(() => [
      { board_id: 11, board_name: "같은 이름", class_id: "A" },
      { board_id: 12, board_name: "같은 이름", class_id: "B" },
    ]);
    const map = await loadClassBoardClasses(f.sql, T, ["math"]);
    expect(classBoardClassOf(map, { cls: 12 }).board?.classId).toBe("B");
    expect(classBoardClassOf(map, { cls: null })).toEqual({ board: null, blocked: "보드 번호 없음" });
    expect(classBoardClassOf(map, { cls: 999 })).toEqual({ board: null, blocked: null }); // 영어·그룹반 — 대상 아님
  });

  it("한 번호가 두 반을 가리키면(유니크 인덱스가 막지만) 알리지 않는다", async () => {
    const f = fakeSql(() => [
      { board_id: 11, board_name: "x", class_id: "A" },
      { board_id: 11, board_name: "x", class_id: "B" },
    ]);
    const map = await loadClassBoardClasses(f.sql, T, ["math"]);
    expect(classBoardClassOf(map, { cls: 11 }).blocked).toBe("보드↔반 연결이 하나가 아님");
  });

  it("⭐ 막힌 글은 로그 + gWide로 세고, 담당 조회를 하지 않는다", async () => {
    const logs: string[] = [];
    const stats = newGuardStats();
    const f = fakeSql((text) => (text.includes("from classnote_class_boards") ? [{ board_id: 11, board_name: "x", class_id: "A" }] : []));
    const got = await classWideTargets(f.sql, T, ["math"], [{ cls: null, className: "x" }], (m: string) => logs.push(m), stats, { today: TODAY });
    expect(got).toEqual([]);
    expect(stats.gWide).toBe(1);
    expect(logs.join()).toMatch(/보드 번호 없음/);
    expect(f.queries.some((x) => x.includes("from classes where"))).toBe(false);
  });

  it("반 보드에 없는 글(영어·그룹반)은 대상이 아니다 — 조용히 지나간다", async () => {
    const stats = newGuardStats();
    const f = fakeSql((text) => (text.includes("from classnote_class_boards") ? [{ board_id: 11, board_name: "중등M", class_id: "A" }] : []));
    expect(await classWideTargets(f.sql, T, ["math"], [{ cls: 999, className: "[EIE] Let's Speak" }], () => {}, stats, { today: TODAY })).toEqual([]);
    expect(stats.gWide).toBe(0);
  });

  it("종강 반 보드 글은 아무에게도 안 간다", () => {
    const got = classWideRecipients({ classInfo: cls("HA", { isActive: false }), users: new Map([["HA", u()]]), keys: ["math"], tenant: T, today: TODAY });
    expect(got.ids).toEqual([]);
  });

  it("조회가 실패하면 건너뛰고(로그 + gFallback) 다른 알림을 막지 않는다", async () => {
    const logs: string[] = [];
    const stats = newGuardStats();
    const f = fakeSql(() => new Error("boom"));
    expect(await classWideTargets(f.sql, T, ["math"], [{ cls: 1, className: "x" }], (m: string) => logs.push(m), stats)).toEqual([]);
    expect(stats.gFallback).toBe(1);
    expect(logs.join()).toMatch(/건너뜁니다.*boom/);
  });
});

describe("(6) 폴백 가드", () => {
  const baseRoute = (text: string) => (text.includes("join users u on u.id = c.teacher_id") ? [{ student_id: "s1", teacher_id: "HA" }] : null);

  it("⭐ 새 계산이 실패하면 지금 반 담임에게만 보내고 사유를 남긴다", async () => {
    const logs: string[] = [];
    const f = fakeSql((text) => baseRoute(text) ?? new Error("relation does not exist"));
    const got = await recipientsFor(f.sql, T, ["s1"], ["math"], (m: string) => logs.push(m), { today: TODAY });
    expect(got.byStudent.get("s1")?.ids).toEqual(["HA"]);
    expect(got.fallback).toMatch(/relation does not exist/);
    expect(logs.join()).toMatch(/지금 반 담임에게만.*사유: relation does not exist/);
  });

  it("⭐ 폴백은 넓히지 않는다 — 담임만, 활성·학생 계정 아님·운영 반·보드 과목·오늘 다니는 수강", async () => {
    const f = fakeSql((text) => baseRoute(text) ?? new Error("x"));
    await recipientsFor(f.sql, T, ["s1"], ["math"], () => {}, { today: TODAY });
    const q = f.queries.find((x) => x.includes("join users u on u.id = c.teacher_id"))!;
    expect(q).not.toMatch(/class_schedules|class_delegations/);
    expect(q).toMatch(/u\.status = 'active' and u\.system_role <> 'student'/);
    expect(q).toMatch(/c\.is_active/);
    expect(q).toMatch(/c\.subject in/);
    expect(q).toMatch(/e\.start_date <= /);
    expect(q).toMatch(/e\.end_date = \?::date and not e\.is_transferred/);
    expect(q, "옛 판정(end_date is null만)으로 돌아가면 안 된다").not.toMatch(/and e\.end_date is null\n/);
  });

  it("⭐ 새 계산은 읽기 전용 + 문장 시간 제한 안에서 돈다", async () => {
    const f = fakeSql(() => []);
    await recipientsFor(f.sql, T, ["s1"], ["math"], () => {}, { today: TODAY });
    const begin = f.queries.indexOf("BEGIN read only");
    expect(begin).toBeGreaterThanOrEqual(0);
    expect(f.queries[begin + 1]).toMatch(/set_config\('statement_timeout'/);
    expect(f.queries.findIndex((x) => x.includes("from enrollments e\n    where"))).toBeGreaterThan(begin);
  });

  it("시간 초과도 실패로 떨어져 담임 폴백", async () => {
    const logs: string[] = [];
    const f = fakeSql((text) => baseRoute(text) ?? dbRoute({ verified: new Error("canceling statement due to statement timeout") })(text));
    const got = await recipientsFor(f.sql, T, ["s1"], ["math"], (m: string) => logs.push(m), { today: TODAY });
    expect(got.fallback).toMatch(/statement timeout/);
    expect(got.byStudent.get("s1")?.ids).toEqual(["HA"]);
  });

  it("상한에 걸려 좁혀지면 경고 로그", async () => {
    const logs: string[] = [];
    const many = ["HA", "S1", "S2", "S3", "S4", "S5"];
    const f = fakeSql(dbRoute({ slotTeachers: many.slice(1), verified: many }));
    const got = await recipientsFor(f.sql, T, ["s1"], ["math"], (m: string) => logs.push(m), { today: TODAY });
    expect(got.byStudent.get("s1")?.ids).toEqual(["HA"]);
    expect(logs.join()).toMatch(/지금 반 담임만으로 좁혔습니다/);
  });

  it("재검증이 사람을 빼면 경고로 남긴다(조용한 유실 방지)", async () => {
    const logs: string[] = [];
    const f = fakeSql(dbRoute({ slotTeachers: ["SUB"], verified: ["HA"] }));
    await recipientsFor(f.sql, T, ["s1"], ["math"], (m: string) => logs.push(m), { today: TODAY });
    expect(logs.join()).toMatch(/⚠️ 재검증에서 1명 제외/);
  });
});

describe("(7) 중복 가드", () => {
  it("같은 글·같은 사람은 한 줄만, 다른 글이면 같은 사람도 따로", () => {
    const rows = [
      { dedupeKey: "post:1", recipient_id: "HA" },
      { dedupeKey: "post:1", recipient_id: "HA" },
      { dedupeKey: "post:1", recipient_id: "SUB" },
      { dedupeKey: "post:2", recipient_id: "HA" },
    ];
    const got = dedupePlanRows(rows);
    expect(got.rows.map((r) => `${r.dedupeKey}|${r.recipient_id}`)).toEqual(["post:1|HA", "post:1|SUB", "post:2|HA"]);
    expect(got.dropped).toBe(1);
  });

  it("⭐ id가 없는 댓글끼리는 뭉치지 않는다(중복 가드가 정상 알림을 지우면 안 된다)", () => {
    expect(eventDedupeKey("comment", 91, 1)).toBe("comment:91");
    expect(eventDedupeKey("comment", 91, 2)).toBe("comment:91");
    expect(eventDedupeKey("comment", undefined, 1)).not.toBe(eventDedupeKey("comment", undefined, 2));
    expect(eventDedupeKey("post", 91, 1)).not.toBe(eventDedupeKey("comment", 91, 1));
  });

  it("⭐ 알림 insert는 워터마크·스냅샷을 다시 잠근 같은 트랜잭션 안에서만(기존 멱등 유지)", () => {
    const src = fs.readFileSync(path.resolve(process.cwd(), "scripts/_classnote/classnote-feed-core.mjs"), "utf8");
    const inserts = [...src.matchAll(/insert into notifications/g)].length;
    expect(inserts).toBe(2);
    for (const scope of ["where tenant_id = ${tenant} and scope = ${SCOPE} for update", "where tenant_id = ${tenant} and scope = ${COMMENT_SCOPE} for update"]) {
      expect(src).toContain(scope);
    }
    expect(src.match(/dedupePlanRows\(planRows\)/g)?.length).toBe(2);
  });
});

describe("(8) 기능 스위치·지점 가드", () => {
  const noBrowser = new Proxy({}, { get: () => { throw new Error("브라우저를 쓰면 안 된다"); } });
  for (const [name, poll] of [["새 글", pollParentPostsOnce], ["댓글", pollParentCommentsOnce]] as const) {
    it(`⭐ ${name} — ClassNote 기능이 꺼진 지점은 피드 조회도 수신자 계산도 안 한다`, async () => {
      const f = fakeSql((text) => (text.includes("from tenant_settings") ? [{ off: true }] : new Error("다른 조회를 하면 안 된다")));
      const got = await poll(f.sql as never, noBrowser as never, { tenant: T, post: true, force: true, log: () => {} });
      expect(got).toEqual({ ran: false, moduleOff: 1 });
      expect(f.queries).toHaveLength(1);
    });
    it(`${name} — 지점을 모르면 아무 조회도 안 한다`, async () => {
      const f = fakeSql(() => new Error("조회하면 안 된다"));
      const got = await poll(f.sql as never, noBrowser as never, { tenant: "", post: true, force: true, log: () => {} });
      expect(got).toEqual({ ran: false, moduleOff: 1 });
      expect(f.queries).toHaveLength(0);
    });
  }
});

describe("가드 집계는 하트비트 구조를 깨지 않는다", () => {
  it("숫자 칸만이고, 워커 카드에는 모르는 칸이라 그려지지 않는다(raw 키 노출 없음)", () => {
    const stats = { ...newGuardStats(), gStudent: 2, gSubject: 81 };
    for (const v of Object.values(stats)) expect(typeof v).toBe("number");
    const rows = formatWorkerResults({ posts: { at: "2026-09-30T01:00:00Z", notified: 3, ...stats } });
    expect(rows[0].text).toContain("알림 3");
    expect(rows[0].text).not.toMatch(/g[A-Z]/);
  });
});

describe("1인 보드 대상 집합", () => {
  it("⭐ 퇴원 예약(미래 종료일) 학생도 보드 신원을 잃지 않는다", () => {
    const src = fs.readFileSync(path.resolve(process.cwd(), "scripts/_classnote/classnote-feed-core.mjs"), "utf8");
    const fn = src.slice(src.indexOf("export async function boardsToStudents"), src.indexOf("async function loadClassBoardChildMap"));
    expect(fn).toMatch(/e\.end_date is null or e\.end_date >= \$\{today\}::date/);
  });
});

/**
 * 학생 s1 · 수학 반 A(담임 HA) · 교시 담당 `slotTeachers` · 재검증이 확인해 줄 사람 `verified`(Error면 그 쿼리가 실패)인 가짜 DB.
 * 폴백 쿼리(담임만)는 여기서 답하지 않는다(null → 호출부 라우트가 정한다).
 */
function dbRoute({ slotTeachers = [] as string[], verified = ["HA"] as string[] | Error } = {}) {
  const people = ["HA", ...slotTeachers];
  return (text: string): unknown[] | Error | null => {
    if (text.includes("from enrollments e\n    where")) return [{ student_id: "s1", class_id: "A", start_date: "2026-03-02", end_date: null, is_transferred: false }];
    if (text.includes("from classes where")) return [{ id: "A", subject: "math", is_active: true, teacher_id: "HA" }];
    if (text.includes("select class_id, teacher_id, slot_teacher_label"))
      return slotTeachers.map((id) => ({ class_id: "A", teacher_id: id, slot_teacher_label: null, valid_from: "2026-09-01", valid_to: null }));
    if (text.includes("from users where")) return people.map((id) => ({ id, tenant_id: T, status: "active", role: "teacher" }));
    if (text.includes("u.id as user_id")) return verified instanceof Error ? verified : verified.map((id) => ({ student_id: "s1", user_id: id }));
    return null;
  };
}

/** 태그드 템플릿 `sql` 흉내 — 쿼리 텍스트를 캡처하고, 텍스트로 분기해 행을 돌려준다. `begin`은 같은 흉내로 콜백을 부른다. */
function fakeSql(route: (text: string) => unknown[] | Error | null) {
  const queries: string[] = [];
  const sql = Object.assign(
    (strings: TemplateStringsArray | unknown[]) => {
      if (!("raw" in (strings as TemplateStringsArray))) return strings; // sql(keys) 보간 헬퍼
      const text = (strings as TemplateStringsArray).join("?");
      queries.push(text);
      const r = route(text) ?? [];
      return r instanceof Error ? Promise.reject(r) : Promise.resolve(r);
    },
    {
      begin: async (mode: string, fn: (tx: unknown) => Promise<unknown>) => {
        queries.push(`BEGIN ${mode}`);
        return fn(sql);
      },
    },
  );
  return { sql, queries };
}
