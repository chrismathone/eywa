import { describe, expect, it } from "vitest";
import {
  TAUGHT_STATUSES,
  classWideRecipients,
  mergeRecipientMaps,
  planNotifyRecipients,
} from "../../scripts/_classnote/notify-recipients.mjs";
import { classBoardClassOf, loadClassBoardClasses, loadNotifyRecipients } from "../../scripts/_classnote/notify-recipients-db.mjs";
import { classWideTargets, recipientsFor } from "../../scripts/_classnote/classnote-feed-core.mjs";

/**
 * 학부모 글·댓글 벨 수신자 — 원장 2026-09-30 *"학생을 한번이라도 수업하게 되면 학부모 글, 댓글 알림이 뜨도록"*.
 * 1인 보드엔 가르친 강사가 누적으로 붙어 ClassNote가 전원에게 알렸는데, 반 보드엔 담임 한 명만 붙는다.
 */

const TODAY = "2026-09-30";
const u = (role = "teacher", active = true, name: string | null = null) => ({ active, role, name });
const cls = (homeroomTeacherId: string | null, slots: unknown[] = []) => ({ homeroomTeacherId, slots });

function plan(over: Partial<Parameters<typeof planNotifyRecipients>[0]> = {}) {
  return planNotifyRecipients({
    studentIds: ["s1"],
    currentEnrollments: [{ studentId: "s1", classId: "A" }],
    reportAuthors: [],
    attended: [],
    classes: new Map([["A", cls("HA")]]),
    users: new Map([["HA", u()]]),
    teachingIds: new Set(["HA"]),
    today: TODAY,
    ...over,
  }).get("s1");
}

describe("planNotifyRecipients", () => {
  it("지금 반 담임은 그대로 받는다(기존 수신자)", () => {
    expect(plan()).toEqual(["HA"]);
  });

  it("⭐ 대신 보강한 강사 — 그 학생 보고서를 쓴 강사가 받는다", () => {
    const got = plan({
      reportAuthors: [{ studentId: "s1", userId: "MK" }],
      users: new Map([["HA", u()], ["MK", u()]]),
    });
    expect(got).toEqual(["HA", "MK"]);
  });

  it("⭐ 보강 칸 출결(보강 반·시간표 없는 날) → 그 반 담임이 받는다", () => {
    const got = plan({
      attended: [{ studentId: "s1", classId: "POOL", date: "2026-09-19", slotStart: null }],
      classes: new Map([["A", cls("HA")], ["POOL", cls("MK")]]),
      users: new Map([["HA", u()], ["MK", u()]]),
    });
    expect(got).toEqual(["HA", "MK"]);
  });

  it("반이동 전 반 — 그때 담임(이력)이 받고, 인계받은 새 담임은 가르친 적 없으면 못 받는다", () => {
    const got = plan({
      attended: [{ studentId: "s1", classId: "OLD", date: "2026-05-08", slotStart: null }],
      classes: new Map([["A", cls("HA")], ["OLD", cls("NEWH")]]),
      transitions: [{ classId: "OLD", date: "2026-08-04", teacherId: "NEWH", previousTeacherId: "PREV" }],
      users: new Map([["HA", u()], ["NEWH", u()], ["PREV", u()]]),
    });
    expect(got).toEqual(["HA", "PREV"]);
  });

  it("이전 담임을 모르면 지어내지 않는다(현재 담임을 과거에 붙이지 않는다)", () => {
    const got = plan({
      attended: [{ studentId: "s1", classId: "OLD", date: "2026-05-08", slotStart: null }],
      classes: new Map([["A", cls("HA")], ["OLD", cls("NEWH")]]),
      transitions: [{ classId: "OLD", date: "2026-08-04", teacherId: "NEWH", previousTeacherId: null }],
      users: new Map([["HA", u()], ["NEWH", u()]]),
    });
    expect(got).toEqual(["HA"]);
  });

  it("부담임(오늘 유효한 교시 담당)·오늘 임시 위임도 받는다", () => {
    const got = plan({
      classes: new Map([["A", cls("HA", [{ dayOfWeek: "tue", startTime: "16:20", teacherId: "SUB", slotTeacherLabel: null, validFrom: "2026-09-01", validTo: null }])]]),
      delegations: [{ classId: "A", delegateUserId: "DEL", fromDate: "2026-09-29", toDate: "2026-10-01", revokedAt: null }],
      users: new Map([["HA", u()], ["SUB", u()], ["DEL", u()]]),
    });
    expect(got).toEqual(["HA", "SUB", "DEL"]);
  });

  it("퇴사·비활성은 어느 근거로 와도 뺀다", () => {
    const got = plan({
      reportAuthors: [{ studentId: "s1", userId: "GONE" }],
      attended: [{ studentId: "s1", classId: "B", date: "2026-07-01", slotStart: null }],
      classes: new Map([["A", cls("HA")], ["B", cls("GONE2")]]),
      users: new Map([["HA", u()], ["GONE", u("teacher", false)], ["GONE2", u("teacher", false)]]),
    });
    expect(got).toEqual(["HA"]);
  });

  it("같은 사람은 한 번만(지금 담임 + 보고서 + 출결)", () => {
    const got = plan({
      reportAuthors: [{ studentId: "s1", userId: "HA" }, { studentId: "s1", userId: "HA" }],
      attended: [
        { studentId: "s1", classId: "A", date: "2026-09-01", slotStart: null },
        { studentId: "s1", classId: "A", date: "2026-09-08", slotStart: null },
      ],
    });
    expect(got).toEqual(["HA"]);
  });

  it("사무실 대리 작성자(강사도 아니고 그 과목 반도 없음)는 가르친 사람이 아니다", () => {
    const got = plan({
      reportAuthors: [{ studentId: "s1", userId: "DESK" }, { studentId: "s1", userId: "TEACHADMIN" }],
      users: new Map([["HA", u()], ["DESK", u("admin")], ["TEACHADMIN", u("admin")]]),
      teachingIds: new Set(["HA", "TEACHADMIN"]), // 겸직 관리자(수학 반 담임)는 가르친다
    });
    expect(got).toEqual(["HA", "TEACHADMIN"]);
  });

  it("자리(LAB) 출결은 사람이 아니다 — 담임으로 떨어뜨리지 않는다", () => {
    const got = plan({
      currentEnrollments: [],
      attended: [{ studentId: "s1", classId: "LABC", date: "2026-09-28", slotStart: "16:20" }],
      classes: new Map([["LABC", cls("LH", [{ dayOfWeek: "mon", startTime: "16:20:00", teacherId: null, slotTeacherLabel: "LAB", validFrom: "2026-09-01", validTo: null }])]]),
      users: new Map([["LH", u()]]),
    });
    expect(got).toEqual([]);
  });

  it("출결 상태 — 결석·공결은 수업을 안 받았다", () => {
    expect(TAUGHT_STATUSES).toEqual(["present", "late", "early_leave", "makeup"]);
  });

  describe("인계 기록 없는 반의 현재 담임 폴백 보정(b')", () => {
    // 학생은 지금 A반. 2월에 OLD반을 다녔는데 OLD반엔 인계 로그가 없고 지금 담임은 NEWH다.
    const base = {
      attended: [{ studentId: "s1", classId: "OLD", date: "2026-02-10", slotStart: null }],
      classes: new Map([["A", cls("HA")], ["OLD", cls("NEWH")]]),
    };
    it("⭐ 그 달 그 반 보고서를 다른 강사만 썼으면 지금 담임에게 붙이지 않는다", () => {
      const got = plan({
        ...base,
        classMonthWriters: [{ classId: "OLD", month: "2026-02", userId: "PREV" }],
        users: new Map([["HA", u()], ["NEWH", u()], ["PREV", u("teacher", false)]]), // 전임은 퇴사 — 근거로는 센다
      });
      expect(got).toEqual(["HA"]);
    });
    it("그 달 보고서를 지금 담임도 썼으면 그대로", () => {
      const got = plan({
        ...base,
        classMonthWriters: [{ classId: "OLD", month: "2026-02", userId: "PREV" }, { classId: "OLD", month: "2026-02", userId: "NEWH" }],
        users: new Map([["HA", u()], ["NEWH", u()], ["PREV", u()]]),
      });
      expect(got).toEqual(["HA", "NEWH"]);
    });
    it("⭐ 이관분(작성자 없음)은 보고서 강사 이름으로 본다 — 다른 강사 이름만 있으면 뺀다", () => {
      const got = plan({
        ...base,
        classMonthWriters: [{ classId: "OLD", month: "2026-02", userId: null, teacherName: "이승아" }],
        users: new Map([["HA", u()], ["NEWH", u("teacher", true, "남정화")]]),
      });
      expect(got).toEqual(["HA"]);
    });
    it("이관분 이름이 지금 담임이면 그대로(이름은 빼기에만 쓴다 — 이름으로 사람을 더하지 않는다)", () => {
      const got = plan({
        ...base,
        classMonthWriters: [
          { classId: "OLD", month: "2026-02", userId: null, teacherName: " 남정화 " },
          { classId: "OLD", month: "2026-02", userId: null, teacherName: "이승아" },
        ],
        users: new Map([["HA", u()], ["NEWH", u("teacher", true, "남정화")], ["PREV", u("teacher", true, "이승아")]]),
      });
      expect(got).toEqual(["HA", "NEWH"]);
    });
    it("그 달 보고서가 없으면(근거 없음) 앱 규칙대로 지금 담임", () => {
      const got = plan({ ...base, users: new Map([["HA", u()], ["NEWH", u()]]) });
      expect(got).toEqual(["HA", "NEWH"]);
    });
    it("사무실 대리 작성만 있는 달은 반박 근거가 아니다", () => {
      const got = plan({
        ...base,
        classMonthWriters: [{ classId: "OLD", month: "2026-02", userId: "DESK" }],
        users: new Map([["HA", u()], ["NEWH", u()], ["DESK", u("admin")]]),
      });
      expect(got).toEqual(["HA", "NEWH"]);
    });
    it("교시 담당으로 명시된 사람은 안 건드린다", () => {
      const got = plan({
        attended: [{ studentId: "s1", classId: "OLD", date: "2026-02-09", slotStart: null }], // 월요일
        classes: new Map([["A", cls("HA")], ["OLD", cls("NEWH", [{ dayOfWeek: "mon", startTime: "16:20", teacherId: "NEWH", slotTeacherLabel: null, validFrom: "2026-01-01", validTo: null }])]]),
        classMonthWriters: [{ classId: "OLD", month: "2026-02", userId: "PREV" }],
        users: new Map([["HA", u()], ["NEWH", u()], ["PREV", u()]]),
      });
      expect(got).toEqual(["HA", "NEWH"]);
    });
    it("지금 다니는 반의 담임(①)은 과거 달 보정과 무관하게 받는다", () => {
      const got = plan({
        attended: [{ studentId: "s1", classId: "A", date: "2026-02-10", slotStart: null }],
        classMonthWriters: [{ classId: "A", month: "2026-02", userId: "PREV" }],
        users: new Map([["HA", u()], ["PREV", u()]]),
      });
      expect(got).toEqual(["HA"]);
    });
  });
});

describe("반 전체 글(학생 미확정)", () => {
  it("그 반을 지금 맡은 사람만 — 가르친 이력으로 넓히지 않는다", () => {
    const users = new Map([["HA", u()], ["SUB", u()], ["GONE", u("teacher", false)]]);
    const classInfo = cls("HA", [
      { dayOfWeek: "wed", startTime: "16:20", teacherId: "SUB", slotTeacherLabel: null, validFrom: "2026-09-01", validTo: null },
      { dayOfWeek: "wed", startTime: "18:20", teacherId: "GONE", slotTeacherLabel: null, validFrom: "2026-09-01", validTo: null },
    ]);
    expect(classWideRecipients({ classInfo, users, today: TODAY })).toEqual(["HA", "SUB"]);
    expect(classWideRecipients({ classInfo: undefined, users, today: TODAY })).toEqual([]);
  });

  it("보드 번호가 있으면 번호로만 찾는다(개명 대비)", () => {
    const map = new Map([["#1317089", { classId: "A", boardName: "중등M 중3 BS3Q" }], ["이름:중등M 중3 BS3Q", { classId: "A", boardName: "중등M 중3 BS3Q" }]]);
    expect(classBoardClassOf(map, { cls: 1317089, className: "옛 이름" })?.classId).toBe("A");
    expect(classBoardClassOf(map, { cls: 999, className: "중등M 중3 BS3Q" })).toBeNull();
    expect(classBoardClassOf(map, { cls: null, className: "중등M 중3 BS3Q" })?.classId).toBe("A");
    expect(classBoardClassOf(map, { cls: null, className: "[EIE] Let's Speak" })).toBeNull(); // 영어 그룹반은 없다
  });
});

it("mergeRecipientMaps — 기존 수신자는 절대 빠지지 않는다", () => {
  const got = mergeRecipientMaps(new Map([["s1", ["HA"]], ["s2", ["HB"]]]), new Map([["s1", ["MK", "HA"]]]));
  expect(got.get("s1")).toEqual(["HA", "MK"]);
  expect(got.get("s2")).toEqual(["HB"]);
});

/** 태그드 템플릿 `sql` 흉내 — 쿼리 텍스트를 캡처하고, 텍스트로 분기해 행을 돌려준다. `begin`은 같은 흉내로 콜백을 부른다. */
function fakeSql(route: (text: string) => unknown[] | Error) {
  const queries: string[] = [];
  const sql = Object.assign(
    (strings: TemplateStringsArray | unknown[]) => {
      if (!("raw" in (strings as TemplateStringsArray))) return strings; // sql(keys) 보간 헬퍼
      const text = (strings as TemplateStringsArray).join("?");
      queries.push(text);
      const r = route(text);
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

describe("조회 모양 트립와이어", () => {
  it("⭐ 학생 기록 조회는 전부 보드 과목으로 좁힌다 — 수학 보드 글에 영어 강사가 끼지 않게", async () => {
    const f = fakeSql(() => []);
    await loadNotifyRecipients(f.sql, "t1", ["s1"], ["math"], { today: TODAY });
    for (const table of ["from enrollments", "from lesson_reports", "from attendance_records"]) {
      const q = f.queries.find((x) => x.includes(table));
      expect(q, `${table} 조회가 없다`).toBeTruthy();
      expect(q, `${table}을 과목으로 안 좁혔다`).toMatch(/subject\)? in/);
    }
    const att = f.queries.find((x) => x.includes("from attendance_records"));
    expect(att, "자리(LAB·JJ) 문이 찍은 출결을 빼야 한다").toMatch(/coalesce\(trim\(a\.seat_label\), ''\) = ''/);
    expect(att).toMatch(/coalesce\(a\.recorded_via, ''\) <> 'seat'/);
    // 학생 id는 배열 파라미터 하나 — 큰 in(...) 나열이 아니다(B3)
    expect(f.queries.filter((x) => x.includes("= any(")).length).toBeGreaterThanOrEqual(3);
  });

  it("⭐ 넓히는 계산이 실패해도 지금 담당에게는 그대로 간다(알림을 잃지 않는다)", async () => {
    const logs: string[] = [];
    const f = fakeSql((text) => {
      if (text.includes("join users u on u.id = c.teacher_id")) return [{ student_id: "s1", teacher_id: "HA" }]; // 기존 teachersFor
      return new Error("relation does not exist");
    });
    const got = await recipientsFor(f.sql, "t1", ["s1"], ["math"], (m: string) => logs.push(m));
    expect(got.get("s1")).toEqual(["HA"]);
    expect(logs.join()).toMatch(/지금 담당에게만/);
  });

  it("⭐ 넓히는 조회는 읽기 전용 + 문장 시간 제한 안에서 돈다(연결 하나짜리 데몬을 붙잡지 않게)", async () => {
    const f = fakeSql((text) => (text.includes("join users u on u.id = c.teacher_id") ? [{ student_id: "s1", teacher_id: "HA" }] : []));
    await recipientsFor(f.sql, "t1", ["s1"], ["math"], () => {});
    const begin = f.queries.indexOf("BEGIN read only");
    expect(begin, "읽기 전용 트랜잭션이 없다").toBeGreaterThanOrEqual(0);
    expect(f.queries[begin + 1]).toMatch(/set_config\('statement_timeout'/);
    // 넓히는 조회(수강·보고서·출결)는 전부 그 트랜잭션 뒤에 온다
    const firstWide = f.queries.findIndex((x) => x.includes("from lesson_reports"));
    expect(firstWide).toBeGreaterThan(begin);
  });

  it("⭐ 시간 초과도 실패로 떨어져 지금 담당에게 간다", async () => {
    const logs: string[] = [];
    const f = fakeSql((text) => {
      if (text.includes("join users u on u.id = c.teacher_id")) return [{ student_id: "s1", teacher_id: "HA" }];
      if (text.includes("from attendance_records")) return new Error("canceling statement due to statement timeout");
      return [];
    });
    const got = await recipientsFor(f.sql, "t1", ["s1"], ["math"], (m: string) => logs.push(m));
    expect(got.get("s1")).toEqual(["HA"]);
    expect(logs.join()).toMatch(/statement timeout/);
  });
});

describe("반 전체 글 대상", () => {
  it("보드명이 두 반에 겹치면 이름으로는 잇지 않는다(번호로는 그대로)", async () => {
    const f = fakeSql(() => [
      { board_id: 11, board_name: "같은 이름", class_id: "A" },
      { board_id: 12, board_name: "같은 이름", class_id: "B" },
      { board_id: 13, board_name: "다른 이름", class_id: "C" },
    ]);
    const map = await loadClassBoardClasses(f.sql, "t1", ["math"]);
    expect(classBoardClassOf(map, { cls: null, className: "같은 이름" })).toBeNull();
    expect(classBoardClassOf(map, { cls: 12, className: "같은 이름" })?.classId).toBe("B");
    expect(classBoardClassOf(map, { cls: null, className: "다른 이름" })?.classId).toBe("C");
  });

  it("조회가 실패하면 건너뛰고(로그) 다른 알림을 막지 않는다", async () => {
    const logs: string[] = [];
    const f = fakeSql(() => new Error("boom"));
    const got = await classWideTargets(f.sql, "t1", ["math"], [{ cls: 1, className: "x" }], (m: string) => logs.push(m));
    expect(got).toEqual([]);
    expect(logs.join()).toMatch(/건너뜁니다/);
  });

  it("반 보드에 없는 글(영어·그룹반)은 대상이 아니다 — 담당 조회도 안 한다", async () => {
    const f = fakeSql((text) => (text.includes("from classnote_class_boards") ? [{ board_id: 11, board_name: "중등M 중3 BS3Q", class_id: "A" }] : []));
    const got = await classWideTargets(f.sql, "t1", ["math"], [{ cls: 999, className: "[EIE] Let's Speak" }], () => {});
    expect(got).toEqual([]);
    expect(f.queries.some((x) => x.includes("from classes where"))).toBe(false);
  });
});
