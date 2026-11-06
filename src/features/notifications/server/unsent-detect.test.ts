import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 미발송 보고서 감지(`detectUnsentReports`)를 **가짜 DB로 통째로** 돌린다 — 조회 칸·받는 사람·하루 한 번·최대 3번·
 * 원장 1회분·콜드스타트·조회 순서가 실제 배선에서 지켜지는지(적대 리뷰 2026-11-05 I2: `toContain` 글자 검사는 select에서
 * `created_at`을 빼도 통과했다). 가짜 DB는 PostgREST를 흉내 낸다 — **select에 적은 칸만** 돌려주고, 필터·정렬·상한을 따른다.
 * 결석 게이트·학원 설정·알림 넣기만 바꿔 끼운다. 합성 값만 쓴다.
 */
type Row = Record<string, unknown>;

const m = vi.hoisted(() => ({
  tables: {} as Record<string, Record<string, unknown>[]>,
  notified: [] as { recipientId: string; title: string; body?: string | null; taskIds?: readonly string[] }[],
  tasks: new Map<string, string>(),
  absent: new Set<string>(),
  settings: {} as Record<string, unknown>,
}));

vi.mock("@/features/owner/server/queries", () => ({ getTenantSettingsByTenantId: async () => m.settings }));
vi.mock("@/features/notifications/server/notify", () => ({
  notifyUsers: async (items: typeof m.notified) => {
    m.notified.push(...items);
  },
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    throw new Error("시험은 가짜 admin을 직접 넘긴다");
  },
}));
vi.mock("@/features/dashboard/server/queries", () => ({ getAbsenceRiskStudents: vi.fn() }));
vi.mock("@/lib/observability/report-error", () => ({ reportError: vi.fn(), reportWarning: vi.fn() }));
vi.mock("@/features/onescreen/server/absence-gate", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getAbsenceBlockedKeys: async () => new Set(m.absent),
}));

import { detectUnsentReports } from "@/features/notifications/server/events";

// ─────────── 가짜 PostgREST ───────────
const FOREIGN: Record<string, string> = { student_id: "students" };

/** select 문자열 → 칸 목록(괄호 안 쉼표는 나누지 않는다). */
function columnsOf(select: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of select) {
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (ch === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function project(row: Row, select: string): Row {
  const out: Row = {};
  for (const col of columnsOf(select)) {
    if (col === "*") Object.assign(out, row);
    const embed = /^(\w+):(\w+)\s*\(\s*([\w\s,]+)\)$/.exec(col);
    if (embed) {
      const [, alias, fk, inner] = embed;
      const target = (m.tables[FOREIGN[fk!]!] ?? []).find((t) => t.id === row[fk!]);
      out[alias!] = target ? project(target, inner!) : null;
    } else if (col !== "*" && col in row) out[col] = row[col];
  }
  return out;
}

type State = {
  table: string;
  select: string;
  head: boolean;
  filters: ((row: Row) => boolean)[];
  order: { col: string; asc: boolean } | null;
  limit: number | null;
  range: [number, number] | null;
  upsert: { rows: Row[]; onConflict: string[] } | null;
};

function run(s: State): { data: Row[] | null; count?: number; error: null } {
  const table = (m.tables[s.table] ??= []);
  if (s.upsert) {
    const inserted: Row[] = [];
    for (const row of s.upsert.rows) {
      const clash = table.some((t) => s.upsert!.onConflict.every((k) => t[k] === row[k]));
      if (clash) continue; // ignoreDuplicates
      const stored = { id: `ev${table.length + 1}`, created_at: new Date().toISOString(), ...row };
      table.push(stored);
      inserted.push(stored);
    }
    return { data: inserted.map((row) => project(row, s.select)), error: null };
  }
  let rows = table.filter((row) => s.filters.every((f) => f(row)));
  if (s.order) {
    const { col, asc } = s.order;
    rows = [...rows].sort((a, b) => String(a[col]).localeCompare(String(b[col])) * (asc ? 1 : -1));
  }
  if (s.range) rows = rows.slice(s.range[0], s.range[1] + 1);
  if (s.limit !== null) rows = rows.slice(0, s.limit);
  if (s.head) return { data: null, count: rows.length, error: null };
  return { data: rows.map((row) => project(row, s.select)), error: null };
}

function fakeAdmin() {
  const from = (table: string) => {
    const s: State = { table, select: "*", head: false, filters: [], order: null, limit: null, range: null, upsert: null };
    const value = (row: Row, col: string) => row[col] ?? null;
    const chain = {
      select(cols = "*", opts?: { head?: boolean }) {
        s.select = cols;
        if (opts?.head) s.head = true;
        return chain;
      },
      eq(col: string, v: unknown) {
        s.filters.push((row) => value(row, col) === v);
        return chain;
      },
      neq(col: string, v: unknown) {
        s.filters.push((row) => value(row, col) !== v);
        return chain;
      },
      is(col: string, v: unknown) {
        s.filters.push((row) => value(row, col) === v);
        return chain;
      },
      in(col: string, vs: unknown[]) {
        s.filters.push((row) => vs.includes(value(row, col)));
        return chain;
      },
      gte(col: string, v: string) {
        s.filters.push((row) => String(value(row, col)) >= v);
        return chain;
      },
      lte(col: string, v: string) {
        s.filters.push((row) => String(value(row, col)) <= v);
        return chain;
      },
      /** `a.is.null,a.neq.x` 꼴만(이 감지가 쓰는 것). */
      or(expr: string) {
        const parts = expr.split(",").map((p) => p.split("."));
        s.filters.push((row) =>
          parts.some(([col, op, v]) => (op === "is" && v === "null" ? value(row, col!) === null : op === "neq" ? value(row, col!) !== v : false)),
        );
        return chain;
      },
      order(col: string, opts?: { ascending?: boolean }) {
        s.order = { col, asc: opts?.ascending !== false };
        return chain;
      },
      limit(n: number) {
        s.limit = n;
        return chain;
      },
      range(a: number, b: number) {
        s.range = [a, b];
        return chain;
      },
      upsert(rows: Row[], opts: { onConflict: string; ignoreDuplicates?: boolean }) {
        s.upsert = { rows, onConflict: opts.onConflict.split(",") };
        return chain;
      },
      then(resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) {
        return Promise.resolve().then(() => run(s)).then(resolve, reject);
      },
    };
    return chain;
  };
  return {
    from,
    rpc: async (name: string, args: { p_reports: string[] }) =>
      name === "staff_task_sync_unsent"
        ? { data: args.p_reports.flatMap((id) => (m.tasks.has(id) ? [{ report_id: id, task_id: m.tasks.get(id) }] : [])), error: null }
        : { data: null, error: { message: `모르는 rpc ${name}` } },
  };
}

// ─────────── 합성 학원 ───────────
const T = "tenant-1";
/** KST 날짜 → 그날 아침 7시(cron 시각)의 UTC 시각. */
const at7 = (ymd: string) => new Date(`${ymd}T07:00:00+09:00`);
/** KST 날짜·시각 → ISO(작성 시각). */
const kst = (ymd: string, hm = "18:00") => new Date(`${ymd}T${hm}:00+09:00`).toISOString();

const report = (id: string, p: Row): Row => ({
  id,
  tenant_id: T,
  student_id: "s1",
  subject: "math",
  class_id: "cA",
  makeup_class_id: null,
  makeup: false,
  notes: "오늘 함수 단원을 마쳤습니다.",
  classnote_status: null,
  revoked_at: null,
  source: "onescreen",
  created_by: "uAuthor",
  ...p,
});

function seed(opts: { events?: Row[] } = {}) {
  m.tables = {
    users: [
      { id: "uAuthor", tenant_id: T, status: "active", system_role: "teacher" },
      { id: "uTeacherA", tenant_id: T, status: "active", system_role: "teacher" },
      { id: "uTeacherB", tenant_id: T, status: "active", system_role: "teacher" },
      { id: "uMakeup", tenant_id: T, status: "active", system_role: "teacher" },
      { id: "uGone", tenant_id: T, status: "inactive", system_role: "teacher" },
      { id: "uMaster", tenant_id: T, status: "active", system_role: "master" },
    ],
    classes: [
      { id: "cA", tenant_id: T, teacher_id: "uTeacherA", is_active: true, report_optout: false },
      // 같은 학생의 다른 반 담임 — 이 보고서를 쓰지도 보내지도 않는다(받으면 안 된다).
      { id: "cB", tenant_id: T, teacher_id: "uTeacherB", is_active: true, report_optout: false },
      { id: "cMk", tenant_id: T, teacher_id: "uMakeup", is_active: true, report_optout: false },
      { id: "cNone", tenant_id: T, teacher_id: null, is_active: true, report_optout: false },
    ],
    students: [
      { id: "s1", tenant_id: T, name: "김민준", is_test: false },
      { id: "s2", tenant_id: T, name: "이서연", is_test: false },
      { id: "sTest", tenant_id: T, name: "학원이", is_test: true },
    ],
    enrollments: [
      { tenant_id: T, student_id: "s1", class_id: "cA" },
      { tenant_id: T, student_id: "s1", class_id: "cB" },
    ],
    lesson_reports: [
      report("rAuthor", { report_date: "2026-11-03", created_at: kst("2026-11-03") }), // 작성자 = 반 담임 아님
      report("rGone", { student_id: "s2", report_date: "2026-11-04", created_at: kst("2026-11-04"), created_by: "uGone" }), // 퇴사 → 반 담임
      report("rMakeup", { report_date: "2026-11-02", created_at: kst("2026-11-02"), class_id: null, makeup: true, makeup_class_id: "cMk", created_by: null }),
      report("rOrphan", { student_id: "s2", report_date: "2026-11-02", created_at: kst("2026-11-02"), class_id: "cNone", created_by: null }),
      report("rToday", { report_date: "2026-11-04", created_at: kst("2026-11-05", "01:30"), class_id: "cB" }), // 오늘 새벽 저장
      report("rTest", { student_id: "sTest", report_date: "2026-11-03", created_at: kst("2026-11-03") }),
      report("rNoMent", { report_date: "2026-11-03", created_at: kst("2026-11-03"), notes: "  " }),
      report("rTooOld", { report_date: "2026-10-29", created_at: kst("2026-10-29") }),
      report("rEdutrix", { report_date: "2026-11-03", created_at: kst("2026-11-03"), source: "edutrix_import" }),
      report("rSent", { report_date: "2026-11-03", created_at: kst("2026-11-03"), classnote_status: "success" }),
    ],
    // 콜드스타트가 아니게 — 이 학원은 예전부터 이 알림을 써 왔다.
    notification_events: opts.events ?? [
      { id: "old", tenant_id: T, event_type: "unsent_report", subject_key: "옛보고서", bucket: "unsent", seeded: false, created_at: kst("2026-10-20") },
    ],
  };
}

const runOn = async (ymd: string) => {
  vi.setSystemTime(at7(ymd));
  m.notified = [];
  const n = await detectUnsentReports(fakeAdmin() as never, T);
  return { n, notified: m.notified };
};
const bodiesFor = (notified: typeof m.notified, recipientId: string) =>
  notified.filter((item) => item.recipientId === recipientId).map((item) => item.body);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  m.tasks = new Map([["rAuthor", "task-rAuthor"]]);
  m.absent = new Set();
  m.settings = {
    modules: { disabled: [] },
    report: { classnoteSendEnabled: true, classnoteSubjects: ["math"], classnoteSendWindowStart: "08:30", classnoteSendWindowEnd: "22:30" },
    operations: { subjects: [{ key: "math", label: "수학", color: "blue" }] },
  };
  seed();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("미발송 보고서 감지 — 가짜 DB로 통째로", () => {
  it("받는 사람은 보고서마다 한 곳 — 작성자 · 퇴사면 반 담임 · 보강은 앵커 반 담임 · 아무도 없으면 원장", async () => {
    const { notified } = await runOn("2026-11-05");
    expect(bodiesFor(notified, "uAuthor")).toEqual([
      "김민준 학생 11/3 수학 수업 보고서(11/3 저장)가 지금 미발송 상태입니다 — 11/9 22:30까지만 보낼 수 있습니다.",
    ]);
    expect(bodiesFor(notified, "uTeacherA")).toEqual([
      "이서연 학생 11/4 수학 수업 보고서(11/4 저장)가 지금 미발송 상태입니다 — 11/10 22:30까지만 보낼 수 있습니다.",
    ]);
    expect(bodiesFor(notified, "uMakeup")).toEqual([
      "김민준 학생 11/2 수학 수업 보고서(11/2 저장)가 지금 미발송 상태입니다 — 11/8 22:30까지만 보낼 수 있습니다.",
    ]);
    const master = notified.filter((item) => item.recipientId === "uMaster");
    expect(master.map((item) => [item.title, item.body])).toEqual([
      ["미발송 수업 보고서(담당 강사 없음)", "이서연 학생 2026-11-02 수학 수업 보고서가 저장만 되고 아직 발송되지 않았습니다."],
    ]);
    // 같은 학생의 다른 반 담임 · 오늘 새벽 저장분(rToday) · 게이트에 걸린 것(테스트 학생·빈 멘트·기한·이관·발송됨)은 없다.
    expect(bodiesFor(notified, "uTeacherB")).toEqual([]);
    expect(notified).toHaveLength(4);
  });

  it("할 일이 있는 보고서는 그 알림에 할 일을 잇는다(받는 사람이 할 일 담당이 아니어도)", async () => {
    const { notified } = await runOn("2026-11-05");
    expect(notified.find((item) => item.recipientId === "uAuthor")?.taskIds).toEqual(["task-rAuthor"]);
    expect(notified.find((item) => item.recipientId === "uTeacherA")?.taskIds).toEqual([]);
  });

  it("같은 날 다시 돌면 아무것도 안 울리고, 날마다 돌리면 직원 몫은 보고서당 3번 · 원장 1회분은 한 번", async () => {
    const first = await runOn("2026-11-05");
    expect(first.n).toBe(4);
    expect((await runOn("2026-11-05")).notified).toEqual([]); // 손으로 다시 돌린 cron
    const days: Record<string, string[]> = {};
    for (const day of ["2026-11-06", "2026-11-07", "2026-11-08", "2026-11-09"]) {
      for (const item of (await runOn(day)).notified) (days[day] ??= []).push(`${item.recipientId} ${item.body}`);
      days[day]?.sort();
    }
    const author2 = "uAuthor 김민준 학생의 수업 보고서 2건이 지금 미발송 상태입니다(11/3~) — 가장 이른 건은 11/9 22:30까지만 보낼 수 있습니다.";
    const makeup = "uMakeup 김민준 학생 11/2 수학 수업 보고서(11/2 저장)가 지금 미발송 상태입니다 — 11/8 22:30까지만 보낼 수 있습니다.";
    const gone = "uTeacherA 이서연 학생 11/4 수학 수업 보고서(11/4 저장)가 지금 미발송 상태입니다 — 11/10 22:30까지만 보낼 수 있습니다.";
    expect(days).toEqual({
      // rAuthor 2·3번째 + rToday(11/5 새벽 저장) 1·2번째를 한 묶음 · rMakeup 2·3번째 · rGone 2·3번째
      "2026-11-06": [author2, makeup, gone],
      "2026-11-07": [author2, makeup, gone],
      // rToday 3번째만 남는다 — 나머지는 3번을 채웠다(11/9엔 아무것도 없다)
      "2026-11-08": ["uAuthor 김민준 학생 11/4 수학 수업 보고서(11/5 저장)가 지금 미발송 상태입니다 — 11/10 22:30까지만 보낼 수 있습니다."],
    });
  });

  it("발송 마지막 날이 오늘이면 '오늘 22:30까지만'", async () => {
    const { notified } = await runOn("2026-11-08"); // rMakeup(11/2 수업)의 마지막 날 · 처음 잡힌 날
    expect(bodiesFor(notified, "uMakeup")).toEqual([
      "김민준 학생 11/2 수학 수업 보고서(11/2 저장)가 지금 미발송 상태입니다 — 오늘 22:30까지만 보낼 수 있습니다.",
    ]);
  });

  it("콜드스타트(기록 0건) 첫날 잡힌 보고서는 기록만 하고 그 뒤로도 울리지 않는다 — 그 뒤 새로 잡힌 건만 세 번", async () => {
    seed({ events: [] });
    const cold = await runOn("2026-11-05");
    expect(cold).toEqual({ n: 0, notified: [] });
    expect(m.tables.notification_events!.every((row) => row.seeded === true)).toBe(true);
    const after: string[] = [];
    for (const day of ["2026-11-06", "2026-11-07", "2026-11-08", "2026-11-09"]) {
      for (const item of (await runOn(day)).notified) after.push(`${day} ${item.recipientId} ${item.body}`);
    }
    // rAuthor·rGone·rMakeup(직원 몫)·rOrphan(원장 1회분)은 시드 — 영영 조용. rToday는 콜드스타트 날 작성 당일이라 시드가 아니다.
    const today = "uAuthor 김민준 학생 11/4 수학 수업 보고서(11/5 저장)가 지금 미발송 상태입니다 — 11/10 22:30까지만 보낼 수 있습니다.";
    expect(after).toEqual([`2026-11-06 ${today}`, `2026-11-07 ${today}`, `2026-11-08 ${today}`]);
  });

  it("리뷰 r2 X3 — 콜드스타트 다음 날, 시드된 밀린 건이 받는 사람별 묶음으로 울리지 않는다", async () => {
    seed({ events: [] });
    m.tables.lesson_reports = [
      report("b1", { report_date: "2026-10-31", created_at: kst("2026-10-31") }),
      report("b2", { report_date: "2026-11-01", created_at: kst("2026-11-01") }),
      report("b3", { student_id: "s2", report_date: "2026-11-02", created_at: kst("2026-11-02"), created_by: "uTeacherB" }),
      report("b4", { student_id: "s2", report_date: "2026-11-03", created_at: kst("2026-11-03"), created_by: null, class_id: "cNone" }),
    ];
    expect((await runOn("2026-11-04")).notified).toEqual([]);
    expect((await runOn("2026-11-05")).notified).toEqual([]);
    expect((await runOn("2026-11-06")).notified).toEqual([]);
  });

  it("리뷰 r2 X1 — 마지막 날(11/8) 새벽 1시에 저장한 11/2 수업분은 그날 한 번 울린다(다음 날은 기한 지남)", async () => {
    m.tables.lesson_reports = [report("rLast", { report_date: "2026-11-02", created_at: kst("2026-11-08", "01:00") })];
    expect(bodiesFor((await runOn("2026-11-08")).notified, "uAuthor")).toEqual([
      "김민준 학생 11/2 수학 수업 보고서(11/8 저장)가 지금 미발송 상태입니다 — 오늘 22:30까지만 보낼 수 있습니다.",
    ]);
    expect((await runOn("2026-11-09")).notified).toEqual([]);
  });

  it("배포 당일: 옛 코드가 오늘 아침 'unsent'로 이미 알린 보고서는 다시 돌려도 오늘은 안 울리고, 이틀만 더", async () => {
    seed({
      events: [
        { id: "a", tenant_id: T, event_type: "unsent_report", subject_key: "rGone", bucket: "unsent", seeded: false, created_at: kst("2026-11-05", "07:00") },
      ],
    });
    expect(bodiesFor((await runOn("2026-11-05")).notified, "uTeacherA")).toEqual([]);
    const after: string[] = [];
    for (const day of ["2026-11-06", "2026-11-07", "2026-11-08"]) {
      if (bodiesFor((await runOn(day)).notified, "uTeacherA").length) after.push(day);
    }
    expect(after).toEqual(["2026-11-06", "2026-11-07"]);
  });

  it("다른 종류·다른 학원의 기록은 세지 않는다", async () => {
    seed({
      events: [
        { id: "x1", tenant_id: T, event_type: "send_deadline", subject_key: "rGone", bucket: "remind:2026-11-04", seeded: false, created_at: kst("2026-11-04") },
        { id: "x2", tenant_id: "tenant-2", event_type: "unsent_report", subject_key: "rGone", bucket: "remind:2026-11-04", seeded: false, created_at: kst("2026-11-04") },
        { id: "x3", tenant_id: T, event_type: "unsent_report", subject_key: "옛보고서", bucket: "unsent", seeded: false, created_at: kst("2026-10-20") },
      ],
    });
    const after: string[] = [];
    for (const day of ["2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08"]) {
      if (bodiesFor((await runOn(day)).notified, "uTeacherA").length) after.push(day);
    }
    expect(after).toEqual(["2026-11-05", "2026-11-06", "2026-11-07"]);
  });

  it("조회 상한 500에서 잘리는 쪽은 가장 오래된 건 — 최근 저장분이 빠지지 않는다", async () => {
    const many = Array.from({ length: 500 }, (_, i) =>
      report(`old${String(i).padStart(3, "0")}`, { report_date: "2026-10-30", created_at: kst("2026-10-30"), created_by: "uTeacherB" }),
    );
    m.tables.lesson_reports = [...many, report("rRecent", { report_date: "2026-11-04", created_at: kst("2026-11-04") })];
    const { notified } = await runOn("2026-11-05");
    expect(bodiesFor(notified, "uAuthor")).toEqual([
      "김민준 학생 11/4 수학 수업 보고서(11/4 저장)가 지금 미발송 상태입니다 — 11/10 22:30까지만 보낼 수 있습니다.",
    ]);
  });

  it("결석으로 막힌 보고서는 울리지 않는다 · 시간창이 없으면 시각 없이", async () => {
    m.absent = new Set(["s1|2026-11-03|c:cA"]);
    m.settings = { ...m.settings, report: { ...(m.settings.report as Row), classnoteSendWindowStart: "", classnoteSendWindowEnd: "" } };
    const { notified } = await runOn("2026-11-05");
    expect(bodiesFor(notified, "uAuthor")).toEqual([]);
    expect(bodiesFor(notified, "uTeacherA")).toEqual([
      "이서연 학생 11/4 수학 수업 보고서(11/4 저장)가 지금 미발송 상태입니다 — 11/10까지만 보낼 수 있습니다.",
    ]);
  });
});
