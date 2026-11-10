import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../defaults";
import { resolveSettings } from "../resolve";
import type { OperationsSettings } from "../settings-types";

/**
 * 과목 삭제(흡수·미사용 삭제)가 **도는 동안** 다른 창이 과목 운영을 저장해도 그 저장이 남는지 — 실제 서버 액션으로 확인한다
 * (2026-10-05 검토 2 N1 · 적대 리뷰 C3). 삭제 액션은 데이터를 옮기는 데 시간이 걸리고, 마지막에 설정에서 과목 행을 뺀다.
 *  · 설정 행 제거는 "방금 읽은 값에서 그 행만 빼기"다 — 삭제를 시작할 때 읽어 둔 목록을 되돌려 쓰지 않는다.
 *  · 응답은 삭제로 확정된 과목 운영 면의 값과 그 값의 token을 한 쌍으로 돌려준다 — 화면은 그 둘을 함께 받는다.
 * 설정 표만 상태를 가진 모의로 두고, 나머지 표는 빈 결과를 돌려주는 흉내로 둔다. 합성 값만 쓴다.
 */
const m = vi.hoisted(() => ({
  actor: { id: "actor", tenantId: "tenant-a", systemRole: "master", displayName: "원장" },
  row: null as null | { data: Record<string, unknown>; updated_at: string },
  /** 흡수가 데이터를 옮기는 중(= 설정 행을 빼기 전)에 끼어드는 다른 창의 저장. */
  duringAbsorb: null as null | (() => Promise<unknown>),
  /** 미사용 삭제가 사용량을 다시 세는 중에 끼어드는 다른 창의 저장. */
  duringRecount: null as null | (() => Promise<unknown>),
  /** 그 표의 **쓰기(update)** 만 이 오류로 끝난다 — 읽기는 그대로 빈 결과. */
  writeFault: null as null | { table: string; error: unknown },
  /** 배열·jsonb 를 옮기는 RPC 가 이 오류로 끝난다. */
  rpcFault: null as null | unknown,
  /** 쓰기를 시도한 표(차례대로). */
  writes: [] as string[],
  /** 그 과목 키를 담은 신규생 관리 기록 수(null = 못 셈). */
  newcomerRecords: 0 as number | null,
  /** 흡수 첫 확인 **뒤에** 들어온 신규생 관리 기록 수 — 과목 행을 지우는 마지막 저장만 본다(null = 못 셈). */
  lateNewcomerRecords: 0 as number | null,
  audit: vi.fn(),
}));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => m.actor }));
vi.mock("@/lib/auth/perm-matrix", () => ({ canWriteTenant: async () => true }));
vi.mock("@/lib/auth/super-admin", () => ({ isCurrentUserSuperAdmin: async () => false }));
vi.mock("@/features/audit/server/log", () => ({ logAction: m.audit }));
vi.mock("./queries", () => ({ tenantSettingsTag: (id: string) => `settings:${id}` }));
vi.mock("next/cache", () => ({ updateTag: vi.fn(), revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: () => ({ select: () => ({ in: async () => ({ data: [], error: null }) }) }) }),
}));
vi.mock("./dashboard-assignments", () => ({ validateDashboardAssignments: vi.fn() }));
vi.mock("@/lib/storage/media-storage", () => ({ createUploadTicket: vi.fn(), MEDIA_KIND: {} }));
// 신규생 관리 기록(서버 전용 표 · s2_0060·s2_0061) — 기본 0건. 있으면 흡수를 막는다(맨 아래 시험).
vi.mock("@/features/newcomers/server/subject-refs", () => ({
  countNewcomerSubjectRecords: async () => m.newcomerRecords,
  // 과목 행을 지우는 마지막 저장의 확인 — 그사이 들어온 기록(`lateNewcomerRecords`)이 있으면 그 과목을 돌려준다.
  subjectsWithNewcomerRecords: async (_tenant: string, keys: string[]) => (m.lateNewcomerRecords === null ? null : m.lateNewcomerRecords > 0 ? keys : []),
}));
vi.mock("@/features/periods/server/queries", () => ({
  countPeriodsForSubject: async () => {
    const interleave = m.duringRecount;
    m.duringRecount = null;
    await interleave?.();
    return 0;
  },
  moveSubjectPeriods: async () => ({ moved: 0 }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    /** 설정 표가 아닌 표 — 어떤 체인이든 받아 주고 기다리면 빈 결과를 준다(이 테스트의 관심사가 아니다). */
    const emptyTable = (): unknown => {
      const chain: Record<string, unknown> = {
        then: (resolve: (value: unknown) => void) => resolve({ data: [], error: null, count: 0 }),
      };
      return new Proxy(chain, { get: (target, prop) => (prop in target ? target[prop as string] : () => emptyTable()) });
    };
    /** 쓰기를 기록하는 표 — update 를 부르면 그 표 이름을 적고, 오류가 걸려 있으면 그 오류로 끝난다. */
    const dataTable = (table: string): unknown => {
      const failed = (error: unknown): unknown => {
        const chain: Record<string, unknown> = {
          then: (resolve: (value: unknown) => void) => resolve({ data: null, error, count: null }),
        };
        return new Proxy(chain, { get: (target, prop) => (prop in target ? target[prop as string] : () => failed(error)) });
      };
      const base = emptyTable() as Record<string, unknown>;
      return new Proxy(base, {
        get: (target, prop) => {
          if (prop !== "update") return target[prop as string];
          return () => {
            m.writes.push(table);
            return m.writeFault?.table === table ? failed(m.writeFault.error) : emptyTable();
          };
        },
      });
    };
    return {
      rpc: async () => {
        m.writes.push("rpc");
        if (m.rpcFault) return { data: null, error: m.rpcFault };
        const interleave = m.duringAbsorb;
        m.duringAbsorb = null;
        await interleave?.();
        return { data: {}, error: null };
      },
      from: (table: string) => {
        if (table !== "tenant_settings") return dataTable(table);
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: m.row ? structuredClone(m.row) : null, error: null }) }) }),
          update: (value: { data: Record<string, unknown>; updated_at: string }) => {
            const conditions: Record<string, unknown> = {};
            const writer = {
              eq: (column: string, expected: unknown) => {
                conditions[column] = expected;
                return writer;
              },
              select: async () => {
                if (!m.row || conditions.updated_at !== m.row.updated_at) return { data: [], error: null };
                m.row = { data: structuredClone(value.data), updated_at: value.updated_at };
                return { data: [{ tenant_id: "tenant-a" }], error: null };
              },
            };
            return writer;
          },
        };
      },
    };
  },
}));
import { saveOwnerSection } from "./actions";
import { operationsFaceToken } from "./operations-save";
import { absorbSubject, removeUnusedSubject, saveIntegrationGroups, saveTeacherViewOrder } from "./subject-actions";

const stored = (): OperationsSettings => resolveSettings(m.row?.data ?? null, { name: "" }).operations;
const labels = () => Object.fromEntries(stored().subjects.map((s) => [s.key, s.label]));
/** 저장마다 시계를 민다 — 저장 시각이 곧 수정 표식이다. */
const tick = () => vi.setSystemTime(new Date(Date.now() + 1000));

/** 과목 운영 창 — 연 시점의 값과 token을 들고 있다. */
function openSubjectsWindow() {
  const draft = stored();
  const baseline = operationsFaceToken(draft, "subjects");
  return {
    draft,
    save: (data: OperationsSettings, token = baseline) => {
      tick();
      const fd = new FormData();
      fd.set("section", "operations");
      fd.set("operationsFace", "subjects");
      fd.set("operationsBaseline", token);
      fd.set("data", JSON.stringify(data));
      return saveOwnerSection(undefined, fd);
    },
  };
}
/** 다른 창 B가 한꺼번에 하는 일: 영어 이름을 바꾸고 · 논술을 더하고 · 수학(심화)을 지운다. */
function otherWindowEdits(b: ReturnType<typeof openSubjectsWindow>) {
  return async () => {
    const next: OperationsSettings = {
      ...b.draft,
      subjects: [
        ...b.draft.subjects.filter((s) => s.key !== "subject_1").map((s) => (s.key === "english" ? { ...s, label: "영어B" } : s)),
        { key: "subject_9", label: "논술", color: "neutral", weekdayGrouping: "mon-thu", testMax: 5 },
      ],
    };
    const result = await b.save(next);
    expect(result?.ok).toBe(true);
  };
}
const expectOtherWindowEditsKept = () => {
  expect(labels().english).toBe("영어B");
  expect(labels().subject_9).toBe("논술");
  expect("subject_1" in labels()).toBe(false);
};

beforeEach(() => {
  m.newcomerRecords = 0;
  m.lateNewcomerRecords = 0;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-05T01:00:00.000Z"));
  vi.clearAllMocks();
  m.actor.displayName = "원장";
  m.duringAbsorb = null;
  m.duringRecount = null;
  m.writeFault = null;
  m.rpcFault = null;
  m.writes = [];
  m.row = { data: { operations: structuredClone(DEFAULT_SETTINGS.operations) }, updated_at: "2026-10-05T00:00:00Z" };
});
afterEach(() => {
  vi.useRealTimers();
});

describe("흡수 삭제가 도는 동안 다른 창이 저장하면", () => {
  it("🔴 그 저장이 남고, 응답은 그 변경이 반영된 과목 목록과 token을 함께 돌려준다", async () => {
    const a = openSubjectsWindow(); // 깨끗한 창 — 과학을 수학에 흡수시킨다
    m.duringAbsorb = otherWindowEdits(openSubjectsWindow());

    tick();
    const result = await absorbSubject({ from: "science", to: "math" });
    expect(result.ok).toBe(true);
    expect("science" in labels()).toBe(false);
    expectOtherWindowEditsKept();

    expect(result.subjectsFace!.snapshot.subjects).toEqual(stored().subjects);
    expect(result.subjectsFace!.token).toBe(operationsFaceToken(stored(), "subjects"));
    // 값·token과 함께 그 상태를 쓴 저장의 순번도 온다(화면이 이보다 먼저 읽힌 값을 받지 않는다).
    expect(result.subjectsFace!.version).toBe((m.row!.data.operations as { rev: number }).rev);
    expect(result.subjectsFace!.version).toBeGreaterThan(0);

    // A는 응답의 값과 token을 함께 받아 이어서 저장한다 — B의 변경이 그대로 남는다.
    const adopted = { ...a.draft, ...result.subjectsFace!.snapshot };
    const saved = await a.save({ ...adopted, subjects: adopted.subjects.map((s) => (s.key === "math" ? { ...s, label: "수학B" } : s)) }, result.subjectsFace!.token);
    expect(saved?.ok).toBe(true);
    expect(labels().math).toBe("수학B");
    expectOtherWindowEditsKept();
    expect("science" in labels()).toBe(false);
  });

  it("A가 삭제를 시작할 때 들고 있던 token은 더는 통하지 않는다(옛 목록으로 덮을 수 없다)", async () => {
    const a = openSubjectsWindow();
    m.duringAbsorb = otherWindowEdits(openSubjectsWindow());
    tick();
    await absorbSubject({ from: "science", to: "math" });

    const result = await a.save({ ...a.draft, subjects: a.draft.subjects.filter((s) => s.key !== "science") });
    expect(result?.ok).toBeUndefined();
    expect(result?.error).toContain("다른 창에서");
    expectOtherWindowEditsKept();
  });
});

describe("미사용 삭제가 사용량을 다시 세는 동안 다른 창이 저장하면", () => {
  it("🔴 그 저장이 남고, 응답은 확정된 목록과 token을 함께 돌려준다", async () => {
    m.duringRecount = otherWindowEdits(openSubjectsWindow());
    tick();
    const result = await removeUnusedSubject("science");
    expect(result.ok).toBe(true);
    expect("science" in labels()).toBe(false);
    expectOtherWindowEditsKept();
    expect(result.subjectsFace!.snapshot.subjects.map((s) => s.key)).toEqual(stored().subjects.map((s) => s.key));
    expect(result.subjectsFace!.token).toBe(operationsFaceToken(stored(), "subjects"));
  });

  it("그사이 다른 창이 같은 과목을 이미 지웠어도 성공으로 끝나고 지금 상태를 돌려준다", async () => {
    m.duringRecount = async () => {
      const b = openSubjectsWindow();
      await b.save({ ...b.draft, subjects: b.draft.subjects.filter((s) => s.key !== "science") });
    };
    tick();
    const result = await removeUnusedSubject("science");
    expect(result.ok).toBe(true);
    expect(result.subjectsFace!.snapshot.subjects.some((s) => s.key === "science")).toBe(false);
    expect(result.subjectsFace!.token).toBe(operationsFaceToken(stored(), "subjects"));
  });
});

describe("시간표 쪽 서버 액션 — 제 칸만 보내고, 다듬기·도장은 저장이 정한다", () => {
  const english = () => stored().subjects.find((s) => s.key === "english")!;
  const groups = [{ id: "g1", title: "1교시", classIds: ["c1"] }];

  it("강사 순서: 공백·중복을 걷어 저장하고, 다 비우면 그 칸을 지운다 — 다른 과목·다른 칸은 그대로", async () => {
    const before = stored();
    tick();
    expect(await saveTeacherViewOrder({ subject: "english", order: [" Jane ", "Jane", "Tom"] })).toEqual({ ok: true });
    expect(english().teacherViewOrder).toEqual(["Jane", "Tom"]);
    expect(stored().holidays).toEqual(before.holidays);
    expect(stored().subjects.find((s) => s.key === "math")).toEqual(before.subjects.find((s) => s.key === "math"));

    tick();
    expect(await saveTeacherViewOrder({ subject: "english", order: [" ", ""] })).toEqual({ ok: true });
    const raw = (m.row!.data.operations as { subjects: Record<string, unknown>[] }).subjects.find((s) => s.key === "english")!;
    expect("teacherViewOrder" in raw).toBe(false);
  });

  it("없는 과목은 거절한다(과목을 만들지 않는다)", async () => {
    tick();
    expect((await saveTeacherViewOrder({ subject: "nope", order: ["A"] })).error).toBe("학원 설정에 없는 과목입니다");
    expect(stored().subjects.some((s) => s.key === "nope")).toBe(false);
  });

  it("🔴 보관함: 화면이 보낸 '누가·언제'는 버리고 서버가 찍은 도장을 돌려준다", async () => {
    tick();
    const result = await saveIntegrationGroups({
      subject: "english",
      enabled: true,
      groups,
      showOthers: true,
      othersTitle: "  ",
      presets: [{ id: "p1", name: " 학기 배치 ", groups, savedBy: "다른 직원", savedAt: "2020-01-01T00:00:00Z" }],
    });
    expect(result.ok).toBe(true);
    const stampedAt = new Date(Date.now()).toISOString();
    expect(result.presets).toEqual([{ id: "p1", name: "학기 배치", groups, savedBy: "원장", savedAt: stampedAt }]);
    expect(english().integrationGroupPresets).toEqual(result.presets);
    expect(english().integrationGroups).toEqual(groups);
    expect("integrationOthersTitle" in english()).toBe(false);
  });

  it("보관함을 안 넘기면 저장돼 있던 보관함을 그대로 둔다 · 내용이 같은 항목은 처음 도장을 유지한다", async () => {
    tick();
    const first = await saveIntegrationGroups({ subject: "english", enabled: true, groups, showOthers: true, othersTitle: "", presets: [{ id: "p1", name: "학기 배치", groups }] });
    const firstStamp = first.presets![0]!.savedAt;

    tick();
    const withoutPresets = await saveIntegrationGroups({ subject: "english", enabled: false, groups: [], showOthers: false, othersTitle: "기타반" });
    expect(withoutPresets).toEqual({ ok: true, presets: undefined });
    expect(english().integrationGroupPresets).toHaveLength(1);
    expect(english().integrationGroupsEnabled).toBe(false);
    expect(english().integrationOthersTitle).toBe("기타반");

    tick();
    m.actor.displayName = "실장";
    const again = await saveIntegrationGroups({
      subject: "english",
      enabled: true,
      groups,
      showOthers: true,
      othersTitle: "",
      presets: [
        { id: "p1", name: "학기 배치", groups },
        { id: "p2", name: "방학 배치", groups: [] },
      ],
    });
    expect(again.presets![0]).toMatchObject({ id: "p1", savedBy: "원장", savedAt: firstStamp });
    expect(again.presets![1]).toMatchObject({ id: "p2", savedBy: "실장" });
  });

  it("🔴 시간표 저장이 도는 사이 과목 운영 창이 저장해도 둘 다 남는다(서로의 칸을 되돌리지 않는다)", async () => {
    const window = openSubjectsWindow();
    tick();
    await saveIntegrationGroups({ subject: "english", enabled: true, groups, showOthers: true, othersTitle: "" });
    const saved = await window.save({ ...window.draft, subjects: window.draft.subjects.map((s) => (s.key === "math" ? { ...s, label: "수학B" } : s)) });
    expect(saved?.ok).toBe(true);
    expect(labels().math).toBe("수학B");
    expect(english().integrationGroups).toEqual(groups);
  });
});

describe("흡수가 쓰다가 실패하면 — 무엇이 옮겨졌는지 사실대로 말한다(적대 리뷰 5b B3)", () => {
  /** 권한 거절 — DB가 거절했다고 알려 준 실패(오류 코드가 있다). */
  const REJECTED = { code: "42501", message: 'permission denied for table "classes"' };
  /** 응답을 못 받은 실패 — 오류 코드가 없다(쓰기가 됐는지 모른다). */
  const NO_ANSWER = { message: "TypeError: fetch failed" };
  const NONE_MOVED = "옮겨진 기록은 없습니다";
  const MAYBE_MOVED = "일부 기록은 이미 옮겨졌을 수 있습니다";
  const run = async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    tick();
    const result = await absorbSubject({ from: "science", to: "math" });
    spy.mockRestore();
    if (!("error" in result) || !result.error) throw new Error("실패해야 하는 사례가 성공했다");
    return result.error;
  };
  /** 실패한 흡수는 설정의 과목 행을 지우지 않는다 — 다시 시도할 수 있어야 한다. */
  const expectSubjectKept = () => expect("science" in labels()).toBe(true);

  it("🔴 첫 쓰기를 DB가 거절했다 → 옮겨진 기록이 없다고 말한다(있지도 않은 부분 이동을 알리지 않는다)", async () => {
    m.writeFault = { table: "classes", error: REJECTED };
    const message = await run();
    expect(m.writes).toEqual(["classes"]);
    expect(message).toContain(NONE_MOVED);
    expect(message).not.toContain(MAYBE_MOVED);
    expect(message).not.toMatch(/classes|permission denied/);
    expectSubjectKept();
  });

  it("🔴 앞 표의 쓰기가 끝난 뒤 거절됐다 → 일부가 옮겨졌을 수 있다고 알린다", async () => {
    m.writeFault = { table: "student_grades", error: REJECTED };
    const message = await run();
    expect(m.writes).toEqual(["classes", "enrollment_consultations", "student_consultations", "student_grades"]);
    expect(message).toContain(MAYBE_MOVED);
    expect(message).not.toContain(NONE_MOVED);
    expect(message).not.toMatch(/student_grades|permission denied/);
    expectSubjectKept();
  });

  it("🔴 첫 쓰기라도 응답을 못 받았다 → 옮겨진 것이 없다고 단정하지 않는다", async () => {
    m.writeFault = { table: "classes", error: NO_ANSWER };
    const message = await run();
    expect(m.writes).toEqual(["classes"]);
    expect(message).toContain(MAYBE_MOVED);
    expect(message).not.toContain(NONE_MOVED);
    expect(message).not.toMatch(/fetch failed|TypeError/);
    expectSubjectKept();
  });

  it("표를 다 옮긴 뒤 배열·기록 이동이 거절됐다 → 일부가 옮겨졌을 수 있다고 알린다", async () => {
    m.rpcFault = { code: "42501", message: "permission denied for function absorb_subject_key" };
    const message = await run();
    expect(m.writes.at(-1)).toBe("rpc");
    expect(m.writes).toHaveLength(10);
    expect(message).toContain(MAYBE_MOVED);
    expect(message).not.toMatch(/absorb_subject_key|permission denied/);
    expectSubjectKept();
  });

  it("그 사이 같은 이름의 반이 생겼다(유니크 충돌) → 전용 안내 그대로", async () => {
    m.writeFault = { table: "classes", error: { code: "23505", message: 'duplicate key value violates unique constraint "classes_name_key"' } };
    expect(await run()).toBe("그 사이 같은 이름의 반이 생겨 흡수할 수 없습니다 — 반 이름을 바꾼 뒤 다시 시도해 주세요.");
    expectSubjectKept();
  });
});

describe("신규생 관리 기록이 있는 과목은 흡수하지 않는다(옛 키에 담당 배정·피드백만 남지 않게)", () => {
  it("기록이 있으면 거절하고 아무 표도 쓰지 않는다", async () => {
    m.newcomerRecords = 3;
    const result = await absorbSubject({ from: "science", to: "math" });
    expect("error" in result ? result.error : "").toContain("신규생 관리 기록");
    expect(m.writes).toEqual([]);
  });
  it("기록 수를 못 세면 0건으로 보지 않고 멈춘다", async () => {
    m.newcomerRecords = null;
    const result = await absorbSubject({ from: "science", to: "math" });
    expect("error" in result && result.error).toBeTruthy();
    expect(m.writes).toEqual([]);
  });
  it("🔴 첫 확인 뒤에 기록이 들어왔으면 과목 행을 지우는 마지막 저장이 거절한다(과목은 남는다)", async () => {
    m.lateNewcomerRecords = 1;
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await absorbSubject({ from: "science", to: "math" });
    spy.mockRestore();
    expect("error" in result && result.error).toBeTruthy();
    expect("science" in labels()).toBe(true);
  });
  it("마지막 저장이 기록 수를 못 세면 과목을 지우지 않는다", async () => {
    m.lateNewcomerRecords = null;
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await absorbSubject({ from: "science", to: "math" });
    spy.mockRestore();
    expect("error" in result && result.error).toBeTruthy();
    expect("science" in labels()).toBe(true);
  });
});
