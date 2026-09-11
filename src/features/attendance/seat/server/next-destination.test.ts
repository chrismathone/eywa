import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
 * 그래서 가짜 PostgREST(체이닝 + thenable, 실제 `fetchAllPagedInChunks`가 그대로 쓴다)가 `.in("class_id", …)`로 받은 반만
 * 돌려주게 하고 **결과**를 본다 — 조회 인자를 어떤 글자로 되돌리든 방이 빠져 실패한다.
 *
 * 2026-09-11 추가로 잠그는 것:
 * - **반 기본 강의실 상속**(원장 *"이도윤B는 왜 … 1620 다음수업이라고만 되어있지?"*) — 배치에 방이 없으면 반 기본
 *   강의실. 가짜는 select 문자열을 해석하지 않으므로 **임베드 문자열**도 따로 본다(진짜 PostgREST가 돌려주게).
 * - **마지막 수업**은 조회가 확인한 학생만 — 실패하면 모름(아무것도 안 적는다), 1,000행에서 잘려도 거짓으로 서지 않는다.
 */

const TENANT = "11111111-1111-4111-8111-111111111111";
const THU = "2026-09-10"; // 목요일
const FRI = "2026-09-11"; // 금요일
const LAB = "본원603";

type Row = Record<string, unknown>;
type Filter = { col: string; op: "eq" | "in"; val: unknown };

const enrolled = (student_id: string, class_id: string): Row => ({
  id: `e-${student_id}-${class_id}`,
  tenant_id: TENANT,
  student_id,
  class_id,
  start_date: "2026-03-02",
  end_date: null,
  on_hold: false,
  is_transferred: false,
  attendance_days: null,
});
/** 배치 한 줄 — 임베드(`classroom`·`class`)는 진짜 PostgREST가 돌려주는 모양 그대로 둔다. */
const slotRow = (o: {
  classId: string;
  dow: "thu" | "fri";
  start: string;
  end?: string;
  teacherLabel?: string | null;
  roomLabel?: string | null;
  room?: string | null;
  className?: string;
  classRoom?: string | null;
  id?: string;
}): Row => ({
  id: o.id ?? `s-${o.classId}-${o.dow}-${o.start}`,
  tenant_id: TENANT,
  class_id: o.classId,
  day_of_week: o.dow,
  start_time: `${o.start}:00`,
  end_time: o.end ? `${o.end}:00` : null,
  slot_room_label: o.roomLabel ?? null,
  slot_teacher_label: o.teacherLabel ?? null,
  classroom: o.room ? { name: o.room } : null,
  class: { class_name: o.className ?? o.classId, classroom: o.classRoom ? { name: o.classRoom } : null },
});
// 실측 랩실 배치 라벨 — 강의실이 안 걸린 줄은 이것을 정본(`본원603`)으로 맞춘다([[#115]]).
const labSlot = (classId: string, start: string, room: string | null): Row =>
  slotRow({ classId, dow: "thu", start, teacherLabel: "LAB", roomLabel: "603", room });

// d는 JP1(14:20 랩실)과 LE1(15:40 랩실)을 듣고, LE1 랩실을 PL4의 17:00으로 옮겼다. p만 PL4를 듣는다 —
// '교시 하나'(14:20) 보기의 물음(`studentIds`)엔 d뿐이라 **수강 축으로는 PL4가 조회에 안 들어온다**.
// y·w는 이도윤B 금(실측 2026-09-11) 모양 — y: PL1b 14:20(본원606) → 15:00 랩실 → 수학 `초등M 초4 EL2S` 16:20·17:15
// (배치엔 방이 없고 반 기본 강의실 본원205), w: PL1b만(15:00 랩실이 그날 마지막).
const TABLES: Record<string, Row[]> = {
  enrollments: [
    enrolled("d", "JP1"),
    enrolled("d", "LE1"),
    enrolled("p", "PL4"),
    enrolled("y", "PL1b"),
    enrolled("y", "EL2S"),
    enrolled("w", "PL1b"),
    enrolled("t", "BIG"),
  ],
  class_schedules: [
    labSlot("JP1", "14:20", LAB),
    labSlot("LE1", "15:40", LAB),
    labSlot("PL4", "17:00", null),
    slotRow({
      classId: "PL1b",
      dow: "fri",
      start: "14:20",
      end: "15:00",
      teacherLabel: "Kristine",
      roomLabel: "606",
      room: "본원606",
      classRoom: LAB,
    }),
    slotRow({
      classId: "PL1b",
      dow: "fri",
      start: "15:00",
      end: "15:40",
      teacherLabel: "LAB",
      roomLabel: "603",
      room: LAB,
      classRoom: LAB,
    }),
    slotRow({ classId: "EL2S", dow: "fri", start: "16:20", end: "17:15", className: "초등M 초4 EL2S", classRoom: "본원205" }),
    slotRow({ classId: "EL2S", dow: "fri", start: "17:15", end: "18:10", className: "초등M 초4 EL2S", classRoom: "본원205" }),
  ],
  classrooms: [
    { tenant_id: TENANT, name: LAB },
    { tenant_id: TENANT, name: "본원304" },
    { tenant_id: TENANT, name: "본원205" },
    { tenant_id: TENANT, name: "본원606" },
  ],
};

type Query = { table: string; filters: Filter[]; select: string; ordered: boolean; range: [number, number] | null };
const queries: Query[] = [];
const clients: ("admin" | "session")[] = [];
/** 이 표의 조회를 실패시킨다(PostgREST 오류 모양). */
let failTable: string | null = null;

/**
 * 최소 PostgREST 흉내 — `eq`·`in`만 거르고, 날짜 경계(`lte`·`or`·`not`)는 픽스처가 전부 그날 유효하게 둔다.
 * 🔑 `range`를 안 걸면 **1,000행에서 조용히 자른다**(PostgREST max-rows, [[#54]]) — 청크 헬퍼로 되돌리면 잘린다.
 */
function makeBuilder(table: string) {
  const q: Query = { table, filters: [], select: "", ordered: false, range: null };
  queries.push(q);
  const rows = () => {
    let out = (TABLES[table] ?? []).filter((r) =>
      q.filters.every((f) => (f.op === "eq" ? r[f.col] === f.val : (f.val as unknown[]).includes(r[f.col]))),
    );
    if (q.ordered) out = [...out].sort((a, b) => String(a.id).localeCompare(String(b.id)));
    return q.range ? out.slice(q.range[0], q.range[1] + 1) : out.slice(0, 1000);
  };
  const api = {
    select: (s: string) => ((q.select = s), api),
    eq: (col: string, val: unknown) => (q.filters.push({ col, op: "eq", val }), api),
    in: (col: string, val: unknown[]) => (q.filters.push({ col, op: "in", val }), api),
    not: () => api,
    lte: () => api,
    or: () => api,
    order: () => ((q.ordered = true), api),
    range: (from: number, to: number) => ((q.range = [from, to]), api),
    then: (ok: (v: { data: Row[] | null; error: { message: string } | null }) => unknown, err?: (e: unknown) => unknown) =>
      Promise.resolve(
        failTable === table ? { data: null, error: { message: "boom" } } : { data: rows(), error: null },
      ).then(ok, err),
  };
  return api;
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => (clients.push("admin"), { from: (table: string) => makeBuilder(table) }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => (clients.push("session"), { from: (table: string) => makeBuilder(table) }),
}));

const { getSeatNextDestinationsBySlot, getSeatStudentClasses } = await import("./next-destination");

/** 배치 조회(`class_schedules`)가 `.in("class_id", …)`로 받은 반 — 청크를 모두 합친다. */
const slotQueryClassIds = () =>
  queries
    .filter((q) => q.table === "class_schedules")
    .flatMap((q) => q.filters.filter((f) => f.op === "in" && f.col === "class_id").flatMap((f) => f.val as string[]))
    .sort();

const STAYS: SeatStays = { seat: "lab", startsByStudent: { d: ["14:20", "17:00"] }, classIds: ["JP1", "LE1", "PL4"] };
const FRI_STAYS: SeatStays = { seat: "lab", startsByStudent: { y: ["15:00"], w: ["15:00"] }, classIds: ["PL1b"] };

beforeEach(() => {
  queries.length = 0;
  clients.length = 0;
  failTable = null;
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("조회 입력 — 이 자리 반들을 같은 배치 조회에 얹는다", () => {
  it.each([
    ["로그인 화면", undefined],
    ["공개 PIN 화면", TENANT],
  ])("🔴 %s: 옮겨 가는 교시(17:00)의 강의실을 안다 — 그 반(PL4)을 아무도 안 들어도", async (_, tenantId) => {
    const out = await getSeatNextDestinationsBySlot(["d"], THU, ["14:20"], { tenantId, stays: STAYS });
    expect(out.bySlot).toEqual({
      "14:20": { startByStudent: { d: "17:00" }, roomByStudent: { d: LAB }, lastByStudent: {} },
    });
    // 학생 반(JP1·LE1)에 이 자리 반(PL4)을 **합쳐 한 번** 조회한다 — 새 왕복이 아니다(B4·B6).
    expect(slotQueryClassIds()).toEqual(["JP1", "LE1", "PL4"]);
    expect(queries.filter((q) => q.table === "class_schedules")).toHaveLength(1);
    // d의 반은 랩실 배치뿐 — 이 자리 밖 수업이 **없다고 확인됨**(빈 배열, 키 없음과 다르다).
    expect(out.classesByStudent).toEqual({ d: [] });
  });

  it("이 자리 재료가 없으면(JJ실·옛 호출부) 옛 동작 그대로 — 학생 반의 배치만 읽는다", async () => {
    const out = await getSeatNextDestinationsBySlot(["d"], THU, ["14:20"]);
    expect(out.bySlot).toEqual({
      "14:20": { startByStudent: { d: "15:40" }, roomByStudent: { d: LAB }, lastByStudent: {} },
    });
    expect(slotQueryClassIds()).toEqual(["JP1", "LE1"]);
    // 학생 축 재료는 교시를 옮기는 자리(`stays`)에서만 — 여기선 모름(빈 객체).
    expect(out.classesByStudent).toEqual({});
  });
});

describe("반 기본 강의실 · 마지막 수업 — 원장 2026-09-11 (이도윤B 금 모양)", () => {
  it("🔴 배치에 방이 없으면 반 기본 강의실 — 15:00 랩실 → '16:20 본원205', PL1b만 듣는 w는 마지막 수업", async () => {
    const out = await getSeatNextDestinationsBySlot(["y", "w"], FRI, ["15:00"], { stays: FRI_STAYS });
    expect(out.bySlot["15:00"]).toEqual({
      startByStudent: { y: "16:20" },
      roomByStudent: { y: "본원205" },
      lastByStudent: { w: true },
    });
    // 같은 하루치에서 학생 축 재료 — 이 자리(랩실) 배치는 빠지고, 새 왕복 없이.
    expect(out.classesByStudent.y?.map((c) => `${c.start}~${c.end} ${c.className} ${c.room}`)).toEqual([
      "14:20~15:00 PL1b 본원606",
      "16:20~17:15 초등M 초4 EL2S 본원205",
      "17:15~18:10 초등M 초4 EL2S 본원205",
    ]);
    expect(out.classesByStudent.w?.map((c) => c.start)).toEqual(["14:20"]);
    expect(queries.filter((q) => q.table === "class_schedules")).toHaveLength(1);
  });

  it("반 기본 강의실은 배치 조회에 **컬럼 기준 임베드**로 얹는다 — 새 왕복 0, 표 대 표 모호성 없음([[#94]])", async () => {
    await getSeatNextDestinationsBySlot(["y"], FRI, ["15:00"], { stays: FRI_STAYS });
    const select = queries.find((q) => q.table === "class_schedules")!.select;
    expect(select).toContain("classroom:classroom_id ( name )");
    expect(select).toContain("class:class_id ( class_name, classroom:classroom_id ( name ) )");
    expect(select).toContain("end_time");
    // 표 이름으로 거는 맨몸 임베드(`classes(…)`)는 FK가 늘면 PGRST201로 조회 전체가 죽는다.
    expect(select).not.toMatch(/(^|[\s,(])classes\s*\(/);
    expect(queries.filter((q) => q.table === "classes")).toHaveLength(0);
  });

  it("🔴 1,000행에서 잘려도 '마지막 수업'이 거짓으로 서지 않는다 — 배치 조회는 청크 × 페이징([[#54]])", async () => {
    const filler = Array.from({ length: 1000 }, (_, i) =>
      slotRow({ classId: "BIG", dow: "thu", start: "09:00", id: `f${String(i).padStart(4, "0")}` }),
    );
    const late = slotRow({ classId: "BIG", dow: "thu", start: "19:00", end: "19:40", classRoom: "본원304", id: "z-late" });
    const before = TABLES.class_schedules!.length;
    TABLES.class_schedules!.push(...filler, late);
    try {
      const out = await getSeatNextDestinationsBySlot(["t"], THU, ["18:00"]);
      expect(out.bySlot["18:00"]).toEqual({
        startByStudent: { t: "19:00" },
        roomByStudent: { t: "본원304" },
        lastByStudent: {},
      });
    } finally {
      TABLES.class_schedules!.splice(before);
    }
  });
});

describe("🔴 조회 실패 — 모름(아무것도 안 적는다), 화면은 산다", () => {
  it("다음 행선지·마지막 수업·학생 축 모두 비워 돌려주고 로그를 남긴다", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    failTable = "class_schedules";
    const out = await getSeatNextDestinationsBySlot(["y", "w"], FRI, ["15:00"], { stays: FRI_STAYS });
    expect(out).toEqual({
      bySlot: { "15:00": { startByStudent: {}, roomByStudent: {}, lastByStudent: {} } },
      classesByStudent: {},
    });
    expect(spy).toHaveBeenCalled();
  });

  it("🔴 서버 쓰기 경로용 `getSeatStudentClasses`는 실패를 `ok:false`(거절 문장)로 돌려준다 — 모름으로 삼키지 않는다", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    failTable = "enrollments";
    await expect(getSeatStudentClasses(["y"], FRI, "lab")).resolves.toEqual({
      ok: false,
      error: "이 학생의 다른 수업을 확인하지 못했습니다 — 다시 시도해 주세요",
    });
    expect(spy).toHaveBeenCalled();
  });
});

describe("서버 쓰기 경로 — 한 학생을 같은 조회·같은 규칙으로 다시 잰다", () => {
  it("화면의 `classesByStudent`와 같은 답이다(학생 반만 읽는다 — 이 자리 반을 얹지 않는다)", async () => {
    const screen = await getSeatNextDestinationsBySlot(["y"], FRI, ["15:00"], { stays: FRI_STAYS });
    queries.length = 0;
    const server = await getSeatStudentClasses(["y"], FRI, "lab");
    expect(server).toEqual({ ok: true, byStudent: { y: screen.classesByStudent.y } });
    expect(slotQueryClassIds()).toEqual(["EL2S", "PL1b"]);
  });
});

describe("🔴 공개 PIN 경로 — 세션이 없어 admin으로 읽으니 테넌트 필터가 유일한 격리선", () => {
  it("세 조회(수강·배치·강의실) 모두 이 테넌트로 거르고, 세션 클라이언트를 만들지 않는다", async () => {
    await getSeatNextDestinationsBySlot(["d"], THU, ["14:20"], { tenantId: TENANT, stays: STAYS });
    expect(clients).toEqual(["admin"]);
    expect(new Set(queries.map((q) => q.table))).toEqual(new Set(["enrollments", "class_schedules", "classrooms"]));
    for (const q of queries) expect(q.filters).toContainEqual({ col: "tenant_id", op: "eq", val: TENANT });
  });

  it("쓰기 경로용 조회도 테넌트를 넘기면 같은 격리선을 탄다", async () => {
    await getSeatStudentClasses(["y"], FRI, "lab", { tenantId: TENANT });
    expect(clients).toEqual(["admin"]);
    for (const q of queries) expect(q.filters).toContainEqual({ col: "tenant_id", op: "eq", val: TENANT });
  });
});
