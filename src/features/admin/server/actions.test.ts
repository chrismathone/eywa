import { beforeEach, describe, expect, it, vi } from "vitest";
import { MERGE_TABLES } from "../merge-scope";

/**
 * 데이터 정리 도구의 서버 액션(2026-10-06) — 병합 · 퇴원 학생의 남은 수강 종료.
 *  · 병합은 표를 하나씩 옮긴다(한 번에 묶는 트랜잭션이 아니다). 그래서 ① 두 학생이 실제로 있을 때만 시작하고,
 *    ② 어느 단계의 실패도 삼키지 않으며, ③ 중간에 멈추면 어디까지 옮겨졌는지 남긴다.
 *  · 🔴 "오류가 없었다"는 "바뀌었다"가 아니다 — 권한(RLS)이 막은 쓰기는 **오류 없이 0건**으로 끝난다(적대 리뷰 3 C2).
 *  · 🔴 "오류가 났다"도 "안 바뀌었다"가 아니다 — 응답만 끊긴 쓰기는 DB에서 이미 끝났을 수 있다(C3).
 * 그래서 **상태를 가진 모의 DB**로 돌린다: 쓰기는 실제로 행을 바꾸고, 표마다 권한(조회·변경)을 막을 수 있고,
 * "적용한 뒤 응답 실패"와 "건수 없는 성공 응답"을 끼워 넣을 수 있다. 합성 값만 쓴다.
 */
type Row = Record<string, unknown>;
type Op = {
  table: string;
  verb: "select" | "update" | "delete";
  payload?: Row;
  filters: unknown[][];
  /** select의 `{ count, head }` · update의 `{ count }`. */
  options?: { count?: string; head?: boolean };
  /** update 뒤 `.select()`로 바뀐 줄을 돌려받는가. */
  returning: boolean;
};
type Res = { data?: unknown; error?: { message: string; code?: string } | null; count?: number | null };
/** 한 번의 쓰기에 끼워 넣는 장애. */
type Fault = "reject" | "lost-response" | "no-count";

const m = vi.hoisted(() => ({
  actor: { id: "actor", tenantId: "tenant-a", systemRole: "master" } as { id: string; tenantId: string; systemRole: string } | null,
  allowed: true,
  tables: {} as Record<string, Record<string, unknown>[]>,
  /** 이 계정이 **바꿀 수 없는** 표(RLS) — 쓰기가 오류 없이 0건으로 끝난다. */
  denyUpdate: new Set<string>(),
  /** 조회 자체가 실패하는 표. */
  failRead: new Set<string>(),
  /** 쓰기마다 불려, 장애를 넣을지 정한다. */
  fault: (() => null) as (op: unknown) => unknown,
  /** 조회마다 불린다 — "읽은 직후 다른 창이 바꿨다"를 끼워 넣는 자리. */
  onRead: (() => {}) as (op: unknown) => void,
  ops: [] as unknown[],
  audit: vi.fn(),
  paths: vi.fn(),
}));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => m.actor }));
vi.mock("@/lib/auth/perm-matrix", () => ({ canWriteTenant: async () => m.allowed }));
vi.mock("@/features/audit/server/log", () => ({ logAction: m.audit }));
vi.mock("next/cache", () => ({ revalidatePath: m.paths }));
vi.mock("@/lib/observability/report-error", () => ({ reportError: vi.fn(), reportWarning: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      const op: Op = { table, verb: "select", filters: [], returning: false };
      const chain: Record<string, unknown> = {
        select: (_columns?: string, options?: Op["options"]) => {
          if (op.verb === "select") op.options = options;
          else op.returning = true;
          return chain;
        },
        update: (payload: Row, options?: Op["options"]) => {
          op.verb = "update";
          op.payload = payload;
          op.options = options;
          return chain;
        },
        // 빌더는 await되는 순간 실행된다(supabase-js와 같다).
        then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => {
          m.ops.push(op);
          return Promise.resolve(execute(op)).then(resolve, reject);
        },
      };
      for (const name of ["eq", "in", "is", "lte", "gt", "order", "range", "neq"]) {
        chain[name] = (...args: unknown[]) => {
          op.filters.push([name, ...args]);
          return chain;
        };
      }
      return chain;
    },
  }),
}));

/** 응답을 받지 못한 요청 — supabase-js는 코드 없는 오류와 건수 없음으로 돌려준다(DB가 거절했다는 뜻이 아니다). */
const LOST: Res = { data: null, error: { message: "TypeError: fetch failed", code: "" }, count: null };
/** DB가 문장을 거절했다(겹치는 기간 등) — 그 문장은 적용되지 않았다. */
const REJECTED: Res = { data: null, error: { message: 'conflicting key value violates exclusion constraint "x"', code: "23P01" }, count: null };

function matches(row: Row, filters: unknown[][]): boolean {
  return filters.every(([name, column, value]) => {
    const cell = row[column as string];
    if (name === "eq") return cell === value;
    if (name === "neq") return cell !== value;
    if (name === "in") return (value as unknown[]).includes(cell);
    if (name === "is") return cell === value || (value === null && cell === undefined);
    if (name === "lte") return String(cell) <= String(value);
    if (name === "gt") return String(cell) > String(value);
    return true;
  });
}

function execute(op: Op): Res {
  const rows = m.tables[op.table] ?? [];
  const where = op.filters.filter(([name]) => name !== "order" && name !== "range");
  if (op.verb === "select") {
    // 사전에 없는 오류 코드 — 화면에는 호출부의 기본 문구가 나간다(원문은 로그로만).
    if (m.failRead.has(op.table)) return { data: null, error: { message: "internal error: relation lookup failed", code: "XX000" }, count: null };
    let found = rows.filter((row) => matches(row, where));
    m.onRead(op);
    if (op.options?.head) return { data: null, error: null, count: found.length };
    const order = op.filters.find(([name]) => name === "order");
    if (order) found = [...found].sort((a, b) => String(a[order[1] as string]).localeCompare(String(b[order[1] as string])));
    const range = op.filters.find(([name]) => name === "range");
    if (range) found = found.slice(range[1] as number, (range[2] as number) + 1);
    return { data: found.map((row) => ({ ...row })), error: null };
  }
  const fault = m.fault(op) as Fault | null;
  if (fault === "reject") return REJECTED;
  // 권한이 막은 쓰기 — 오류 없이 0건.
  const targets = m.denyUpdate.has(op.table) ? [] : rows.filter((row) => matches(row, where));
  for (const row of targets) Object.assign(row, op.payload);
  // DB에서는 끝났는데 응답이 돌아오지 못했다.
  if (fault === "lost-response") return LOST;
  return {
    data: op.returning ? targets.map((row) => ({ id: row.id })) : null,
    error: null,
    count: op.options?.count && fault !== "no-count" ? targets.length : null,
  };
}

import { closeOrphanEnrollments, mergeStudents } from "./actions";

const KEEPER = "11111111-1111-4111-8111-111111111111";
const MERGEE = "22222222-2222-4222-8222-222222222222";
const ops = () => m.ops as Op[];
const writes = () => ops().filter((op) => op.verb === "update");
const filterOf = (op: Op, name: string) => op.filters.find((f) => f[0] === name);
const form = (keeperId = KEEPER, mergeeId = MERGEE) => {
  const fd = new FormData();
  fd.set("keeperId", keeperId);
  fd.set("mergeeId", mergeeId);
  return fd;
};
const student = (id: string) => m.tables.students!.find((row) => row.id === id)!;
const ownedBy = (table: string, studentId: string) => m.tables[table]!.filter((row) => row.student_id === studentId).length;
/** 그 표의 n번째(1부터) 쓰기에 장애를 넣는다. */
function faultOn(table: string, kind: Fault, nth = 1) {
  let seen = 0;
  m.fault = (raw) => {
    const op = raw as Op;
    if (op.table !== table) return null;
    seen += 1;
    return seen === nth ? kind : null;
  };
}
const lastAudit = () => m.audit.mock.calls.at(-1)![0] as { action: string; targetLabel?: string; metadata: Record<string, unknown> };

beforeEach(() => {
  vi.clearAllMocks();
  m.actor = { id: "actor", tenantId: "tenant-a", systemRole: "master" };
  m.allowed = true;
  m.ops = [];
  m.denyUpdate = new Set();
  m.failRead = new Set();
  m.fault = () => null;
  m.onRead = () => {};
  m.tables = {};
});

describe("mergeStudents", () => {
  /** 두 학생과, 진 쪽이 가진 기록. `rows`에 적은 표만 기록이 있다. */
  function seed(rows: Record<string, number> = { enrollments: 2, attendance_records: 30, invoices: 1, enrollment_consultations: 1 }) {
    m.tables = Object.fromEntries(MERGE_TABLES.map(({ table }) => [table, [] as Row[]]));
    m.tables.students = [
      { id: KEEPER, name: "권민서A", notes: null, status: "enrolled", dup_suspect: true },
      { id: MERGEE, name: "권민서B", notes: "셔틀 3호차", status: "enrolled", dup_suspect: true },
    ];
    for (const [table, count] of Object.entries(rows)) {
      m.tables[table] = Array.from({ length: count }, (_, i) => ({ id: `${table}-${i}`, student_id: MERGEE }));
    }
    // 남길 쪽이 원래 갖고 있던 기록 — 병합이 건드리면 안 된다.
    m.tables.enrollments!.push({ id: "keeper-own", student_id: KEEPER });
  }
  const movedTables = () => writes().filter((op) => op.table !== "students").map((op) => op.table);

  it("권한이 없으면 조회도 하지 않는다", async () => {
    seed();
    m.allowed = false;
    expect((await mergeStudents(undefined, form()))?.error).toContain("권한");
    expect(ops()).toHaveLength(0);
  });

  it("같은 학생끼리 · 빈 값은 받지 않는다", async () => {
    seed();
    expect((await mergeStudents(undefined, form(KEEPER, KEEPER)))?.error).toBeTruthy();
    expect((await mergeStudents(undefined, form("", MERGEE)))?.error).toBeTruthy();
    expect(ops()).toHaveLength(0);
  });

  it("정상 — 기록이 실제로 남길 쪽으로 옮겨지고, 진 쪽이 퇴원하고, 남길 쪽의 표식이 내려가고, 한 번 기록된다", async () => {
    seed();
    const res = await mergeStudents(undefined, form());
    expect(res).toEqual({ mergedRows: 34 });
    // 옮기는 표 = 화면 안내와 같은 목록(merge-scope.ts)의 차례. 옮길 것이 없는 표에는 쓰지 않는다.
    expect(movedTables()).toEqual(["enrollments", "attendance_records", "invoices", "enrollment_consultations"]);
    for (const { table } of MERGE_TABLES) expect(ownedBy(table, MERGEE), table).toBe(0);
    expect(ownedBy("enrollments", KEEPER)).toBe(3);
    expect(ownedBy("attendance_records", KEEPER)).toBe(30);
    // 진 쪽: 퇴원 + 원래 메모는 표식 뒤에 남는다.
    expect(student(MERGEE)).toMatchObject({ status: "withdrawn", dup_suspect: false });
    expect(String(student(MERGEE).notes)).toMatch(/^중복 병합: .*\n셔틀 3호차$/);
    expect(student(KEEPER)).toMatchObject({ status: "enrolled", dup_suspect: false });

    expect(m.audit).toHaveBeenCalledOnce();
    expect(lastAudit()).toMatchObject({ action: "student_merge", targetLabel: "권민서A" });
    expect(lastAudit().metadata).toMatchObject({
      studentId: KEEPER,
      mergedStudentId: MERGEE,
      mergedName: "권민서B",
      mergedRows: 34,
      moved: { enrollments: 2, attendance_records: 30, invoices: 1, student_memos: 0, enrollment_consultations: 1 },
    });
    expect(lastAudit().metadata).not.toHaveProperty("partial");
    expect(m.paths).toHaveBeenCalledWith("/owner");
    expect(m.paths).toHaveBeenCalledWith("/students");
  });

  it("진 쪽이 소개한 콜&상담(0361a)의 소개 연결도 남는 쪽으로 옮긴다 — 강사평가 원생 소개가 담임을 잃지 않게", async () => {
    seed({});
    m.tables.enrollment_consultations = [{ id: "ref-1", student_id: null, referrer_student_id: MERGEE }, { id: "ref-2", student_id: null, referrer_student_id: "other" }];
    await mergeStudents(undefined, form());
    expect(m.tables.enrollment_consultations.map((r) => r.referrer_student_id)).toEqual([KEEPER, "other"]);
  });
  it("옮길 기록이 하나도 없는 두 학생도 병합된다(진 쪽만 퇴원한다)", async () => {
    seed({});
    expect(await mergeStudents(undefined, form())).toEqual({ mergedRows: 0 });
    expect(movedTables()).toEqual([]);
    expect(student(MERGEE).status).toBe("withdrawn");
    expect(m.audit).toHaveBeenCalledOnce();
  });

  describe("🔴 두 학생이 실제로 있을 때만 시작한다", () => {
    it.each([
      ["진 쪽이 없다(이미 지워짐 · 다른 지점)", [KEEPER]],
      ["남길 쪽이 없다", [MERGEE]],
      ["둘 다 없다", []],
    ])("%s → 한 줄도 쓰지 않는다", async (_label, present) => {
      seed();
      m.tables.students = m.tables.students!.filter((row) => (present as string[]).includes(row.id as string));
      const res = await mergeStudents(undefined, form());
      expect(res?.error).toContain("찾지 못했습니다");
      expect(res?.mergedRows).toBeUndefined();
      expect(writes()).toHaveLength(0);
      expect(m.audit).not.toHaveBeenCalled();
    });

    it("두 학생을 읽지 못했으면 멈춘다 — DB 원문을 화면에 내보내지 않는다", async () => {
      seed();
      m.failRead.add("students");
      const res = await mergeStudents(undefined, form());
      expect(res?.error).toBe("학생을 확인하지 못했습니다. 잠시 뒤 다시 시도해 주세요.");
      expect(res?.error).not.toContain("relation lookup");
      expect(writes()).toHaveLength(0);
    });

    it("옮길 건수를 세지 못했으면 시작하지 않는다(견줄 기준이 없다)", async () => {
      seed();
      m.failRead.add("invoices");
      const res = await mergeStudents(undefined, form());
      expect(res?.error).toContain("옮길 기록을 확인하지 못했습니다");
      expect(writes()).toHaveLength(0);
      expect(ownedBy("enrollments", MERGEE)).toBe(2);
    });
  });

  describe("DB가 거절한 단계 — 그 문장은 적용되지 않았다", () => {
    it("첫 표에서 거절 → 옮겨진 것이 없다고 알리고, 기록하지 않는다(바뀐 것이 없다)", async () => {
      seed();
      faultOn("enrollments", "reject");
      const res = await mergeStudents(undefined, form());
      expect(res?.error).toContain("'수강 기록 옮기기' 단계에서 멈췄습니다");
      expect(res?.error).toContain("옮겨진 기록은 없습니다");
      expect(res?.error).not.toContain("exclusion constraint");
      expect(ownedBy("enrollments", MERGEE)).toBe(2);
      expect(m.audit).not.toHaveBeenCalled();
    });

    it("셋째 표에서 거절 → 뒤 표는 건드리지 않고, 앞 두 표가 옮겨진 사실과 멈춘 자리를 남긴다", async () => {
      seed();
      faultOn("invoices", "reject");
      const res = await mergeStudents(undefined, form());
      expect(res?.error).toContain("'청구 기록 옮기기' 단계에서 멈췄습니다");
      expect(res?.error).toContain("앞 단계까지는 이미 옮겨졌습니다");
      expect(res?.mergedRows).toBeUndefined();
      expect(ownedBy("enrollments", MERGEE)).toBe(0);
      expect(ownedBy("invoices", MERGEE)).toBe(1);
      expect(ownedBy("enrollment_consultations", MERGEE)).toBe(1);
      // 진 쪽은 퇴원시키지 않는다 — 목록에 남아야 다시 병합해 이어 갈 수 있다.
      expect(student(MERGEE).status).toBe("enrolled");
      expect(m.audit).toHaveBeenCalledOnce();
      expect(lastAudit().metadata).toMatchObject({ partial: true, failedStep: "청구 기록 옮기기", mergedRows: 32 });
      expect(lastAudit().metadata).not.toHaveProperty("uncertain");
      expect(m.paths).toHaveBeenCalledWith("/owner");
    });

    it("🔴 멈춘 뒤 같은 두 학생을 다시 병합하면 이어진다 — 이미 옮긴 기록은 다시 옮기지 않는다", async () => {
      seed();
      faultOn("invoices", "reject");
      await mergeStudents(undefined, form());
      m.fault = () => null;
      m.ops = [];
      const res = await mergeStudents(undefined, form());
      expect(res).toEqual({ mergedRows: 2 });
      expect(movedTables()).toEqual(["invoices", "enrollment_consultations"]);
      for (const { table } of MERGE_TABLES) expect(ownedBy(table, MERGEE), table).toBe(0);
      expect(student(MERGEE).status).toBe("withdrawn");
    });

    it("마지막 표(콜&상담)의 실패도 삼키지 않는다 — 종전엔 오류를 보지 않고 지나갔다", async () => {
      seed();
      faultOn("enrollment_consultations", "reject");
      const res = await mergeStudents(undefined, form());
      expect(res?.error).toContain("'콜&상담 기록 옮기기' 단계에서 멈췄습니다");
      expect(student(MERGEE).status).toBe("enrolled");
      expect(lastAudit().metadata).toMatchObject({ partial: true, failedStep: "콜&상담 기록 옮기기" });
    });

    it("진 쪽 퇴원 처리의 실패도 삼키지 않는다 — '이전 완료'라고 답하지 않는다", async () => {
      seed();
      faultOn("students", "reject");
      const res = await mergeStudents(undefined, form());
      expect(res?.error).toContain("'중복 학생 퇴원 처리' 단계에서 멈췄습니다");
      expect(res?.mergedRows).toBeUndefined();
      // 남길 쪽의 표식은 내리지 않는다(병합이 끝나지 않았다).
      expect(student(KEEPER).dup_suspect).toBe(true);
      expect(lastAudit().metadata).toMatchObject({ partial: true, failedStep: "중복 학생 퇴원 처리", mergedRows: 34 });
    });
  });

  describe("🔴 오류 없이 0건 — 권한이 막은 쓰기를 '옮겼다'고 치지 않는다", () => {
    it("청구를 바꿀 수 없는 계정 → 청구에서 멈춘다(진 쪽을 퇴원시키고 '완료'라고 답하지 않는다)", async () => {
      seed();
      m.denyUpdate.add("invoices");
      const res = await mergeStudents(undefined, form());
      expect(res?.error).toContain("'청구 기록 옮기기' 단계에서 멈췄습니다");
      expect(res?.error).toContain("1건 가운데 0건만 바뀌었습니다");
      expect(res?.mergedRows).toBeUndefined();
      expect(ownedBy("invoices", MERGEE)).toBe(1);
      expect(student(MERGEE).status).toBe("enrolled");
      expect(lastAudit().metadata).toMatchObject({ partial: true, failedStep: "청구 기록 옮기기", mergedRows: 32 });
    });

    it("수강을 바꿀 수 없는 계정 → 첫 표에서 멈추고, 바뀐 것이 없으니 기록하지 않는다", async () => {
      seed();
      m.denyUpdate.add("enrollments");
      const res = await mergeStudents(undefined, form());
      expect(res?.error).toContain("2건 가운데 0건만 바뀌었습니다");
      expect(res?.error).toContain("옮겨진 기록은 없습니다");
      expect(movedTables()).toEqual(["enrollments"]);
      expect(m.audit).not.toHaveBeenCalled();
    });

    it("학생을 바꿀 수 없는 계정 → 진 쪽이 재원인 채인데 '완료'라고 답하지 않는다", async () => {
      seed({ student_memos: 3 });
      m.denyUpdate.add("students");
      const res = await mergeStudents(undefined, form());
      expect(res?.error).toContain("'중복 학생 퇴원 처리' 단계에서 멈췄습니다");
      expect(res?.mergedRows).toBeUndefined();
      expect(student(MERGEE).status).toBe("enrolled");
      // 메모는 이미 옮겨졌다 — 그 사실을 남긴다.
      expect(ownedBy("student_memos", KEEPER)).toBe(3);
      expect(lastAudit().metadata).toMatchObject({ partial: true, failedStep: "중복 학생 퇴원 처리", mergedRows: 3 });
    });
  });

  describe("🔴 응답을 받지 못한 쓰기 — 적용됐는지 모른다('바뀐 것이 없다'고 단정하지 않는다)", () => {
    it("첫 표가 DB에서는 옮겨졌는데 응답이 끊겼다 → 미확인으로 알리고, 남기고, 목록을 새로 읽게 한다", async () => {
      seed();
      faultOn("enrollments", "lost-response");
      const res = await mergeStudents(undefined, form());
      expect(res?.error).toContain("'수강 기록 옮기기' 단계가 적용됐는지 확인하지 못했습니다");
      expect(res?.error).not.toContain("옮겨진 기록은 없습니다");
      // 실제로는 옮겨져 있다.
      expect(ownedBy("enrollments", MERGEE)).toBe(0);
      expect(m.audit).toHaveBeenCalledOnce();
      expect(lastAudit().metadata).toMatchObject({ partial: true, uncertain: true, failedStep: "수강 기록 옮기기" });
      expect(m.paths).toHaveBeenCalledWith("/owner");
      expect(m.paths).toHaveBeenCalledWith("/students");
    });

    it("옮길 기록이 없는 두 학생 — 퇴원 처리가 적용된 뒤 응답이 끊겼다 → 무기록으로 지나가지 않는다", async () => {
      seed({});
      faultOn("students", "lost-response");
      const res = await mergeStudents(undefined, form());
      expect(res?.error).toContain("'중복 학생 퇴원 처리' 단계가 적용됐는지 확인하지 못했습니다");
      expect(student(MERGEE).status).toBe("withdrawn");
      expect(lastAudit().metadata).toMatchObject({ partial: true, uncertain: true, mergedRows: 0 });
      expect(m.paths).toHaveBeenCalledWith("/owner");
    });

    it("성공했는데 건수가 없는 응답 → 몇 건이 옮겨졌는지 모른다: 미확인으로 멈추고, 남기고, 목록을 새로 읽게 한다", async () => {
      seed();
      faultOn("attendance_records", "no-count");
      const res = await mergeStudents(undefined, form());
      expect(res?.error).toContain("'출결 기록 옮기기' 단계가 적용됐는지 확인하지 못했습니다");
      expect(res?.mergedRows).toBeUndefined();
      // 실제로는 옮겨져 있다 — 진 쪽은 퇴원시키지 않는다(확인한 뒤 다시 병합해 이어 간다).
      expect(ownedBy("attendance_records", MERGEE)).toBe(0);
      expect(student(MERGEE).status).toBe("enrolled");
      expect(lastAudit().metadata).toMatchObject({ partial: true, uncertain: true, failedStep: "출결 기록 옮기기", mergedRows: 2 });
      expect(m.paths).toHaveBeenCalledWith("/owner");
    });

    it("🔴 건수 없는 응답 뒤, 그사이 다른 창이 진 쪽에 기록을 더했다 → '옮겨진 기록은 없습니다'라고 답하지 않는다", async () => {
      // 진 쪽의 수강 한 건이 실제로 남길 쪽으로 옮겨졌다. 응답에 건수가 없고, 그 직후 다른 창이 진 쪽에 새 수강을 넣었다.
      // 남은 건수를 다시 세어 빼면 1 - 1 = 0건이 되어 "바뀐 것이 없다"로 읽힌다 — 그렇게 확정하지 않는다.
      seed({ enrollments: 1 });
      m.fault = (raw) => {
        const op = raw as Op;
        if (op.table !== "enrollments") return null;
        queueMicrotask(() => m.tables.enrollments!.push({ id: "added-elsewhere", student_id: MERGEE }));
        return "no-count";
      };
      const res = await mergeStudents(undefined, form());
      expect(res?.error).toContain("적용됐는지 확인하지 못했습니다");
      expect(res?.error).not.toContain("옮겨진 기록은 없습니다");
      expect(ownedBy("enrollments", KEEPER)).toBe(2); // 원래 것 1 + 옮겨진 1
      expect(m.audit).toHaveBeenCalledOnce();
      expect(lastAudit().metadata).toMatchObject({ partial: true, uncertain: true });
      expect(m.paths).toHaveBeenCalledWith("/owner");
      expect(m.paths).toHaveBeenCalledWith("/students");
    });

    it("세고 난 뒤 쓰기 전에 다른 창이 기록을 더했다 → 멈추지 않고, 실제로 옮긴 건수(응답의 건수)를 남긴다", async () => {
      seed({ enrollments: 1 });
      // 마지막 표의 건수를 센 직후(첫 쓰기 전) 진 쪽에 수강이 하나 더 들어온다 — 센 건수는 1, 실제로 옮겨지는 건 2.
      const lastTable = MERGE_TABLES.at(-1)!.table;
      m.onRead = (raw) => {
        const op = raw as Op;
        if (op.table === lastTable && op.options?.head) {
          m.onRead = () => {};
          queueMicrotask(() => m.tables.enrollments!.push({ id: "added-before-write", student_id: MERGEE }));
        }
      };
      const res = await mergeStudents(undefined, form());
      expect(res).toEqual({ mergedRows: 2 });
      expect(lastAudit().metadata.moved).toMatchObject({ enrollments: 2 });
      expect(ownedBy("enrollments", MERGEE)).toBe(0);
      expect(student(MERGEE).status).toBe("withdrawn");
    });
  });

  describe("남길 쪽 표식 내리기 — 병합은 끝난 것이다: 완료로 답하고 남은 일을 알린다", () => {
    it("표식 내리기가 거절됐다", async () => {
      seed();
      faultOn("students", "reject", 2);
      const res = await mergeStudents(undefined, form());
      expect(res?.error).toBeUndefined();
      expect(res?.mergedRows).toBe(34);
      expect(res?.warning).toContain("'정상 확인'");
      expect(student(MERGEE).status).toBe("withdrawn");
      expect(lastAudit().metadata).not.toHaveProperty("partial");
    });

    it("🔴 표식 내리기가 오류 없이 0줄이었다 → 내렸다고 치지 않고 알린다", async () => {
      seed();
      // 남길 쪽이 그사이 목록에서 사라졌다(다른 창이 지움) — 진 쪽 퇴원은 됐고 표식을 내릴 줄이 없다.
      m.fault = (raw) => {
        const op = raw as Op;
        if (op.table === "students" && (op.payload as { status?: string }).status === "withdrawn") {
          queueMicrotask(() => {
            m.tables.students = m.tables.students!.filter((row) => row.id !== KEEPER);
          });
        }
        return null;
      };
      const res = await mergeStudents(undefined, form());
      expect(res?.mergedRows).toBe(34);
      expect(res?.warning).toContain("'정상 확인'");
    });
  });
});

describe("closeOrphanEnrollments", () => {
  const TODAY = /^\d{4}-\d{2}-\d{2}$/;
  /** 퇴원 학생 n명. 학생마다 시작한 열린 수강 `started`개. `future` = 아직 시작 전인 열린 수강(첫 학생의 것). */
  function seed(opts: { withdrawn?: number; started?: number; future?: string[] } = {}) {
    const students = Array.from({ length: opts.withdrawn ?? 3 }, (_, i) => ({ id: `s-${String(i).padStart(4, "0")}`, status: "withdrawn" }));
    m.tables = {
      students: [...students, { id: "s-live", status: "enrolled" }],
      enrollments: [
        ...students.flatMap((s) =>
          Array.from({ length: opts.started ?? 1 }, (_, i) => ({ id: `e-${s.id}-${i}`, student_id: s.id, start_date: "2020-01-01", end_date: null as string | null })),
        ),
        ...(opts.future ?? []).map((start, i) => ({ id: `e-future-${i}`, student_id: students[0]?.id, start_date: start, end_date: null as string | null })),
        // 재원생의 열린 수강 · 이미 닫힌 수강 — 건드리면 안 된다.
        { id: "e-live", student_id: "s-live", start_date: "2020-01-01", end_date: null },
        { id: "e-closed", student_id: students[0]?.id, start_date: "2019-01-01", end_date: "2019-12-31" },
      ],
    };
  }
  const enrollment = (id: string) => m.tables.enrollments!.find((row) => row.id === id)!;
  const openOfWithdrawn = () => m.tables.enrollments!.filter((row) => row.end_date === null && row.student_id !== "s-live").length;

  it("권한이 없으면 조회도 하지 않는다", async () => {
    seed();
    m.allowed = false;
    expect((await closeOrphanEnrollments(undefined, new FormData()))?.error).toContain("권한");
    expect(ops()).toHaveLength(0);
  });

  it("퇴원 학생이 없으면 아무것도 쓰지 않고 기록도 없다", async () => {
    seed({ withdrawn: 0 });
    expect(await closeOrphanEnrollments(undefined, new FormData())).toEqual({ closedCount: 0 });
    expect(writes()).toHaveLength(0);
    expect(m.audit).not.toHaveBeenCalled();
  });

  it("퇴원 학생 목록은 id 순으로 페이지를 넘겨 읽는다(1,000명 넘어도 빠지지 않게)", async () => {
    seed({ withdrawn: 1001 });
    const res = await closeOrphanEnrollments(undefined, new FormData());
    expect(res).toEqual({ closedCount: 1001 });
    const reads = ops().filter((op) => op.table === "students");
    expect(reads).toHaveLength(2);
    for (const op of reads) expect(filterOf(op, "order")).toEqual(["order", "id"]);
    expect(openOfWithdrawn()).toBe(0);
  });

  it("🔴 닫은 건수를 누가 했는지와 함께 남긴다 — 재원생의 수강·이미 닫힌 수강은 건드리지 않는다", async () => {
    seed({ withdrawn: 3, started: 2, future: ["2099-01-01"] });
    const res = await closeOrphanEnrollments(undefined, new FormData());
    expect(res).toEqual({ closedCount: 7 });
    expect(openOfWithdrawn()).toBe(0);
    expect(enrollment("e-live").end_date).toBeNull();
    expect(enrollment("e-closed").end_date).toBe("2019-12-31");
    // 시작 전인 수강은 그 시작일로 닫는다(오늘로 닫으면 기간이 뒤집힌다).
    expect(enrollment("e-future-0").end_date).toBe("2099-01-01");
    expect(String(enrollment("e-s-0000-0").end_date)).toMatch(TODAY);

    expect(m.audit).toHaveBeenCalledOnce();
    expect(lastAudit().action).toBe("enrollment_orphan_close");
    // 종료일은 수강마다 다르다 — 처리한 날과, 시작일로 닫은 건수를 따로 남긴다.
    expect(lastAudit().metadata).toMatchObject({ count: 7, futureCount: 1 });
    expect(String(lastAudit().metadata.processedOn)).toMatch(TODAY);
    expect(lastAudit().metadata).not.toHaveProperty("endDate");
    expect(lastAudit().metadata).not.toHaveProperty("partial");
    expect(m.paths).toHaveBeenCalledWith("/owner");
  });

  it("닫을 것이 없었으면 쓰지도 기록하지도 않는다", async () => {
    seed({ withdrawn: 3, started: 0 });
    expect(await closeOrphanEnrollments(undefined, new FormData())).toEqual({ closedCount: 0 });
    expect(writes()).toHaveLength(0);
    expect(m.audit).not.toHaveBeenCalled();
  });

  it("둘째 묶음에서 DB가 거절했다 → 첫 묶음에서 닫은 만큼은 남기고, 화면에도 그렇게 알린다", async () => {
    seed({ withdrawn: 250 });
    faultOn("enrollments", "reject", 2);
    const res = await closeOrphanEnrollments(undefined, new FormData());
    expect(res?.closedCount).toBeUndefined();
    expect(res?.error).toContain("100건은 이미 종료됐습니다");
    expect(res?.error).not.toContain("exclusion constraint");
    expect(openOfWithdrawn()).toBe(150);
    expect(lastAudit().metadata).toMatchObject({ count: 100, partial: true });
    expect(lastAudit().metadata).not.toHaveProperty("uncertain");
  });

  it("첫 묶음에서 거절 → 닫은 것이 없으니 기록하지 않고, 실패만 알린다", async () => {
    seed();
    faultOn("enrollments", "reject");
    const res = await closeOrphanEnrollments(undefined, new FormData());
    expect(res?.error).toBeTruthy();
    expect(res?.error).not.toContain("이미 종료됐습니다");
    expect(m.audit).not.toHaveBeenCalled();
  });

  describe("🔴 실제로 바뀐 줄만 센다", () => {
    it("수강을 바꿀 수 없는 계정(오류 없이 0건) → '0건 종료 완료'가 아니라 못 했다고 알린다", async () => {
      seed({ withdrawn: 3, future: ["2099-01-01"] });
      m.denyUpdate.add("enrollments");
      const res = await closeOrphanEnrollments(undefined, new FormData());
      expect(res?.closedCount).toBeUndefined();
      expect(res?.error).toContain("권한이 있는 계정인지 확인");
      expect(openOfWithdrawn()).toBe(4);
      expect(m.audit).not.toHaveBeenCalled();
    });

    it("시작 전 수강을 읽은 뒤 다른 창이 지웠다 → 닫았다고 세지 않는다(기록의 건수가 실제와 같다)", async () => {
      seed({ withdrawn: 1, future: ["2099-01-01", "2099-02-01"] });
      // 일괄 종료가 끝난 직후(시작 전 수강을 하나씩 닫기 전) 다른 창이 첫 시작 전 수강을 지운다.
      let bulkDone = false;
      m.fault = (raw) => {
        const op = raw as Op;
        if (op.table === "enrollments" && filterOf(op, "in") && !bulkDone) {
          bulkDone = true;
          queueMicrotask(() => {
            m.tables.enrollments = m.tables.enrollments!.filter((row) => row.id !== "e-future-0");
          });
        }
        return null;
      };
      const res = await closeOrphanEnrollments(undefined, new FormData());
      // 시작한 수강 1 + 남아 있던 시작 전 수강 1 = 2(지워진 것은 세지 않는다).
      expect(res?.closedCount).toBe(2);
      expect(res?.warning).toContain("1건은 종료되지 않았습니다");
      expect(lastAudit().metadata).toMatchObject({ count: 2, futureCount: 1 });
    });

    it("시작 전 수강 — 첫 줄은 닫히고 둘째 줄에서 거절 → 닫은 한 줄까지 남긴다", async () => {
      seed({ withdrawn: 1, started: 0, future: ["2099-01-01", "2099-02-01"] });
      faultOn("enrollments", "reject", 2);
      const res = await closeOrphanEnrollments(undefined, new FormData());
      expect(res?.error).toContain("1건은 이미 종료됐습니다");
      expect(enrollment("e-future-0").end_date).toBe("2099-01-01");
      expect(enrollment("e-future-1").end_date).toBeNull();
      expect(lastAudit().metadata).toMatchObject({ count: 1, futureCount: 1, partial: true });
    });
  });

  describe("🔴 응답을 받지 못한 쓰기 — 적용됐는지 모른다", () => {
    it("일괄 종료가 DB에서는 끝났는데 응답이 끊겼다 → 미확인으로 알리고, 닫은 것이 0건으로 세어져도 남긴다", async () => {
      seed({ withdrawn: 3 });
      faultOn("enrollments", "lost-response");
      const res = await closeOrphanEnrollments(undefined, new FormData());
      expect(res?.error).toContain("적용됐는지 확인하지 못했습니다");
      expect(res?.closedCount).toBeUndefined();
      expect(openOfWithdrawn()).toBe(0);
      expect(m.audit).toHaveBeenCalledOnce();
      expect(lastAudit().metadata).toMatchObject({ count: 0, partial: true, uncertain: true });
      expect(m.paths).toHaveBeenCalledWith("/owner");
    });

    it("성공했는데 건수가 없는 응답도 미확인이다(몇 건을 닫았는지 모른다)", async () => {
      seed({ withdrawn: 3 });
      faultOn("enrollments", "no-count");
      const res = await closeOrphanEnrollments(undefined, new FormData());
      expect(res?.error).toContain("적용됐는지 확인하지 못했습니다");
      expect(lastAudit().metadata).toMatchObject({ uncertain: true });
    });
  });

  it("닫을 대상을 읽지 못했으면(쓰기 전) 그 묶음은 바뀐 것이 없다 — 미확인으로 알리지 않는다", async () => {
    seed({ withdrawn: 3 });
    // 퇴원 학생 목록은 읽히고, 수강 조회만 실패한다.
    m.failRead.add("enrollments");
    const res = await closeOrphanEnrollments(undefined, new FormData());
    expect(res?.error).toBeTruthy();
    expect(res?.error).not.toContain("적용됐는지");
    expect(writes()).toHaveLength(0);
    expect(m.audit).not.toHaveBeenCalled();
  });
});
