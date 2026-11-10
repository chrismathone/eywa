import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../defaults";
import { GENERIC_SETTINGS } from "../generic-defaults";
import { resolveSettings } from "../resolve";
import type { OperationsFace } from "../operations-slice";
import type { OperationsSettings, SubjectSetting } from "../settings-types";

/**
 * 운영 섹션 저장 계약(2026-10-05) — 실제 저장 액션을 **상태를 가진 모의 DB**로 돌려, 여러 곳이 번갈아 쓰는 경우를 확인한다.
 *  · 어느 요청도 운영 섹션을 통째로 갈아끼우지 않는다: 방금 읽은 값 위에 제 몫만 얹는다.
 *  · 두 면은 "그 면을 연 뒤 같은 면이 바뀌었으면" 거절한다(기준 token). 다른 면·시간표의 변경은 충돌이 아니다.
 *  · 저장 직전에 문서가 바뀌었으면(cron·시트 반영 등) 최종 쓰기가 거절된다(`updated_at`).
 * 합성 값만 쓴다.
 */
const m = vi.hoisted(() => ({
  actor: { id: "actor", tenantId: "tenant-a", systemRole: "master", displayName: "원장" },
  allowed: true,
  row: null as null | { data: Record<string, unknown>; updated_at: string },
  /** 액션이 읽은 뒤·쓰기 직전에 끼어드는 다른 writer. */
  beforeWrite: null as null | (() => void),
  /**
   * DB의 쓰기 가드(0335a `guard_tenant_settings_write`)를 흉내 낸다 — 개별 설정만 위임받은 사람이 맡은 섹션 이름들.
   * null이면 원장(가드 통과). 값이 있으면 그 섹션 밖(문서의 나머지)이 달라진 쓰기를 거절한다.
   */
  delegatedSections: null as null | string[],
  writes: 0,
  audit: vi.fn(),
}));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => m.actor }));
vi.mock("@/lib/auth/perm-matrix", () => ({ canWriteTenant: async () => m.allowed }));
vi.mock("@/lib/auth/super-admin", () => ({ isCurrentUserSuperAdmin: async () => false }));
vi.mock("@/features/audit/server/log", () => ({ logAction: m.audit }));
vi.mock("./queries", () => ({ tenantSettingsTag: (id: string) => `settings:${id}` }));
vi.mock("next/cache", () => ({ updateTag: vi.fn(), revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: () => ({ select: () => ({ in: async () => ({ data: [], error: null }) }) }) }),
}));
vi.mock("./dashboard-assignments", () => ({ validateDashboardAssignments: vi.fn() }));
// 과목 행이 사라지는 저장은 그 과목의 신규생 관리 기록(서버 전용 표)을 다시 본다 — 이 시험의 과목엔 기록이 없다
// (기록이 있을 때 거절하는 것은 subject-actions-contract.test.ts).
vi.mock("@/features/newcomers/server/subject-refs", () => ({ subjectsWithNewcomerRecords: async () => [] }));
vi.mock("@/lib/storage/media-storage", () => ({ createUploadTicket: vi.fn(), MEDIA_KIND: {} }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: m.row ? structuredClone(m.row) : null, error: null }) }) }),
      update: (value: { data: Record<string, unknown>; updated_at: string }) => {
        const conditions: Record<string, unknown> = {};
        const writer = {
          eq: (column: string, expected: unknown) => {
            conditions[column] = expected;
            return writer;
          },
          select: async () => {
            m.beforeWrite?.();
            m.beforeWrite = null;
            if (!m.row || conditions.updated_at !== m.row.updated_at) return { data: [], error: null };
            if (m.delegatedSections) {
              // 가드: 개별 설정으로 고칠 수 있는 섹션들과 `version`을 뺀 나머지가 그대로여야 한다.
              const editable = ["profile", "operations", "billing", "notifications", "consultations", "navigation", "report", "version"];
              const rest = (data: Record<string, unknown>) => JSON.stringify(Object.fromEntries(Object.entries(data).filter(([k]) => !editable.includes(k)).sort()));
              const changedSections = editable.filter((k) => k !== "version" && JSON.stringify(value.data[k]) !== JSON.stringify(m.row!.data[k]));
              if (rest(value.data) !== rest(m.row.data) || changedSections.some((k) => !m.delegatedSections!.includes(k))) {
                // 쓰기 가드는 사유를 한글 문장으로 RAISE한다(코드 P0001) — 화면엔 그 문장이 그대로 나온다.
                return { data: null, error: { code: "P0001", message: "학원 설정 변경 권한이 없습니다" } };
              }
            }
            m.writes += 1;
            // 넘어온 값을 그대로 저장한다(시각은 테스트가 시계를 움직여 정한다 — 아래 `call`).
            m.row = { data: structuredClone(value.data), updated_at: value.updated_at };
            return { data: [{ tenant_id: "tenant-a" }], error: null };
          },
        };
        return writer;
      },
      insert: (value: { data: Record<string, unknown>; updated_at: string }) => ({
        select: async () => {
          m.writes += 1;
          m.row = { data: structuredClone(value.data), updated_at: value.updated_at };
          return { data: [{ tenant_id: "tenant-a" }], error: null };
        },
      }),
    }),
  }),
}));
import { saveOwnerSection } from "./actions";
import { CHANGED_ELSEWHERE_ERROR, STALE_FORM_ERROR, operationsFaceToken } from "./operations-save";

const GROUPS = [{ id: "g1", title: "1교시", classIds: ["c1", "c2"] }];
/** 지금 DB에 있는 운영 섹션(화면·저장이 읽는 것과 같은 해석). */
const stored = (): OperationsSettings => resolveSettings(m.row?.data ?? null, { name: "" }).operations;
const rawStored = () => (m.row!.data.operations ?? {}) as Record<string, unknown>;
const subject = (ops: OperationsSettings, key: string): SubjectSetting => ops.subjects.find((s) => s.key === key)!;
const renameSubject = (ops: OperationsSettings, key: string, label: string): OperationsSettings => ({
  ...ops,
  subjects: ops.subjects.map((s) => (s.key === key ? { ...s, label } : s)),
});

/** 저장 한 번 — 호출마다 시계를 1초 민다(저장 시각이 곧 수정 표식이라, 시각을 테스트가 명시적으로 정한다). */
const call = (fd: FormData) => {
  vi.setSystemTime(new Date(Date.now() + 1000));
  return saveOwnerSection(undefined, fd);
};

/** 한 창이 면을 연 순간 — 그때의 값과 기준 token을 들고 있다가 나중에 저장한다. */
function openWindow(face: OperationsFace) {
  const draft = stored();
  const baseline = operationsFaceToken(draft, face);
  return {
    draft,
    baseline,
    save: (data: OperationsSettings, token: string | null = baseline) => {
      const fd = new FormData();
      fd.set("section", "operations");
      fd.set("data", JSON.stringify(data));
      fd.set("operationsFace", face);
      if (token !== null) fd.set("operationsBaseline", token);
      return call(fd);
    },
  };
}
const sendIntent = (intent: string, data: unknown) => {
  const fd = new FormData();
  fd.set("section", "operations");
  fd.set("operationsFace", intent);
  fd.set("data", JSON.stringify(data));
  return call(fd);
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-05T01:00:00.000Z"));
  vi.clearAllMocks();
  m.actor.displayName = "원장";
  m.allowed = true;
  m.beforeWrite = null;
  m.delegatedSections = null;
  m.writes = 0;
  m.row = { data: { operations: structuredClone(DEFAULT_SETTINGS.operations) }, updated_at: "2026-10-05T00:00:00Z" };
});
afterEach(() => {
  vi.useRealTimers();
});

describe("두 면", () => {
  it("🔴 다른 면을 번갈아 저장하면 둘 다 남는다 — 나중 저장이 먼저 한 저장을 되돌리지 않는다", async () => {
    const operationsWindow = openWindow("operations");
    const subjectsWindow = openWindow("subjects");
    const holidays = [{ date: "2026-10-09", name: "한글날" }];

    expect((await operationsWindow.save({ ...operationsWindow.draft, holidays }))?.ok).toBe(true);
    // 과목 운영 창은 휴원일이 비어 있던 옛 값을 그대로 들고 저장한다.
    expect((await subjectsWindow.save(renameSubject(subjectsWindow.draft, "english", "영어B")))?.ok).toBe(true);

    expect(stored().holidays).toEqual(holidays);
    expect(subject(stored(), "english").label).toBe("영어B");
  });

  it("같은 면을 두 창에서 고치면 나중 저장은 거절된다(덮지 않는다)", async () => {
    const first = openWindow("operations");
    const second = openWindow("operations");
    const holidays = [{ date: "2026-10-09", name: "한글날" }];
    expect((await first.save({ ...first.draft, holidays }))?.ok).toBe(true);

    const result = await second.save({ ...second.draft, gradeLevels: ["초1"] });
    expect(result?.ok).toBeUndefined();
    expect(result?.error).toBe(CHANGED_ELSEWHERE_ERROR);
    expect(stored().holidays).toEqual(holidays);
    expect(stored().gradeLevels).toEqual(DEFAULT_SETTINGS.operations.gradeLevels);
  });

  it("자기 저장 뒤 응답의 token으로 다시 저장할 수 있다", async () => {
    const window = openWindow("subjects");
    const once = await window.save(renameSubject(window.draft, "math", "수학B"));
    expect(once?.ok).toBe(true);
    expect(once?.operations?.tokens.subjects).toBe(operationsFaceToken(stored(), "subjects"));

    const twice = await window.save(renameSubject(window.draft, "math", "수학C"), once!.operations!.tokens.subjects);
    expect(twice?.ok).toBe(true);
    expect(subject(stored(), "math").label).toBe("수학C");
    // 옛 token으로는 더 저장할 수 없다.
    expect((await window.save(renameSubject(window.draft, "math", "수학D")))?.error).toBe(CHANGED_ELSEWHERE_ERROR);
  });

  it("면이 없거나 모르는 값이거나 기준 token이 없으면 저장하지 않는다 — 섹션 통째 교체는 받지 않는다", async () => {
    const window = openWindow("operations");
    const whole = new FormData();
    whole.set("section", "operations");
    whole.set("data", JSON.stringify({ ...window.draft, holidays: [{ date: "2026-10-09", name: "x" }] }));
    expect((await call(whole))?.error).toBe(STALE_FORM_ERROR);
    expect((await sendIntent("everything", window.draft))?.error).toBe(STALE_FORM_ERROR);
    expect((await window.save(window.draft, null))?.error).toBe(STALE_FORM_ERROR);
    expect((await window.save(window.draft, ""))?.error).toBe(STALE_FORM_ERROR);
    expect(m.writes).toBe(0);
  });

  it("권한이 없으면 요청 형식과 무관하게 거절된다", async () => {
    m.allowed = false;
    const window = openWindow("subjects");
    expect((await window.save(window.draft))?.error).toBe("학원 설정 변경 권한이 없습니다");
    expect((await sendIntent("subject-remove", { key: "english" }))?.error).toBe("학원 설정 변경 권한이 없습니다");
    expect(m.writes).toBe(0);
  });

  it("🔴 병합한 결과를 다시 검증한다 — 원 요청은 멀쩡해도 방금 읽은 값과 합친 것이 규칙을 어기면 저장하지 않는다", async () => {
    // 운영 체계 창이 열려 있는 동안, 저장돼 있던 과목 목록이 규칙에 안 맞는 값(이름 중복)으로 바뀌었다(스크립트 등).
    // 이 창이 보내는 값은 그 자체로 유효하고, 이 면의 기준 token도 그대로다(과목은 이 면이 맡지 않는다).
    const window = openWindow("operations");
    const freshSubjects = stored().subjects.map((s, i) => (i === 1 ? { ...s, label: stored().subjects[0]!.label } : s));
    m.row = { data: { ...m.row!.data, operations: { ...stored(), subjects: freshSubjects } }, updated_at: "2026-10-05T00:30:00Z" };

    const result = await window.save({ ...window.draft, gradeLevels: ["초1"] });
    expect(result?.ok).toBeUndefined();
    expect(result?.error).toContain("과목명이 중복됩니다");
    expect(m.writes).toBe(0);
  });
});

describe("시간표 쪽 저장(subject-fields)", () => {
  it("🔴 그 과목의 보낸 칸만 바뀐다 — 운영 섹션의 다른 값은 방금 읽은 그대로", async () => {
    const holidays = [{ date: "2026-10-09", name: "한글날" }];
    m.row!.data.operations = { ...stored(), holidays };
    const result = await sendIntent("subject-fields", { subject: "english", fields: { teacherViewOrder: ["T1", "T2"], integrationGroups: GROUPS } });
    expect(result?.ok).toBe(true);
    expect(subject(stored(), "english").teacherViewOrder).toEqual(["T1", "T2"]);
    expect(subject(stored(), "english").integrationGroups).toEqual(GROUPS);
    expect(stored().holidays).toEqual(holidays);
    expect(subject(stored(), "math").teacherViewOrder).toBeUndefined();
  });

  it("🔴 열려 있던 과목 운영 창이 나중에 저장해도 시간표 값이 남는다(창의 옛 값으로 되돌리지 않는다)", async () => {
    const window = openWindow("subjects"); // 강사 순서가 없던 때 열었다
    await sendIntent("subject-fields", { subject: "english", fields: { teacherViewOrder: ["T1", "T2"] } });

    // 시간표 저장은 과목 운영 면의 변경이 아니다 — 창의 token이 그대로 통한다.
    expect((await window.save(renameSubject(window.draft, "english", "영어B")))?.ok).toBe(true);
    expect(subject(stored(), "english").label).toBe("영어B");
    expect(subject(stored(), "english").teacherViewOrder).toEqual(["T1", "T2"]);
  });

  it("🔴 시간표에서 지운 칸은 열려 있던 창의 저장으로 되살아나지 않는다", async () => {
    m.row!.data.operations = renameSubject(stored(), "english", "영어");
    await sendIntent("subject-fields", { subject: "english", fields: { teacherViewOrder: ["옛순서"], integrationOthersTitle: "기타반" } });
    const window = openWindow("subjects"); // 옛 순서를 든 채 열려 있다
    await sendIntent("subject-fields", { subject: "english", fields: { teacherViewOrder: null, integrationOthersTitle: null } });

    expect((await window.save(renameSubject(window.draft, "english", "영어B")))?.ok).toBe(true);
    const english = rawStored().subjects as Record<string, unknown>[];
    const row = english.find((s) => s.key === "english")!;
    expect("teacherViewOrder" in row).toBe(false);
    expect("integrationOthersTitle" in row).toBe(false);
  });

  it("옛 저장 행(기본값 칸 없음)에 시간표 저장이 지나가도 열려 있던 과목 운영 창은 충돌이 아니다", async () => {
    // color·weekdayGrouping·testMax 없이 저장돼 있던 행 — 시간표 저장이 섹션을 다시 쓰면서 기본값이 채워진다.
    m.row!.data.operations = { ...stored(), subjects: [{ key: "english", label: "영어" }, { key: "math", label: "수학" }] };
    const window = openWindow("subjects");
    expect((await sendIntent("subject-fields", { subject: "english", fields: { integrationGroups: GROUPS } }))?.ok).toBe(true);
    expect((rawStored().subjects as Record<string, unknown>[])[0]!.testMax).toBe(5);

    expect((await window.save(renameSubject(window.draft, "math", "수학B")))?.ok).toBe(true);
    expect(subject(stored(), "english").integrationGroups).toEqual(GROUPS);
  });

  it("🔴 저장 액션을 직접 불러도 보관함의 '누가·언제'를 꾸밀 수 없다 — 도장은 서버가 방금 읽은 값으로 찍는다", async () => {
    const groups = [{ id: "g1", title: "1교시", classIds: ["c1"] }];
    const first = await sendIntent("subject-fields", {
      subject: "english",
      fields: { integrationGroupPresets: [{ id: "p1", name: "학기 배치", groups, savedBy: "다른 직원", savedAt: "2020-01-01T00:00:00Z" }] },
    });
    expect(first?.ok).toBe(true);
    const stampedAt = new Date(Date.now()).toISOString();
    expect(subject(stored(), "english").integrationGroupPresets).toEqual([{ id: "p1", name: "학기 배치", groups, savedBy: "원장", savedAt: stampedAt }]);
    // 응답으로 도장 찍힌 보관함이 돌아온다(화면엔 도장이 없다).
    expect(first?.operations?.presets).toEqual(subject(stored(), "english").integrationGroupPresets);

    // 내용이 그대로인 항목은 다시 저장해도(다른 도장을 실어 보내도) 처음 도장을 유지하고, 새 항목만 지금 도장을 받는다.
    m.actor.displayName = "실장";
    const second = await sendIntent("subject-fields", {
      subject: "english",
      fields: {
        integrationGroupPresets: [
          { id: "p1", name: "학기 배치", groups, savedBy: "위조", savedAt: "1999-01-01T00:00:00Z" },
          { id: "p2", name: "방학 배치", groups: [], savedBy: "위조" },
        ],
      },
    });
    expect(second?.ok).toBe(true);
    const presets = subject(stored(), "english").integrationGroupPresets!;
    expect(presets[0]).toMatchObject({ id: "p1", savedBy: "원장", savedAt: stampedAt });
    expect(presets[1]).toMatchObject({ id: "p2", savedBy: "실장", savedAt: new Date(Date.now()).toISOString() });
  });

  it("직접 부른 요청도 같은 다듬기를 거친다 — 제목이 공백뿐인 줄·줄 사이 중복 배정·공백 섞인 강사 순서", async () => {
    const result = await sendIntent("subject-fields", {
      subject: "english",
      fields: {
        teacherViewOrder: [" Jane ", "Jane", "Tom"],
        integrationOthersTitle: "   ",
        integrationGroups: [
          { id: "g1", title: " 1교시 ", classIds: ["c1", "c2"] },
          { id: "g2", title: "   ", classIds: ["c3"] },
          { id: "g3", title: "2교시", classIds: ["c2", "c4"] },
        ],
      },
    });
    expect(result?.ok).toBe(true);
    const english = subject(stored(), "english");
    expect(english.teacherViewOrder).toEqual(["Jane", "Tom"]);
    expect("integrationOthersTitle" in english).toBe(false);
    expect(english.integrationGroups).toEqual([
      { id: "g1", title: "1교시", classIds: ["c1", "c2"] },
      { id: "g3", title: "2교시", classIds: ["c4"] },
    ]);
  });

  it("보관함을 안 보내면 그대로 두고, 빈 배열을 보내면 비운다", async () => {
    const groups = [{ id: "g1", title: "1교시", classIds: ["c1"] }];
    await sendIntent("subject-fields", { subject: "english", fields: { integrationGroupPresets: [{ id: "p1", name: "학기 배치", groups }] } });
    await sendIntent("subject-fields", { subject: "english", fields: { integrationGroups: groups } });
    expect(subject(stored(), "english").integrationGroupPresets).toHaveLength(1);
    await sendIntent("subject-fields", { subject: "english", fields: { integrationGroupPresets: [] } });
    expect(subject(stored(), "english").integrationGroupPresets).toEqual([]);
  });

  it("허용한 여섯 칸 밖의 속성·없는 과목은 거절한다(과목을 만들지 않는다)", async () => {
    expect((await sendIntent("subject-fields", { subject: "english", fields: { label: "가로채기" } }))?.error).toBeTruthy();
    expect((await sendIntent("subject-fields", { subject: "nope", fields: { teacherViewOrder: ["A"] } }))?.error).toBe("학원 설정에 없는 과목입니다");
    expect(m.writes).toBe(0);
  });
});

describe("과목 삭제(subject-remove)", () => {
  it("그 과목 행만 빠지고, 확정된 과목 운영 면의 값과 그 값의 token을 함께 돌려준다", async () => {
    const result = await sendIntent("subject-remove", { key: "science" });
    expect(result?.ok).toBe(true);
    expect(stored().subjects.some((s) => s.key === "science")).toBe(false);
    expect(result?.operations?.subjectsFace?.subjects).toEqual(stored().subjects);
    expect(result?.operations?.tokens.subjects).toBe(operationsFaceToken(stored(), "subjects"));
    expect(JSON.stringify(result)).not.toContain("seatPins");
  });

  it("🔴 깨끗한 창 A가 과목을 지우는 사이 B가 다른 과목을 고쳤어도, A가 응답을 그대로 채택하면 B의 변경이 남는다", async () => {
    const a = openWindow("subjects"); // 아무것도 고치지 않았다
    const b = openWindow("subjects");
    const bDraft: OperationsSettings = {
      ...renameSubject(b.draft, "math", "수학B"),
      subjects: [...renameSubject(b.draft, "math", "수학B").subjects, { key: "subject_9", label: "논술", color: "neutral", weekdayGrouping: "mon-thu", testMax: 5 }],
    };
    expect((await b.save(bDraft))?.ok).toBe(true);

    // A가 과학을 지운다 — 서버는 방금 읽은 값에서 그 행만 뺀다.
    const removed = await sendIntent("subject-remove", { key: "science" });
    const reply = removed!.operations!;
    expect(reply.subjectsFace!.subjects.map((s) => s.key)).toEqual(expect.arrayContaining(["math", "subject_9"]));

    // A는 응답의 값과 token을 **함께** 받아 이어서 저장한다.
    const adopted = { ...a.draft, ...reply.subjectsFace! };
    expect((await a.save(renameSubject(adopted, "english", "영어B"), reply.tokens.subjects))?.ok).toBe(true);
    expect(subject(stored(), "math").label).toBe("수학B");
    expect(stored().subjects.some((s) => s.key === "subject_9")).toBe(true);
    expect(stored().subjects.some((s) => s.key === "science")).toBe(false);
  });

  it("🔴 그사이 B가 다른 과목을 지웠어도 A의 삭제 응답에는 그 삭제가 반영돼 있다 — A가 되살리지 않는다", async () => {
    const a = openWindow("subjects");
    const b = openWindow("subjects");
    expect((await b.save({ ...b.draft, subjects: b.draft.subjects.filter((s) => s.key !== "korean") }))?.ok).toBe(true);

    const reply = (await sendIntent("subject-remove", { key: "science" }))!.operations!;
    expect(reply.subjectsFace!.subjects.some((s) => s.key === "korean")).toBe(false);

    // 채택한 값으로 이어서 저장 — 국어도 과학도 돌아오지 않는다.
    const adopted = { ...a.draft, ...reply.subjectsFace! };
    expect((await a.save(renameSubject(adopted, "math", "수학B"), reply.tokens.subjects))?.ok).toBe(true);
    const expected = a.draft.subjects.map((s) => s.key).filter((k) => k !== "korean" && k !== "science");
    expect(stored().subjects.map((s) => s.key).sort()).toEqual([...expected].sort());
    // 🔴 반대로, A가 자기 옛 목록에서 과학만 빼고 새 token을 붙여 보내면 국어가 되살아난다 — 화면이 그렇게 하지 않는 이유다.
    const wrong = { ...a.draft, subjects: a.draft.subjects.filter((s) => s.key !== "science") };
    await a.save(wrong, operationsFaceToken(stored(), "subjects"));
    expect(stored().subjects.some((s) => s.key === "korean")).toBe(true);
  });

  it("다른 창의 옛 과목 목록은 저장이 거절된다 — 지운 과목이 되살아나지 않는다", async () => {
    const stale = openWindow("subjects");
    await sendIntent("subject-remove", { key: "science" });
    expect((await stale.save(renameSubject(stale.draft, "math", "수학B")))?.error).toBe(CHANGED_ELSEWHERE_ERROR);
    expect(stored().subjects.some((s) => s.key === "science")).toBe(false);
  });

  it("이미 없는 과목이면 쓰지 않고 지금 상태를 돌려준다", async () => {
    const result = await sendIntent("subject-remove", { key: "nope" });
    expect(result?.ok).toBe(true);
    expect(m.writes).toBe(0);
    expect(m.audit).not.toHaveBeenCalled();
    expect(result?.operations?.subjectsFace?.subjects).toEqual(stored().subjects);
  });

  it("키 밖의 속성을 실은 요청은 거절한다", async () => {
    expect((await sendIntent("subject-remove", { key: "science", subjects: [] }))?.error).toBeTruthy();
    expect(m.writes).toBe(0);
  });
});

describe("저장 전 다듬기와 다른 칸 보존", () => {
  it("침산 행에는 새 칸 둘(교시 방식·학교 별칭)이 남지 않는다 — 어느 요청으로 저장해도", async () => {
    const window = openWindow("subjects");
    await window.save(renameSubject(window.draft, "math", "수학B"));
    expect("periodStyle" in rawStored()).toBe(false);
    expect("schoolSaveAliases" in rawStored()).toBe(false);
    await sendIntent("subject-fields", { subject: "english", fields: { teacherViewOrder: ["T1"] } });
    expect("periodStyle" in rawStored()).toBe(false);
    expect("schoolSaveAliases" in rawStored()).toBe(false);
  });

  it("일반판의 교시 방식·학교 별칭·부서별 직급·학기는 어느 면을 저장해도 그대로다", async () => {
    const departments = { 영어과: ["원장", "강사"] };
    const terms = [{ name: "1학기", start: "2026-03-01", end: "2026-07-20" }];
    m.row = {
      data: {
        version: 1,
        preset: "generic",
        operations: { ...structuredClone(GENERIC_SETTINGS.operations), jobTitlesByDepartment: departments, terms, schoolSaveAliases: [{ from: "가", to: "나" }] },
      },
      updated_at: "2026-10-05T00:00:00Z",
    };
    const subjectsWindow = openWindow("subjects");
    expect((await subjectsWindow.save(renameSubject(subjectsWindow.draft, "math", "수학B")))?.ok).toBe(true);
    const operationsWindow = openWindow("operations");
    expect((await operationsWindow.save({ ...operationsWindow.draft, gradeLevels: ["초1", "초2"] }))?.ok).toBe(true);

    expect(m.row!.data.preset).toBe("generic");
    expect(rawStored().periodStyle).toBe("plain");
    expect(rawStored().schoolSaveAliases).toEqual([{ from: "가", to: "나" }]);
    expect(stored().jobTitlesByDepartment).toEqual(departments);
    expect(stored().terms).toEqual(terms);
    expect(stored().gradeLevels).toEqual(["초1", "초2"]);
    expect(subject(stored(), "math").label).toBe("수학B");
  });

  it("운영 섹션 밖의 설정(다른 섹션)은 그대로다", async () => {
    m.row!.data.profile = { name: "합성학원" };
    m.row!.data.modules = { disabled: ["shuttle"] };
    const window = openWindow("operations");
    await window.save({ ...window.draft, gradeLevels: ["초1"] });
    expect(m.row!.data.profile).toEqual({ name: "합성학원" });
    expect(m.row!.data.modules).toEqual({ disabled: ["shuttle"] });
  });
});

describe("저장 순번(운영 섹션의 rev)과 수정 표식(updated_at)", () => {
  const rev = () => ((m.row!.data.operations ?? {}) as { rev?: number }).rev;

  it("🔴 운영 섹션을 저장할 때마다 순번이 1씩 오르고, 응답이 그 순번을 돌려준다 — 화면이 읽기와 저장의 선후를 가리는 기준", async () => {
    expect(rev()).toBeUndefined(); // 이 규칙 전의 문서 = 0으로 본다
    const window = openWindow("operations");
    const first = await window.save({ ...window.draft, gradeLevels: ["초1"] });
    expect(first?.version).toBe(1);
    expect(rev()).toBe(1);

    const second = await sendIntent("subject-fields", { subject: "english", fields: { teacherViewOrder: ["T1"] } });
    expect(second?.version).toBe(2);
    const third = await sendIntent("subject-remove", { key: "science" });
    expect(third?.version).toBe(3);
    expect(rev()).toBe(3);
  });

  it("🔴 순번은 문서 최상위가 아니라 운영 섹션 안에 있다 — 문서의 다른 칸은 한 글자도 달라지지 않는다", async () => {
    m.row!.data = { ...m.row!.data, version: 1, preset: "generic", profile: { name: "합성학원" }, modules: { disabled: ["shuttle"] } };
    const before = { ...m.row!.data };
    const window = openWindow("subjects");
    await window.save(renameSubject(window.draft, "math", "수학B"));
    expect(Object.keys(m.row!.data).sort()).toEqual(Object.keys(before).sort());
    for (const key of Object.keys(before)) if (key !== "operations") expect(m.row!.data[key]).toEqual(before[key]);
  });

  it("🔴 운영 설정만 위임받은 사람의 저장이 DB 쓰기 가드를 통과한다(맡은 섹션 밖을 건드리지 않는다)", async () => {
    m.delegatedSections = ["operations"];
    const window = openWindow("operations");
    const result = await window.save({ ...window.draft, gradeLevels: ["초1"] });
    expect(result?.error).toBeUndefined();
    expect(result?.ok).toBe(true);
    expect(stored().gradeLevels).toEqual(["초1"]);
    // 시간표 칸·과목 삭제 요청도 같은 섹션 안의 쓰기다.
    expect((await sendIntent("subject-fields", { subject: "english", fields: { teacherViewOrder: ["T1"] } }))?.ok).toBe(true);
    expect((await sendIntent("subject-remove", { key: "science" }))?.ok).toBe(true);
  });

  it("가드 흉내가 실제로 막는지 — 맡지 않은 섹션이나 문서의 다른 칸이 달라지면 거절된다", async () => {
    m.delegatedSections = ["billing"]; // 운영 설정은 맡지 않았다(앱 게이트는 모의라 통과시킨다)
    const window = openWindow("operations");
    expect((await window.save({ ...window.draft, gradeLevels: ["초1"] }))?.error).toBe("학원 설정 변경 권한이 없습니다");
    expect(m.writes).toBe(0);
  });

  it("🔴 순번은 시계와 무관하다 — 서버 시계가 뒤로 가 있어도 순번은 오른다", async () => {
    m.row!.data.operations = { ...stored(), rev: 7 };
    m.row!.updated_at = "2026-10-05T09:00:00.000Z"; // 지금 시계(01:00대)보다 미래
    const window = openWindow("subjects");
    const result = await window.save(renameSubject(window.draft, "math", "수학B"));
    expect(result?.version).toBe(8);
    // 수정 표식도 직전 값과 같아지지 않는다(읽은 뒤 누가 썼나의 판정용).
    expect(m.row!.updated_at).toBe("2026-10-05T09:00:00.001Z");
  });

  it("🔴 순번을 모르는 쓰기(DB 안에서 한 칸만 고치는 쓰기)가 끼어도 순번은 줄지 않는다", async () => {
    const window = openWindow("operations");
    expect((await window.save({ ...window.draft, gradeLevels: ["초1"] }))?.version).toBe(1);
    // 보강 설정 RPC처럼 문서의 다른 칸만 바꾸는 쓰기, 시트 반영처럼 운영 섹션의 한 칸만 바꾸는 쓰기 —
    // 순번은 건드리지 않고 자기 시계의 시각을 쓴다(더 옛 시각일 수 있다).
    const ops = m.row!.data.operations as Record<string, unknown>;
    m.row = {
      data: { ...m.row!.data, makeups: { mode: "pilot" }, operations: { ...ops, subjects: (ops.subjects as Record<string, unknown>[]).map((s) => (s.key === "english" ? { ...s, integrationGroups: GROUPS } : s)) } },
      updated_at: "2026-10-04T00:00:00Z",
    };
    const next = openWindow("operations");
    expect((await next.save({ ...next.draft, gradeLevels: ["초1", "초2"] }))?.version).toBe(2);
    expect(m.row!.data.makeups).toEqual({ mode: "pilot" });
    expect(subject(stored(), "english").integrationGroups).toEqual(GROUPS);
  });

  it("쓰지 않은 요청(이미 없는 과목 삭제)은 지금 순번을 그대로 돌려준다", async () => {
    m.row!.data.operations = { ...stored(), rev: 4 };
    const result = await sendIntent("subject-remove", { key: "nope" });
    expect(result?.version).toBe(4);
    expect(rev()).toBe(4);
  });

  it("🔴 첫 저장(설정 행이 아직 없다) — 행을 만들고 순번 1을 돌려준다", async () => {
    m.row = null;
    const window = openWindow("operations"); // 행 없음 = 기본값으로 연 화면
    const result = await window.save({ ...window.draft, gradeLevels: ["초1"] });
    expect(result?.ok).toBe(true);
    expect(result?.version).toBe(1);
    expect(rev()).toBe(1);
    expect(stored().gradeLevels).toEqual(["초1"]);
  });

  it("순번은 설정 값에 섞이지 않고, 감사 기록의 변경 내역에도 실리지 않는다", async () => {
    const window = openWindow("operations");
    await window.save({ ...window.draft, gradeLevels: ["초1"] });
    await openWindow("operations").save({ ...stored(), gradeLevels: ["초1", "초2"] });
    expect("rev" in stored()).toBe(false);
    const logged = m.audit.mock.calls.at(-1)![0] as { metadata: { changes?: { label: string }[]; others?: number } };
    expect(logged.metadata.changes?.map((c) => c.label)).toEqual(["학년"]);
    expect(logged.metadata.others).toBeUndefined();
  });
});

describe("최종 쓰기 직전의 충돌", () => {
  it("🔴 읽은 뒤·쓰기 전에 다른 곳(cron·시트 반영·데모 구성)이 문서를 바꿨으면 저장하지 않는다", async () => {
    const window = openWindow("operations");
    m.beforeWrite = () => {
      // 다른 writer가 통합뷰 그룹을 넣고 수정 표식을 갱신했다.
      const ops = stored();
      m.row = {
        data: { ...m.row!.data, operations: { ...ops, subjects: ops.subjects.map((s) => (s.key === "english" ? { ...s, integrationGroups: GROUPS } : s)) } },
        updated_at: "2026-10-05T00:30:00Z",
      };
    };
    const result = await window.save({ ...window.draft, gradeLevels: ["초1"] });
    expect(result?.ok).toBeUndefined();
    expect(result?.error).toContain("먼저 저장되었습니다");
    expect(subject(stored(), "english").integrationGroups).toEqual(GROUPS);
    expect(stored().gradeLevels).toEqual(DEFAULT_SETTINGS.operations.gradeLevels);
    expect(m.audit).not.toHaveBeenCalled();
  });
});

describe("검증 오류의 화면 문구 — 어느 과목의 어느 칸인지와 한도를 말한다", () => {
  it("🔴 영어 과목의 월간 계획서 안내가 600자를 넘으면, 과목 이름 · 칸 이름 · 한도가 실린다(내부 경로·영문 원문은 없다)", async () => {
    const window = openWindow("subjects");
    const english = subject(window.draft, "english");
    const data: OperationsSettings = {
      ...window.draft,
      subjects: window.draft.subjects.map((s) =>
        s.key === "english" ? { ...s, monthPlan: { bookLegend: "", notices: "가".repeat(601), slogan: "", prepTitle: "", prepNotes: "" } } : s,
      ),
    };
    const res = await window.save(data);
    expect(res?.error).toBe(`입력값 오류 (과목 '${english.label}' · 월간 계획서 · 표 위 안내): 600자 이내로 입력해 주세요`);
    expect(res?.error).not.toMatch(/subjects|monthPlan|notices|Too big|expected/);
    expect(m.writes).toBe(0);
  });
});

