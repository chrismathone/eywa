import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SeatStays } from "../next-destination";

/**
 * 다음 행선지 **조회가 받는 입력** — 접기(순수 [`../next-destination.ts`](../next-destination.ts))의 테스트는
 * `slotsByClass`를 직접 만들어 넣으니 이 경로(무엇을 조회에 넘기나)에 닿지 않는다.
 *
 * 🔴 잠그는 것 = 방 규칙의 **입력 절반**: 옮겨 가는 교시(남의 반 랩실 시각)의 강의실은 그 반의 배치에만 있어서,
 *    그날 이 자리 반들(`stays.classIds`)을 **같은 배치 조회**에 얹어야 안다(원장 2026-09-10 *"17:20 304호
 *    가야함처럼"* × *"다른 시간으로 옮기기"*). 종전 가드는 선언 문자열(`const slotClassIds = …`)만 봐서, 조회가
 *    옛 `classIds`를 받도록 되돌아가도(병합 충돌에서 변경 전 줄을 고르면 생기는 모양) tsc·eslint(경고 1건, 종료 0)·
 *    가드가 전부 통과했다 — 운영에선 '교시 하나' 보기에서 그 반을 아무도 안 들으면 `17:00 다음 수업`으로 방이 빠진다.
 * 그래서 가짜 PostgREST(체이닝 + thenable, 실제 `fetchInChunks`가 그대로 쓴다)가 `.in("class_id", …)`로 받은 반만
 * 돌려주게 하고 **결과**를 본다 — 조회 인자를 어떤 글자로 되돌리든 방이 빠져 실패한다.
 */

const TENANT = "11111111-1111-4111-8111-111111111111";
const THU = "2026-09-10"; // 목요일
const LAB = "본원603";

type Row = Record<string, unknown>;
type Filter = { col: string; op: "eq" | "in"; val: unknown };

const enrolled = (student_id: string, class_id: string): Row => ({
  tenant_id: TENANT,
  student_id,
  class_id,
  start_date: "2026-03-02",
  end_date: null,
  on_hold: false,
  is_transferred: false,
  attendance_days: null,
});
const labSlot = (class_id: string, start_time: string, classroom: { name: string } | null): Row => ({
  tenant_id: TENANT,
  class_id,
  day_of_week: "thu",
  start_time,
  slot_room_label: "603", // 실측 랩실 배치 라벨 — 강의실이 안 걸린 줄은 이것을 정본(`본원603`)으로 맞춘다([[#115]])
  slot_teacher_label: "LAB",
  classroom,
});

// d는 JP1(14:20 랩실)과 LE1(15:40 랩실)을 듣고, LE1 랩실을 PL4의 17:00으로 옮겼다. p만 PL4를 듣는다 —
// '교시 하나'(14:20) 보기의 물음(`studentIds`)엔 d뿐이라 **수강 축으로는 PL4가 조회에 안 들어온다**.
const TABLES: Record<string, Row[]> = {
  enrollments: [enrolled("d", "JP1"), enrolled("d", "LE1"), enrolled("p", "PL4")],
  class_schedules: [
    labSlot("JP1", "14:20:00", { name: LAB }),
    labSlot("LE1", "15:40:00", { name: LAB }),
    labSlot("PL4", "17:00:00", null),
  ],
  classrooms: [
    { tenant_id: TENANT, name: LAB },
    { tenant_id: TENANT, name: "본원304" },
  ],
};

const queries: { table: string; filters: Filter[] }[] = [];
const clients: ("admin" | "session")[] = [];

/** 최소 PostgREST 흉내 — `eq`·`in`만 거르고, 날짜 경계(`lte`·`or`·`not`)는 픽스처가 전부 그날 유효하게 둔다. */
function makeBuilder(table: string) {
  const filters: Filter[] = [];
  queries.push({ table, filters });
  const rows = () =>
    (TABLES[table] ?? []).filter((r) =>
      filters.every((f) => (f.op === "eq" ? r[f.col] === f.val : (f.val as unknown[]).includes(r[f.col]))),
    );
  const api = {
    select: () => api,
    eq: (col: string, val: unknown) => (filters.push({ col, op: "eq", val }), api),
    in: (col: string, val: unknown[]) => (filters.push({ col, op: "in", val }), api),
    not: () => api,
    lte: () => api,
    or: () => api,
    then: (ok: (v: { data: Row[]; error: null }) => unknown, err?: (e: unknown) => unknown) =>
      Promise.resolve({ data: rows(), error: null }).then(ok, err),
  };
  return api;
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => (clients.push("admin"), { from: (table: string) => makeBuilder(table) }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => (clients.push("session"), { from: (table: string) => makeBuilder(table) }),
}));

const { getSeatNextDestinationsBySlot } = await import("./next-destination");

/** 배치 조회(`class_schedules`)가 `.in("class_id", …)`로 받은 반 — 청크를 모두 합친다. */
const slotQueryClassIds = () =>
  queries
    .filter((q) => q.table === "class_schedules")
    .flatMap((q) => q.filters.filter((f) => f.op === "in" && f.col === "class_id").flatMap((f) => f.val as string[]))
    .sort();

const STAYS: SeatStays = { seat: "lab", startsByStudent: { d: ["14:20", "17:00"] }, classIds: ["JP1", "LE1", "PL4"] };

beforeEach(() => {
  queries.length = 0;
  clients.length = 0;
});

describe("조회 입력 — 이 자리 반들을 같은 배치 조회에 얹는다", () => {
  it.each([
    ["로그인 화면", undefined],
    ["공개 PIN 화면", TENANT],
  ])("🔴 %s: 옮겨 가는 교시(17:00)의 강의실을 안다 — 그 반(PL4)을 아무도 안 들어도", async (_, tenantId) => {
    const out = await getSeatNextDestinationsBySlot(["d"], THU, ["14:20"], { tenantId, stays: STAYS });
    expect(out).toEqual({ "14:20": { startByStudent: { d: "17:00" }, roomByStudent: { d: LAB } } });
    // 학생 반(JP1·LE1)에 이 자리 반(PL4)을 **합쳐 한 번** 조회한다 — 새 왕복이 아니다(B4·B6).
    expect(slotQueryClassIds()).toEqual(["JP1", "LE1", "PL4"]);
    expect(queries.filter((q) => q.table === "class_schedules")).toHaveLength(1);
  });

  it("이 자리 재료가 없으면(JJ실·옛 호출부) 옛 동작 그대로 — 학생 반의 배치만 읽는다", async () => {
    const out = await getSeatNextDestinationsBySlot(["d"], THU, ["14:20"]);
    expect(out).toEqual({ "14:20": { startByStudent: { d: "15:40" }, roomByStudent: { d: LAB } } });
    expect(slotQueryClassIds()).toEqual(["JP1", "LE1"]);
  });
});

describe("🔴 공개 PIN 경로 — 세션이 없어 admin으로 읽으니 테넌트 필터가 유일한 격리선", () => {
  it("세 조회(수강·배치·강의실) 모두 이 테넌트로 거르고, 세션 클라이언트를 만들지 않는다", async () => {
    await getSeatNextDestinationsBySlot(["d"], THU, ["14:20"], { tenantId: TENANT, stays: STAYS });
    expect(clients).toEqual(["admin"]);
    expect(new Set(queries.map((q) => q.table))).toEqual(new Set(["enrollments", "class_schedules", "classrooms"]));
    for (const q of queries) expect(q.filters).toContainEqual({ col: "tenant_id", op: "eq", val: TENANT });
  });
});
