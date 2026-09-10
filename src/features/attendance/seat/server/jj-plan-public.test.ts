import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SeatDay } from "./queries";

/**
 * 비로그인 공개 자리 화면(`/seat/jj`)의 **진도 게이트** — 이 화면엔 로그인이 없으므로 문이 좁아야 한다.
 *
 * 잠그는 것 넷(브리프 2026-08-25):
 *  🔴 ① PIN 쿠키 없이 쓰기 → 거절(그 자리 쿠키가 아니어도 거절 — 랩실 비밀번호로 JJ를 못 연다)
 *  🔴 ② **명단 밖 반 id**로 강제 호출 → 거절(화면에 안 그렸다고 액션이 열려 있으면 안 된다, #77)
 *  🔴 ③ **어제 날짜**로 강제 호출 → 거절(공개 화면은 오늘만)
 *  🔴 ④ 랩실(`/seat/lab`)엔 진도 재료가 아예 안 간다
 * 그리고 통과했을 때 `updated_by`가 될 **actorId는 null**이어야 한다(계정 없는 사람을 이름 붙이지 않는다).
 */

const TENANT = "11111111-1111-4111-8111-111111111111";
const TODAY = "2026-08-25";
const YESTERDAY = "2026-08-24";
const SLOT = "16:20";
const IN_ROSTER = "c1111111-1111-4111-8111-111111111111";
const OUT_OF_ROSTER = "c9999999-9999-4999-8999-999999999999";
const NON_ENGLISH = "c2222222-2222-4222-8222-222222222222";

let pinSession: { tenantId: string; seat: "lab" | "jj"; exp: number } | null = null;

vi.mock("./pin-session", () => ({
  readSeatPinSession: async () => pinSession,
  resolvePinSigningSecret: () => "secret",
}));

vi.mock("@/lib/date-kst", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/date-kst")>()),
  kstToday: () => TODAY,
}));

const seatDay: SeatDay = {
  date: TODAY,
  periods: [
    {
      start: SLOT,
      ends: ["17:00"],
      slots: [
        { classId: IN_ROSTER, className: "중등E_초5 의치대", start: SLOT, end: "17:00" },
        { classId: NON_ENGLISH, className: "수학 보충", start: SLOT, end: "17:00" },
      ],
    },
  ],
  rosterByPeriod: {
    [SLOT]: [
      {
        classId: IN_ROSTER,
        className: "중등E_초5 의치대",
        end: "17:00",
        bgColor: null,
        textColor: null,
        students: [
          {
            id: "s1",
            name: "이다윤A",
            school: "칠성초",
            grade: "4",
            status: null,
            recordedBy: null,
            fromSeat: false,
      note: null,
    prevAbsence: null,
            attitude: null,
            listeningLevel: null,
            memorizedWords: null,
            progressNote: null,
          },
        ],
      },
      { classId: NON_ENGLISH, className: "수학 보충", end: "17:00", bgColor: null, textColor: null, students: [] },
    ],
  },
  // 교시 선택(0255a)의 재료 — 이 반들은 그 날 자리 교시가 하나뿐이라 고를 것이 없다.
  slotsByClass: { [IN_ROSTER]: [SLOT], [NON_ENGLISH]: [SLOT] },
  markedSlotsByCell: {},
};

vi.mock("./queries", () => ({
  getPublicSeatDay: async () => seatDay,
  getSeatDay: async () => seatDay,
}));

vi.mock("@/features/owner/server/queries", () => ({
  getTenantSettingsByTenantId: async () => ({
    // skillAreas 미설정 english = 기본 6영역 프리필(resolveSkillAreas 단일 소스).
    operations: { subjects: [{ key: "english", label: "영어" }, { key: "math", label: "수학" }] },
  }),
}));

/** 최소 PostgREST 흉내 — 체이닝 + thenable. `fetchInChunks`가 그대로 쓴다. */
type Row = Record<string, unknown>;
const TABLES: Record<string, Row[]> = {
  classes: [
    { id: IN_ROSTER, tenant_id: TENANT, subject: "english", english_track: "injaewon" },
    { id: NON_ENGLISH, tenant_id: TENANT, subject: "math", english_track: null },
    { id: OUT_OF_ROSTER, tenant_id: TENANT, subject: "english", english_track: "eie" },
  ],
  class_sheet_plan_lines: [
    {
      id: "11111111-1111-4111-8111-aaaaaaaaaaaa",
      tenant_id: TENANT,
      class_id: IN_ROSTER,
      plan_date: TODAY,
      slot_start: "16:20:00",
      term_mode: "regular",
      skill_area: "vocab",
      line_no: 1,
      textbook: "Word Master",
      page_range: null,
      progress: "Unit 3",
      homework: null,
      updated_at: "2026-08-25T00:00:00Z",
    },
    // 다른 교시 줄 — 교시 필터가 살아 있는지 확인용(같은 반·같은 날).
    {
      id: "11111111-1111-4111-8111-bbbbbbbbbbbb",
      tenant_id: TENANT,
      class_id: IN_ROSTER,
      plan_date: TODAY,
      slot_start: "17:20:00",
      term_mode: "regular",
      skill_area: "reading",
      line_no: 1,
      textbook: "다른 교시",
      page_range: null,
      progress: null,
      homework: null,
      updated_at: "2026-08-25T00:00:00Z",
    },
  ],
};

function makeBuilder(table: string) {
  const filters: { col: string; op: "eq" | "in"; val: unknown }[] = [];
  const rows = () =>
    (TABLES[table] ?? []).filter((r) =>
      filters.every((f) =>
        f.op === "eq" ? r[f.col] === f.val : (f.val as unknown[]).includes(r[f.col]),
      ),
    );
  const api = {
    select: () => api,
    eq: (col: string, val: unknown) => (filters.push({ col, op: "eq", val }), api),
    in: (col: string, val: unknown[]) => (filters.push({ col, op: "in", val }), api),
    order: () => api,
    then: (ok: (v: { data: Row[]; error: null }) => unknown, err?: (e: unknown) => unknown) =>
      Promise.resolve({ data: rows(), error: null }).then(ok, err),
  };
  return api;
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: (table: string) => makeBuilder(table) }),
}));

const { gateSeatPlanWrite, loadPublicSeatJjPlans } = await import("./jj-plan-public");

beforeEach(() => {
  pinSession = { tenantId: TENANT, seat: "jj", exp: Date.now() + 60_000 };
});

const write = (over: Partial<Parameters<typeof gateSeatPlanWrite>[0]> = {}) =>
  gateSeatPlanWrite({ seat: "jj", date: TODAY, slotStart: SLOT, classId: IN_ROSTER, ...over });

describe("공개 자리 진도 쓰기 게이트", () => {
  it("PIN 쿠키가 있고 오늘·명단 안 반이면 통과 — 작성자는 null, 범위는 오늘 그 교시", async () => {
    const gate = await write();
    expect(gate).toEqual({
      ok: true,
      grant: { tenantId: TENANT, classId: IN_ROSTER, actorId: null },
      // 🔴 범위를 함께 돌려줘야 쓰기가 "오늘 그 교시" 밖으로 못 나간다(줄 id는 반에만 묶여 있다).
      scope: { planDate: TODAY, slotStart: SLOT },
    });
  });

  it("범위의 교시는 게이트가 정규화한 값이다(호출부 표기가 달라도 갈리지 않는다)", async () => {
    const gate = await write({ slotStart: "16:20:00" });
    expect(gate).toMatchObject({ ok: true, scope: { planDate: TODAY, slotStart: SLOT } });
  });

  it("🔴 PIN 쿠키가 없으면 거절한다", async () => {
    pinSession = null;
    expect(await write()).toEqual({ ok: false, error: "비밀번호를 다시 입력해 주세요" });
  });

  it("🔴 다른 자리 PIN으로는 못 연다(랩실 비밀번호로 JJ 열기 금지)", async () => {
    pinSession = { tenantId: TENANT, seat: "lab", exp: Date.now() + 60_000 };
    expect(await write()).toEqual({ ok: false, error: "비밀번호를 다시 입력해 주세요" });
  });

  it("🔴 명단 밖 반 id로 강제 호출하면 거절한다", async () => {
    expect(await write({ classId: OUT_OF_ROSTER })).toEqual({
      ok: false,
      error: "이 교시에 없는 반입니다",
    });
  });

  it("🔴 어제 날짜로 강제 호출하면 거절한다", async () => {
    expect(await write({ date: YESTERDAY })).toEqual({
      ok: false,
      error: "오늘 날짜만 입력할 수 있습니다",
    });
  });

  it("🔴 그 시각에 자리 수업이 없으면 거절한다", async () => {
    expect(await write({ slotStart: "09:00" })).toEqual({
      ok: false,
      error: "그 시각에는 이 자리 수업이 없습니다",
    });
  });

  it("🔴 랩실에는 진도 칸 자체가 없다", async () => {
    pinSession = { tenantId: TENANT, seat: "lab", exp: Date.now() + 60_000 };
    expect(await write({ seat: "lab" })).toEqual({
      ok: false,
      error: "이 자리에는 수업계획 칸이 없습니다",
    });
  });

  it("명단 안이어도 영어 시트 대상이 아닌 반은 거절한다", async () => {
    expect(await write({ classId: NON_ENGLISH })).toEqual({
      ok: false,
      error: "이 반은 수업계획 대상이 아닙니다",
    });
  });
});

describe("공개 자리 진도 조회", () => {
  it("명단 안 영어 반만 키가 생기고 그 교시 줄만 온다", async () => {
    const plans = await loadPublicSeatJjPlans("jj", TENANT, TODAY, SLOT);
    expect(Object.keys(plans)).toEqual([IN_ROSTER]);
    const plan = plans[IN_ROSTER]!;
    expect(plan.canEdit).toBe(true);
    // EiE가 아니라 '내신' 구획이 붙는다(판정은 english_track 컬럼).
    expect(plan.showExamTerm).toBe(true);
    expect(plan.skillAreas.length).toBeGreaterThan(0);
    expect(plan.lines.map((l) => l.progress)).toEqual(["Unit 3"]);
  });

  it("🔴 PIN 쿠키가 없으면 재료를 아예 안 만든다", async () => {
    pinSession = null;
    expect(await loadPublicSeatJjPlans("jj", TENANT, TODAY, SLOT)).toEqual({});
  });

  it("🔴 어제 날짜로는 재료를 안 만든다", async () => {
    expect(await loadPublicSeatJjPlans("jj", TENANT, YESTERDAY, SLOT)).toEqual({});
  });

  it("🔴 랩실에는 재료를 안 만든다", async () => {
    pinSession = { tenantId: TENANT, seat: "lab", exp: Date.now() + 60_000 };
    expect(await loadPublicSeatJjPlans("lab", TENANT, TODAY, SLOT)).toEqual({});
  });

  it("🔴 쿠키의 학원과 다른 테넌트로는 못 읽는다", async () => {
    expect(await loadPublicSeatJjPlans("jj", "22222222-2222-4222-8222-222222222222", TODAY, SLOT)).toEqual(
      {},
    );
  });
});
