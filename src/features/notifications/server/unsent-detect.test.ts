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
  /** 한 번 감지에서 표별로 몇 번 읽었나 — 페이지가 안 넘어가는 반복을 끊는다(아래 MAX_READS). */
  reads: {} as Record<string, number>,
  /** 부른 rpc 이름(할 일 동기화가 돌았나). */
  rpcs: [] as string[],
  /** 지점 라이선스(오늘 수학) — 시험이 켠다. */
  todaysMathLicense: false,
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
vi.mock("@/lib/license/server", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isFeatureOptedIn: async (_tenantId: string, feature: string) => feature === "todays_math" && m.todaysMathLicense,
}));
vi.mock("@/features/dashboard/server/queries", () => ({ getAbsenceRiskStudents: vi.fn() }));
vi.mock("@/lib/observability/report-error", () => ({ reportError: vi.fn(), reportWarning: vi.fn() }));
vi.mock("@/features/onescreen/server/absence-gate", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getAbsenceBlockedKeys: async () => new Set(m.absent),
}));

import { detectUnsentDrafts, detectUnsentReports } from "@/features/notifications/server/events";

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
  /** 정렬 칸들(앞이 먼저) — `.order()`를 여러 번 부르면 쌓인다(PostgREST와 같다). */
  orders: { col: string; asc: boolean }[];
  limit: number | null;
  range: [number, number] | null;
  upsert: { rows: Row[]; onConflict: string[] } | null;
};

/** PostgREST 한 번 응답 상한 — 넘는 행은 오류 없이 잘린다(B2 · 페이지로 읽지 않으면 조용히 빠진다). */
const MAX_ROWS = 1000;
/** 한 번 감지에서 같은 표를 이보다 많이 읽으면 페이지가 안 넘어가는 것 — 끝없이 쌓지 말고 바로 실패시킨다. */
const MAX_READS = 60;

function run(s: State): { data: Row[] | null; count?: number; error: null } {
  m.reads[s.table] = (m.reads[s.table] ?? 0) + 1;
  if (m.reads[s.table]! > MAX_READS) throw new Error(`가짜 DB: ${s.table}을(를) ${MAX_READS}번 넘게 읽음 — 페이지가 넘어가지 않는다`);
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
  if (s.orders.length) {
    rows = [...rows].sort((a, b) => {
      for (const { col, asc } of s.orders) {
        const c = String(a[col]).localeCompare(String(b[col])) * (asc ? 1 : -1);
        if (c) return c;
      }
      return 0;
    });
  }
  // PostgREST는 정렬 없이 쪽을 나누면 쪽마다 같은 순서라는 보장이 없다 — 흉내: 정렬 없는 둘째 쪽부터는 거꾸로 센다(행이 빠지거나 겹친다).
  if (s.range && !s.orders.length && s.range[0] > 0) rows = [...rows].reverse();
  if (s.range) rows = rows.slice(s.range[0], s.range[1] + 1);
  if (s.limit !== null) rows = rows.slice(0, s.limit);
  rows = rows.slice(0, MAX_ROWS);
  if (s.head) return { data: null, count: rows.length, error: null };
  return { data: rows.map((row) => project(row, s.select)), error: null };
}

function fakeAdmin() {
  const from = (table: string) => {
    const s: State = { table, select: "*", head: false, filters: [], orders: [], limit: null, range: null, upsert: null };
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
        s.orders.push({ col, asc: opts?.ascending !== false });
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
    rpc: async (name: string, args: { p_reports: string[] }) => {
      m.rpcs.push(name);
      return name === "staff_task_sync_unsent"
        ? { data: args.p_reports.flatMap((id) => (m.tasks.has(id) ? [{ report_id: id, task_id: m.tasks.get(id) }] : [])), error: null }
        : { data: null, error: { message: `모르는 rpc ${name}` } };
    },
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
  m.reads = {};
  m.rpcs = [];
  const n = await detectUnsentReports(fakeAdmin() as never, T);
  return { n, notified: m.notified };
};
const bodiesFor = (notified: typeof m.notified, recipientId: string) =>
  notified.filter((item) => item.recipientId === recipientId).map((item) => item.body);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  m.tasks = new Map([["rAuthor", "task-rAuthor"]]);
  m.absent = new Set();
  m.todaysMathLicense = false;
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
      // 11/8은 일요일 — 아무것도 기록·발송하지 않는다(원장 2026-11-06 B). rToday 3번째는 월요일(11/9)로 이어진다.
      "2026-11-09": ["uAuthor 김민준 학생 11/4 수학 수업 보고서(11/5 저장)가 지금 미발송 상태입니다 — 11/10 22:30까지만 보낼 수 있습니다."],
    });
  });

  it("일요일엔 미발송 알림을 기록도 발송도 하지 않는다 — 할 일 동기화는 그대로 돈다(B)", async () => {
    const sunday = await runOn("2026-11-08");
    expect(sunday).toEqual({ n: 0, notified: [] });
    expect(m.tables.notification_events!.filter((row) => row.event_type === "unsent_report" && row.subject_key !== "옛보고서")).toEqual([]);
    expect(m.rpcs).toEqual(["staff_task_sync_unsent"]); // 할 일 동기화는 일요일에도 돈다(알림만 멈춤)
    // 월요일엔 다시 — 처음 잡힌 날부터 센다
    expect((await runOn("2026-11-09")).notified.length).toBeGreaterThan(0);
  });

  it("발송 마지막 날이 오늘이면 '오늘 22:30까지만'", async () => {
    const { notified } = await runOn("2026-11-09"); // rAuthor(11/3 수업)의 마지막 날 · 처음 잡힌 날 — rToday와 한 묶음
    expect(bodiesFor(notified, "uAuthor")).toEqual([
      "김민준 학생의 수업 보고서 2건이 지금 미발송 상태입니다(11/3~) — 가장 이른 건은 오늘 22:30까지만 보낼 수 있습니다.",
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
    // 11/8(일)은 건너뛰고 11/9(월)에 세 번째
    expect(after).toEqual([`2026-11-06 ${today}`, `2026-11-07 ${today}`, `2026-11-09 ${today}`]);
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

  it("리뷰 r2 X1 — 마지막 날(11/9 월) 새벽 1시에 저장한 11/3 수업분은 그날 한 번 울린다(다음 날은 기한 지남)", async () => {
    m.tables.lesson_reports = [report("rLast", { report_date: "2026-11-03", created_at: kst("2026-11-09", "01:00") })];
    expect(bodiesFor((await runOn("2026-11-09")).notified, "uAuthor")).toEqual([
      "김민준 학생 11/3 수학 수업 보고서(11/9 저장)가 지금 미발송 상태입니다 — 오늘 22:30까지만 보낼 수 있습니다.",
    ]);
    expect((await runOn("2026-11-10")).notified).toEqual([]);
  });

  it("마지막 날이 일요일이고 그날 새벽 저장 → 한 번도 울리지 않는다(일요일 무알림이 우선 · 원장 결정 범위)", async () => {
    m.tables.lesson_reports = [report("rSun", { report_date: "2026-11-02", created_at: kst("2026-11-08", "01:00") })];
    expect((await runOn("2026-11-08")).notified).toEqual([]); // 일요일
    expect((await runOn("2026-11-09")).notified).toEqual([]); // 기한(11/8) 지남
  });

  it("마지막 날이 일요일이면 토요일 새벽(07시 전) 저장분은 작성 당일인 토요일에 한 번 울린다(C1 r2 경미 3)", async () => {
    m.tables.lesson_reports = [report("rSat", { report_date: "2026-11-02", created_at: kst("2026-11-07", "01:00") })];
    expect(bodiesFor((await runOn("2026-11-07")).notified, "uAuthor")).toEqual([
      "김민준 학생 11/2 수학 수업 보고서(11/7 저장)가 지금 미발송 상태입니다 — 11/8 22:30까지만 보낼 수 있습니다.",
    ]);
    expect((await runOn("2026-11-08")).notified).toEqual([]); // 일요일
    expect((await runOn("2026-11-09")).notified).toEqual([]); // 기한(11/8) 지남
  });

  it("마지막 날이 일요일인데 토요일 07시 cron 뒤에 저장 → 한 번도 울리지 않는다(남은 빈틈 · 일요일 무알림이 우선)", async () => {
    m.tables.lesson_reports = [];
    expect((await runOn("2026-11-07")).notified).toEqual([]); // 토요일 07시엔 아직 없다
    m.tables.lesson_reports = [report("rSatEve", { report_date: "2026-11-02", created_at: kst("2026-11-07", "20:00") })];
    expect((await runOn("2026-11-08")).notified).toEqual([]); // 일요일
    expect((await runOn("2026-11-09")).notified).toEqual([]); // 기한 지남
  });

  it("마감 전날이 평일이면(금요일 · 내일 토요일 마감) 작성 당일은 그대로 건너뛰고 다음 날 울린다", async () => {
    m.tables.lesson_reports = [report("rFri", { report_date: "2026-11-01", created_at: kst("2026-11-06", "01:00") })];
    expect((await runOn("2026-11-06")).notified).toEqual([]);
    expect((await runOn("2026-11-07")).notified.map((i) => i.recipientId)).toEqual(["uAuthor"]);
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

// ─────────── 저장 안 된 수업 보고서(원스크린에 입력만 함) — 원장 2026-11-06 권장안 ───────────
// 4주 실측 유형을 장면으로 고정한다: PS3A 10/19형(반 전체 0 · 평소 쓰는 반 · 출결 있음 → D+2·D+3·D+4) · 10/09 대체휴무형(반 출결 0 → 안 울림) ·
// 다음 날 저녁 저장형(D+2 전에 저장 → 안 울림) · 평소 안 쓰는 반형. 세션 칸의 키는 반 id(UUID)여야 입력 단위로 읽힌다.
describe("저장 안 된 수업 보고서 감지 — 가짜 DB로 통째로", () => {
  const P = "aaaaaaaa-0000-4000-8000-000000000001"; // 평소 쓰는 반(담임 uTeacherA)
  const H = "aaaaaaaa-0000-4000-8000-000000000002"; // 평소 쓰는 반인데 그날 출결 0(휴무일)
  const R = "aaaaaaaa-0000-4000-8000-000000000003"; // 평소 거의 안 쓰는 반(입력 4일 중 보고서 1일)
  const F = "aaaaaaaa-0000-4000-8000-000000000004"; // 입력일 3일뿐(지난 2일 + 수업일 — 입력일엔 그날도 든다 · 비율을 믿을 수 없음)
  const Q = "aaaaaaaa-0000-4000-8000-000000000005"; // 평소 쓰는 반(담임 uTeacherB)
  const D = "2026-11-02"; // 수업일(월) — D+2 = 11/4 · 기한 D+6 = 11/8
  const HISTORY = ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29"];
  let sid = 0;
  const session = (studentId: string, date: string, updatedBy: string | null, progress: Row): Row => ({
    id: `ses${++sid}`, tenant_id: T, student_id: studentId, session_date: date, updated_by: updatedBy, subject_progress: progress,
  });
  const sentReport = (studentId: string, date: string, classId: string): Row =>
    report(`hist-${classId.slice(-2)}-${date}-${studentId}`, { student_id: studentId, report_date: date, class_id: classId, created_at: kst(date), classnote_status: "success" });
  const present = (studentId: string, classId: string, date = D): Row => ({
    id: `att-${studentId}-${classId}-${date}`, tenant_id: T, student_id: studentId, class_id: classId, session_date: date, status: "present", recorded_at: kst(date, "19:00"),
  });
  /** 반의 지난 입력일(세션) + 그날 보고서(보낸 것). reportDays = 그중 보고서가 있는 날. */
  const history = (classId: string, days: readonly string[], reportDays: readonly string[]) => [
    days.map((d) => session("sHist", d, "uTeacherA", { [classId]: { today: "지난 진도" } })),
    reportDays.map((d) => sentReport("sHist", d, classId)),
  ] as const;

  function seedDrafts() {
    seed();
    const [pS, pR] = history(P, HISTORY, HISTORY);
    const [hS, hR] = history(H, HISTORY, HISTORY);
    const [rS, rR] = history(R, HISTORY, HISTORY.slice(0, 1));
    const [fS, fR] = history(F, HISTORY.slice(0, 2), HISTORY.slice(0, 2));
    const [qS, qR] = history(Q, HISTORY, HISTORY);
    m.tables.classes = [
      { id: P, tenant_id: T, subject: "math", teacher_id: "uTeacherA", is_active: true, report_optout: false },
      { id: H, tenant_id: T, subject: "math", teacher_id: "uTeacherA", is_active: true, report_optout: false },
      { id: R, tenant_id: T, subject: "math", teacher_id: "uTeacherA", is_active: true, report_optout: false },
      { id: F, tenant_id: T, subject: "math", teacher_id: "uTeacherA", is_active: true, report_optout: false },
      { id: Q, tenant_id: T, subject: "math", teacher_id: "uTeacherB", is_active: true, report_optout: false },
    ];
    m.tables.students = [
      { id: "s1", tenant_id: T, name: "김민준", is_test: false },
      { id: "s2", tenant_id: T, name: "이서연", is_test: false },
      { id: "sHist", tenant_id: T, name: "지난학생", is_test: false },
    ];
    m.tables.onescreen_daily_sessions = [...pS, ...hS, ...rS, ...fS, ...qS];
    m.tables.lesson_reports = [...pR, ...hR, ...rR, ...fR, ...qR];
    m.tables.attendance_records = [];
    m.tables.class_sheet_plan_lines = [];
    m.tables.textbook_orders = [];
  }
  /** 그 반의 수업일 D 입력(진도 칸) + 출결(출석). */
  const lesson = (studentId: string, classId: string, by: string | null = "uTeacherA", withAttendance = true) => {
    m.tables.onescreen_daily_sessions!.push(session(studentId, D, by, { [classId]: { today: "함수 3단원", draft: "오늘 잘했어요" } }));
    if (withAttendance) m.tables.attendance_records!.push(present(studentId, classId));
  };
  const runDay = async (day: string, opts: { reportsToo?: boolean; at?: string } = {}) => {
    vi.setSystemTime(opts.at ? new Date(`${day}T${opts.at}:00+09:00`) : at7(day));
    m.notified = [];
    m.reads = {};
    if (opts.reportsToo) await detectUnsentReports(fakeAdmin() as never, T);
    m.reads = {};
    const n = await detectUnsentDrafts(fakeAdmin() as never, T);
    return { n, notified: m.notified.map((i) => ({ ...i, link: (i as { link?: string }).link })) };
  };
  const ringDays = async (days: readonly string[], recipientId: string) => {
    const got: string[] = [];
    for (const day of days) if ((await runDay(day)).notified.some((i) => i.recipientId === recipientId)) got.push(day);
    return got;
  };
  const WEEK = ["2026-11-03", "2026-11-04", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08"];

  beforeEach(() => {
    seedDrafts();
  });

  it("PS3A 10/19형 — 반 전체 보고서 0 · 평소 쓰는 반 · 출결 있음 → D+2·D+3·D+4에 한 번씩(D+1·같은 날 재실행·4번째 없음)", async () => {
    lesson("s1", P);
    lesson("s2", P);
    expect(await ringDays(WEEK, "uTeacherA")).toEqual(["2026-11-04", "2026-11-05", "2026-11-06"]);
    seedDrafts();
    lesson("s1", P);
    lesson("s2", P);
    const { notified } = await runDay("2026-11-04");
    expect(notified.map((i) => [i.recipientId, i.title, i.body, i.link])).toEqual([
      [
        "uTeacherA",
        "저장 안 된 수업 보고서",
        "김민준·이서연 학생의 수업 2건이 원스크린에 입력만 되고 보고서로 저장되지 않았습니다(11/2~) — 가장 이른 건은 11/8 22:30까지만 보낼 수 있습니다.",
        "/onescreen?date=2026-11-02",
      ],
    ]);
  });

  it("10/09 대체휴무형 — 평소 쓰는 반이어도 그 반 그날 출결이 0건이면 울리지 않는다", async () => {
    lesson("s1", H, "uTeacherA", false);
    expect(await ringDays(WEEK, "uTeacherA")).toEqual([]);
  });

  it("다음 날 저녁 저장형 — D+2 07시 전에 저장하면 울리지 않는다(같은 과목 다른 반 보고서도 저장으로 본다)", async () => {
    lesson("s1", P);
    lesson("s2", P);
    m.tables.lesson_reports!.push(report("rS1", { student_id: "s1", report_date: D, class_id: P, created_at: kst("2026-11-03", "20:00") }));
    m.tables.lesson_reports!.push(report("rS2", { student_id: "s2", report_date: D, class_id: Q, created_at: kst("2026-11-03", "21:00") }));
    expect(await ringDays(WEEK, "uTeacherA")).toEqual([]);
  });

  it("평소 안 쓰는 반형 — 입력 4일 중 보고서 1일인 반 · 입력일 3일뿐인 반은 울리지 않는다", async () => {
    lesson("s1", R);
    lesson("s2", F);
    expect(await ringDays(WEEK, "uTeacherA")).toEqual([]);
  });

  it("받는 사람 — 입력한 계정 · 퇴사면 그 반 담임 · 보강 칸은 반 출결·평소 쓰는 반 없이 입력한 사람 · 결석은 제외", async () => {
    lesson("s1", Q, "uGone"); // 퇴사한 입력자 → Q 담임 uTeacherB
    m.tables.onescreen_daily_sessions!.push(session("s2", D, "uMakeup", { "makeup::math": { makeup: true, today: "보강 진도", makeupClassId: R } }));
    lesson("s2", P); // 결석으로 막는다
    m.absent = new Set([`s2|${D}|c:${P}`]);
    const { notified } = await runDay("2026-11-04");
    expect(notified.map((i) => [i.recipientId, i.body, i.link]).sort()).toEqual([
      ["uMakeup", "이서연 학생 11/2 수학 수업이 원스크린에 입력만 되고 보고서로 저장되지 않았습니다 — 11/8 22:30까지만 보낼 수 있습니다.", "/onescreen?date=2026-11-02"],
      // 입력한 사람이 아닌 반 담임 — 그 입력은 담임 원스크린에 안 보이니 '다른 선생님이 입력만 해 두었다 · 보고서를 작성해 달라'(경미 3)
      [
        "uTeacherB",
        "김민준 학생 11/2 수학 수업은 다른 선생님이 원스크린에 입력만 해 두고 보고서로 저장하지 않았습니다 — 보고서를 작성해 주세요(11/8 22:30까지만 보낼 수 있습니다).",
        "/onescreen?date=2026-11-02",
      ],
    ]);
  });

  it("같은 입력 키를 두 입력자가 가지면 한 사람만 — 그 반 재직 담임 우선(경미 1 · 리뷰 Y1)", async () => {
    lesson("s1", P, "uTeacherA");
    m.tables.onescreen_daily_sessions!.push(session("s1", D, "uTeacherB", { [P]: { today: "대신 들어간 수업", draft: "대강 멘트" } }));
    const { n, notified } = await runDay("2026-11-04");
    expect(n).toBe(1);
    expect(notified.map((i) => i.recipientId)).toEqual(["uTeacherA"]);
  });

  it("같은 날 같은 과목 두 반(P·Q) 입력 → P만 저장(안 보냄) → 미발송은 날마다 한 줄로 세어 세 번째가 울린다(경미 2 · 리뷰 Y3)", async () => {
    lesson("s1", P, "uTeacherA");
    lesson("s1", Q, "uTeacherB");
    expect((await runDay("2026-11-04", { reportsToo: true })).notified.map((i) => i.recipientId).sort()).toEqual(["uTeacherA", "uTeacherB"]);
    expect((await runDay("2026-11-05", { reportsToo: true })).notified.map((i) => i.recipientId).sort()).toEqual(["uTeacherA", "uTeacherB"]);
    m.tables.lesson_reports!.push(report("rP", { student_id: "s1", report_date: D, class_id: P, created_at: kst("2026-11-05", "20:00"), created_by: "uTeacherA" }));
    // 입력 단계 기록 4줄(P 2 · Q 2)이 같은 학생·날짜·과목이라 rP로 옮겨지지만, 날짜마다 한 줄 → 2번으로 센다 → 세 번째가 울린다.
    expect((await runDay("2026-11-06", { reportsToo: true })).notified.map((i) => [i.recipientId, i.title])).toEqual([["uTeacherA", "미발송 보고서 확인"]]);
    expect((await runDay("2026-11-07", { reportsToo: true })).notified).toEqual([]);
  });

  it("금·토 수업 → 일요일은 건너뛰고 월·화·수에 세 번(원장 2026-11-06 B)", async () => {
    for (const date of ["2026-10-30", "2026-10-31"]) {
      m.tables.onescreen_daily_sessions!.push(session("s1", date, "uTeacherA", { [P]: { today: `${date} 진도`, draft: "멘트" } }));
      m.tables.attendance_records!.push(present("s1", P, date));
    }
    const got: Record<string, number> = {};
    for (const day of ["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05"]) {
      const { n } = await runDay(day);
      if (n) got[day] = n;
    }
    expect(got).toEqual({ "2026-11-02": 2, "2026-11-03": 2, "2026-11-04": 2 }); // 11/1(일) 조용 · 금·토 두 수업이 같은 날 함께
  });

  describe("직접 쓴 흔적만 입력으로(원장 2026-11-06 A)", () => {
    const only = (cell: Row) => {
      m.tables.onescreen_daily_sessions!.push(session("s1", D, "uTeacherA", { [P]: cell }));
      m.tables.attendance_records!.push(present("s1", P));
    };
    const rings = async () => (await runDay("2026-11-04")).notified.length;

    it("교재만 — 직전 보고서 교재(쪽수 뗀 것)를 이어 채운 그대로면 안 울리고, 바꿔 쓰면 울린다", async () => {
      m.tables.lesson_reports!.push(report("prevS1", { student_id: "s1", report_date: "2026-10-29", class_id: P, textbook: "쎈 중2-1 p.30", created_at: kst("2026-10-29"), classnote_status: "success" }));
      only({ textbook: "쎈 중2-1" });
      expect(await rings()).toBe(0);
      seedDrafts();
      m.tables.lesson_reports!.push(report("prevS1", { student_id: "s1", report_date: "2026-10-29", class_id: P, textbook: "쎈 중2-1 p.30", created_at: kst("2026-10-29"), classnote_status: "success" }));
      only({ textbook: "RPM 중2-1" });
      expect(await rings()).toBe(1);
    });

    it("교재만 — 교재요청서 교재(수학 줄)를 채운 그대로면 안 울린다", async () => {
      m.tables.textbook_orders = [{ id: "o1", tenant_id: T, student_id: "s1", book_name: "가우스 중2-1" }];
      only({ textbook: "가우스 중2-1" });
      expect(await rings()).toBe(0);
    });

    it("진도·오늘 과제 — ECS 시트 초안 그대로면 안 울리고, 고치면 울린다", async () => {
      const plan = { id: "pl1", tenant_id: T, class_id: P, plan_date: D, slot_start: "15:00", line_no: 1, skill_area: "main", textbook: "쎈 중2-1", page_range: "p.10", progress: "1단원", homework: "p.12" };
      m.tables.class_sheet_plan_lines = [plan];
      only({ today: "1단원 (p.10)", homeworkToday: "p.12", textbook: "쎈 중2-1" });
      expect(await rings()).toBe(0);
      seedDrafts();
      m.tables.class_sheet_plan_lines = [plan];
      only({ today: "1단원 (p.10~14)", homeworkToday: "p.12", textbook: "쎈 중2-1" });
      expect(await rings()).toBe(1);
    });

    it("다른 학원의 시트 계획·교재요청서·보고서 교재는 자동 값 후보가 아니다", async () => {
      m.tables.class_sheet_plan_lines = [{ id: "xpl", tenant_id: "tenant-2", class_id: P, plan_date: D, slot_start: "15:00", line_no: 1, skill_area: "main", textbook: null, page_range: null, progress: "남의 계획", homework: null }];
      m.tables.textbook_orders = [{ id: "xo", tenant_id: "tenant-2", student_id: "s1", book_name: "남의 교재" }];
      m.tables.lesson_reports!.push(report("xrep", { tenant_id: "tenant-2", student_id: "s1", report_date: "2026-10-29", class_id: P, textbook: "남의 보고서 교재", created_at: kst("2026-10-29"), classnote_status: "success" }));
      only({ today: "남의 계획" });
      expect(await rings()).toBe(1);
      seedDrafts();
      m.tables.textbook_orders = [{ id: "xo", tenant_id: "tenant-2", student_id: "s1", book_name: "남의 교재" }];
      only({ textbook: "남의 교재" });
      expect(await rings()).toBe(1);
      seedDrafts();
      m.tables.lesson_reports!.push(report("xrep", { tenant_id: "tenant-2", student_id: "s1", report_date: "2026-10-29", class_id: P, textbook: "남의 보고서 교재", created_at: kst("2026-10-29"), classnote_status: "success" }));
      only({ textbook: "남의 보고서 교재" });
      expect(await rings()).toBe(1);
    });

    it("줄 단위 평가값(태도)만 적은 칸도 직접 쓴 흔적이다", async () => {
      only({ attitude: "집중함" });
      expect(await rings()).toBe(1);
    });
  });

  describe("C1 r2 재리뷰 경미 — 오늘 수학 점수 · 토요일 마지막 날 · 변이 고정", () => {
    const E = "aaaaaaaa-0000-4000-8000-000000000006"; // 평소 쓰는 영어 반
    const put = (studentId: string, date: string, classId: string, cell: Row, by = "uTeacherA", updatedAt?: string) => {
      m.tables.onescreen_daily_sessions!.push({ ...session(studentId, date, by, { [classId]: cell }), ...(updatedAt ? { updated_at: updatedAt } : {}) });
      m.tables.attendance_records!.push(present(studentId, classId, date));
    };
    const tmRow = (p: Row): Row => ({
      tenant_id: T, source_test_id: "tm1", student_id: "s1", class_id: P, kind: "daily", title: "일일", test_date: D,
      question_count: 20, absent: false, correct_count: 18, taken_at: kst(D, "16:00"), ...p,
    });
    const fillOn = () => {
      m.settings = { ...m.settings, report: { ...(m.settings.report as Row), todaysMathTestFill: true, showDailyTest: true, showCheckTest: true } };
      m.todaysMathLicense = true;
    };

    it("경미 1 — 오늘 수학 결과로 채워진 점수만 남은 칸은 울리지 않고, 고친 점수는 울린다", async () => {
      fillOn();
      m.tables.todays_math_test_results = [tmRow({})];
      put("s1", D, P, { dailyScore: 18, dailyMax: 20 });
      expect((await runDay("2026-11-04")).n).toBe(0);
      expect(m.reads.todays_math_test_results).toBe(1);
      seedDrafts();
      fillOn();
      m.tables.todays_math_test_results = [tmRow({})];
      put("s1", D, P, { dailyScore: 17, dailyMax: 20 });
      expect((await runDay("2026-11-04")).n).toBe(1);
    });

    it("경미 1 — 채우기 설정이 꺼져도 라이선스가 있으면 읽어 자동 점수로 본다(켰다 끈 뒤 세션에 남은 점수 · r3 재리뷰)", async () => {
      m.todaysMathLicense = true;
      m.settings = { ...m.settings, report: { ...(m.settings.report as Row), todaysMathTestFill: false, showDailyTest: true, showCheckTest: true } };
      m.tables.todays_math_test_results = [tmRow({})];
      put("s1", D, P, { dailyScore: 18 });
      expect((await runDay("2026-11-04")).n).toBe(0); // 설정 꺼짐 · 라이선스 켜짐(침산 2026-11-06)
      expect(m.reads.todays_math_test_results).toBe(1);
    });

    it("경미 1 — 라이선스가 없으면 설정과 상관없이 오늘 수학을 읽지 않고(조회 0번), 점수는 직접 쓴 흔적이다", async () => {
      for (const fill of [true, false]) {
        seedDrafts();
        m.todaysMathLicense = false;
        m.settings = { ...m.settings, report: { ...(m.settings.report as Row), todaysMathTestFill: fill, showDailyTest: true, showCheckTest: true } };
        m.tables.todays_math_test_results = [tmRow({})];
        put("s1", D, P, { dailyScore: 18 });
        expect((await runDay("2026-11-04")).n).toBe(1);
        expect(m.reads.todays_math_test_results).toBeUndefined();
      }
    });

    it("경미 1 — 오늘 수학 결과가 1,000행을 넘어도 기본 키 순으로 쪽을 넘겨 다 읽는다(리뷰 S8·S9)", async () => {
      fillOn();
      // 다른 반 결과 1,200행 뒤에 진짜 결과 — 기본 키(source_test_id) 순으로 둘째 쪽(1,201번째)에 온다.
      const filler = Array.from({ length: 1200 }, (_, i) => tmRow({ source_test_id: `f${String(i).padStart(4, "0")}`, class_id: Q, correct_count: 3 }));
      m.tables.todays_math_test_results = [...filler, tmRow({ source_test_id: "z-real" })];
      put("s1", D, P, { dailyScore: 18 });
      expect((await runDay("2026-11-04")).n).toBe(0);
      expect(m.reads.todays_math_test_results).toBe(2);
    });

    it("경미 1 — 다른 학원 · 다른 날 · 다른 반 결과는 자동 값이 아니다", async () => {
      for (const other of [{ tenant_id: "tenant-2" }, { test_date: "2026-11-03" }, { class_id: Q }]) {
        seedDrafts();
        fillOn();
        m.tables.todays_math_test_results = [tmRow(other)];
        put("s1", D, P, { dailyScore: 18 });
        put("s2", "2026-11-03", P, { today: "다음 날 진도", draft: "멘트" }); // 조회 범위를 11/3까지 넓혀 다른 날 결과도 읽히게
        expect((await runDay("2026-11-05")).n).toBe(2);
      }
    });

    it("경미 1 — 보고서 표시 항목에서 끈 시험 칸은 원스크린이 채우지 않으니 같은 점수여도 직접 쓴 흔적이다", async () => {
      fillOn();
      m.settings = { ...m.settings, report: { ...(m.settings.report as Row), showDailyTest: false } };
      m.tables.todays_math_test_results = [tmRow({}), tmRow({ source_test_id: "tm2", kind: "review", question_count: 10, correct_count: 9 })];
      put("s1", D, P, { dailyScore: 18 });
      put("s2", D, P, { checkScore: 9 }); // 확인 칸은 켜져 있다 — s2 확인 점수는 그 학생 결과와 같아 자동 값(안 울림)
      m.tables.todays_math_test_results!.push(tmRow({ source_test_id: "tm3", student_id: "s2", kind: "review", question_count: 10, correct_count: 9 }));
      expect((await runDay("2026-11-04")).notified.map((i) => i.body)).toEqual([
        "김민준 학생 11/2 수학 수업이 원스크린에 입력만 되고 보고서로 저장되지 않았습니다 — 11/8 22:30까지만 보낼 수 있습니다.",
      ]);
    });

    it("경미 2 — 120일보다 오래된(1년 안) 직전 보고서 교재도 이어 채운 자동 값이다", async () => {
      m.tables.lesson_reports!.push(report("old", { student_id: "s1", report_date: "2026-06-01", class_id: P, textbook: "개념원리 중2-1 p.40", created_at: kst("2026-06-01"), classnote_status: "success" }));
      put("s1", D, P, { textbook: "개념원리 중2-1" });
      expect((await runDay("2026-11-04")).n).toBe(0);
    });

    it("경미 1 — 일요일엔 오늘 수학도 읽지 않는다(조회 0번)", async () => {
      fillOn();
      m.tables.todays_math_test_results = [tmRow({})];
      put("s1", D, P, { dailyScore: 17 });
      expect(await runDay("2026-11-08")).toEqual({ n: 0, notified: [] });
      expect(m.reads).toEqual({});
    });

    it("경미 3 — 입력만 함 갈래도 마지막 날이 일요일이면 토요일에 울린다(입력이 늦게 들어와도) · 일요일·월요일은 0", async () => {
      expect((await runDay("2026-11-06")).n).toBe(0); // 아직 입력 없음
      put("s1", D, P, { today: "늦게 적은 진도" }); // 11/6 밤에 11/2 수업분을 적었다(마감 11/8 일)
      expect((await runDay("2026-11-07")).notified.map((i) => [i.recipientId, i.body])).toEqual([
        ["uTeacherA", "김민준 학생 11/2 수학 수업이 원스크린에 입력만 되고 보고서로 저장되지 않았습니다 — 11/8 22:30까지만 보낼 수 있습니다."],
      ]);
      expect((await runDay("2026-11-08")).n).toBe(0); // 일요일
      expect((await runDay("2026-11-09")).n).toBe(0); // 기한 지남
    });

    it("P6 — 같은 순위 입력자 둘이면 세션을 늦게 저장한 사람(계정 id 순이 아니라)", async () => {
      // 둘 다 P 담임이 아닌 재직 입력자 — 늦게 저장한 uTeacherB가 id 순으로는 뒤다.
      put("s1", D, P, { today: "먼저 적음", draft: "멘트" }, "uMakeup", kst(D, "17:00"));
      put("s1", D, P, { today: "나중에 고침", draft: "멘트" }, "uTeacherB", kst(D, "21:00"));
      m.tables.classes!.find((c) => c.id === P)!.teacher_id = null;
      expect((await runDay("2026-11-04")).notified.map((i) => i.recipientId)).toEqual(["uTeacherB"]);
    });

    it("V2 — 다른 과목 보고서의 교재는 자동 값 후보가 아니다", async () => {
      m.tables.lesson_reports!.push(report("prevEn", { student_id: "s1", report_date: "2026-10-29", subject: "english", class_id: E, textbook: "Grammar Zone", created_at: kst("2026-10-29"), classnote_status: "success" }));
      put("s1", D, P, { textbook: "Grammar Zone" });
      expect((await runDay("2026-11-04")).n).toBe(1);
    });

    it("V3 — 수업일 뒤 보고서의 교재는 자동 값 후보가 아니다", async () => {
      put("s1", D, P, { textbook: "쎈 중3-1" });
      put("s2", "2026-11-03", P, { today: "다음 날 진도", draft: "멘트" }); // 조회 범위를 11/3까지 넓힌다
      m.tables.lesson_reports!.push(report("after", { student_id: "s1", report_date: "2026-11-03", class_id: Q, textbook: "쎈 중3-1", created_at: kst("2026-11-03"), classnote_status: "success" }));
      expect((await runDay("2026-11-05")).n).toBe(2);
    });

    it("V5 — 교재요청서 교재는 수학 줄만 자동 값 — 영어 줄에 같은 교재를 쓰면 직접 쓴 흔적", async () => {
      m.tables.classes!.push({ id: E, tenant_id: T, subject: "english", teacher_id: "uTeacherA", is_active: true, report_optout: false });
      const [eS, eR] = history(E, HISTORY, HISTORY);
      m.tables.onescreen_daily_sessions!.push(...eS);
      m.tables.lesson_reports!.push(...eR);
      m.settings = { ...m.settings, report: { ...(m.settings.report as Row), classnoteSubjects: ["math", "english"] } };
      m.tables.textbook_orders = [{ id: "o1", tenant_id: T, student_id: "s1", book_name: "가우스 중2-1" }];
      put("s1", D, E, { textbook: "가우스 중2-1" });
      expect((await runDay("2026-11-04")).n).toBe(1);
    });

    it("V9 — 그 반의 다른 날 시트 계획은 자동 값이 아니다", async () => {
      m.tables.class_sheet_plan_lines = [{ id: "pl3", tenant_id: T, class_id: P, plan_date: "2026-11-03", slot_start: "15:00", line_no: 1, skill_area: "main", textbook: null, page_range: "p.20", progress: "2단원", homework: null }];
      put("s1", D, P, { today: "2단원 (p.20)" }); // 11/2엔 계획이 없다 — 11/3 계획과 같은 글을 직접 적었다
      put("s2", "2026-11-03", P, { today: "다음 날 진도", draft: "멘트" }); // 조회 범위를 11/3까지 넓힌다
      expect((await runDay("2026-11-05")).n).toBe(2);
    });
  });

  describe("배선 빈틈 고정(리뷰 경미 4 — 변이 S11·S13·S14·S15·S16·S2)", () => {
    it("발송 스위치가 꺼진 학원은 감지하지 않는다", async () => {
      m.settings = { ...m.settings, report: { ...(m.settings.report as Row), classnoteSendEnabled: false } };
      lesson("s1", P);
      expect(await runDay("2026-11-04")).toEqual({ n: 0, notified: [] });
    });

    it("테스트 학생은 울리지 않는다", async () => {
      m.tables.students!.find((s) => s.id === "s1")!.is_test = true;
      lesson("s1", P);
      expect((await runDay("2026-11-04")).notified).toEqual([]);
    });

    it("다른 학원의 세션은 읽지 않는다(우리 반 id를 들고 있어도)", async () => {
      m.tables.attendance_records!.push(present("s2", P)); // 그 반 그날 출결은 있다
      m.tables.onescreen_daily_sessions!.push({ id: "x-ses", tenant_id: "tenant-2", student_id: "sOther", session_date: D, updated_by: "uOther", subject_progress: { [P]: { today: "남의 학원", draft: "멘트" } } });
      expect((await runDay("2026-11-04")).notified).toEqual([]);
    });

    it("다른 학원의 출결은 세지 않는다(휴무일 반이 남의 출결로 '수업 있음'이 되지 않게)", async () => {
      lesson("s1", H, "uTeacherA", false);
      m.tables.attendance_records!.push({ id: "x-att", tenant_id: "tenant-2", student_id: "sOther", class_id: H, session_date: D, status: "present", recorded_at: kst(D, "19:00") });
      expect((await runDay("2026-11-04")).notified).toEqual([]);
    });

    it("세션이 1,000행을 넘어도 페이지를 넘겨 다 읽는다", async () => {
      const filler = Array.from({ length: 1000 }, (_, i) => ({
        id: `a${String(i).padStart(4, "0")}`, tenant_id: T, student_id: "sHist", session_date: "2026-10-20", updated_by: "uTeacherA", subject_progress: {},
      }));
      m.tables.onescreen_daily_sessions = [...filler, ...m.tables.onescreen_daily_sessions!];
      lesson("s1", P); // id 'ses…'는 'a…' 1,000행 뒤 — 두 번째 쪽에 있다
      expect((await runDay("2026-11-04")).notified.map((i) => i.recipientId)).toEqual(["uTeacherA"]);
    });

    it("지난 기록은 '저장 안 된 수업 보고서' 종류만 센다", async () => {
      lesson("s1", P);
      const key = `draft:s1:${D}:math:${P}`;
      m.tables.notification_events!.push(
        ...["2026-10-31", "2026-11-01", "2026-11-02"].map((d, i) => ({ id: `other${i}`, tenant_id: T, event_type: "unsent_report", subject_key: key, bucket: `remind:${d}`, seeded: false, created_at: kst(d, "07:00") })),
      );
      expect((await runDay("2026-11-04")).notified.map((i) => i.recipientId)).toEqual(["uTeacherA"]);
    });
  });

  it("받을 직원이 없으면 원장 1회분(작성률 표 링크) — 다음 날 반복하지 않는다", async () => {
    m.tables.classes!.find((c) => c.id === Q)!.teacher_id = null;
    lesson("s1", Q, "uGone");
    const first = await runDay("2026-11-04");
    expect(first.notified.map((i) => [i.recipientId, i.title, i.link])).toEqual([["uMaster", "저장 안 된 수업 보고서(담당 강사 없음)", "/lesson-reports?tab=writing"]]);
    expect(first.notified[0]?.body).toBe("김민준 학생 11/2 수학 수업은 다른 선생님이 원스크린에 입력만 해 두고 보고서로 저장하지 않았습니다 — 보고서를 작성해 주세요.");
    expect((await runDay("2026-11-05")).notified).toEqual([]);
  });

  it("첫 실행(기록 0건)도 시드하지 않고 밀린 건을 알린다 — 원장 2026-11-06", async () => {
    m.tables.notification_events = [];
    lesson("s1", P);
    const { n, notified } = await runDay("2026-11-04");
    expect(n).toBe(1);
    expect(notified.map((i) => i.recipientId)).toEqual(["uTeacherA"]);
    expect(m.tables.notification_events!.every((row) => row.seeded === false)).toBe(true);
  });

  it("두 단계 합쳐 최대 3번 — 입력 단계 2번 뒤 저장(안 보냄)하면 미발송 재알림은 1번만 · 같은 날 저장 뒤 다시 돌려도 그날은 조용", async () => {
    lesson("s1", P);
    expect((await runDay("2026-11-04", { reportsToo: true })).notified.map((i) => i.title)).toEqual(["저장 안 된 수업 보고서"]);
    expect((await runDay("2026-11-05", { reportsToo: true })).notified.map((i) => i.title)).toEqual(["저장 안 된 수업 보고서"]);
    // 11/5 08시에 저장만 하고 안 보냄 → 그날 다시 돌려도 오늘 이미 울렸으니 조용
    m.tables.lesson_reports!.push(report("rLate", { student_id: "s1", report_date: D, class_id: P, created_at: kst("2026-11-05", "08:00"), created_by: "uTeacherA" }));
    expect((await runDay("2026-11-05", { reportsToo: true, at: "09:00" })).notified).toEqual([]);
    const third = await runDay("2026-11-06", { reportsToo: true });
    expect(third.notified.map((i) => [i.recipientId, i.title])).toEqual([["uTeacherA", "미발송 보고서 확인"]]);
    expect((await runDay("2026-11-07", { reportsToo: true })).notified).toEqual([]);
  });
});
