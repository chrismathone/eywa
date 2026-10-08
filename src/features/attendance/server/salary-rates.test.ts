import { beforeEach, describe, expect, it, vi } from "vitest";
import { accessLevel, type SystemRole } from "@/lib/permissions";
const VIEW_TABLE = "attendance_salary_teacher_view";
const h = vi.hoisted(() => ({
  access: vi.fn(), manage: vi.fn(), read: vi.fn(), scope: vi.fn(), effective: vi.fn(), from: vi.fn(), log: vi.fn(), classes: vi.fn(),
  /** upsert에 넘긴 옵션 — 충돌 키(`onConflict`)가 달까지 들어갔는지 본다(옛 키로 돌아가면 운영에서만 저장이 전부 실패한다). */
  writeOptions: [] as unknown[],
  /** 스위치 표에 건 조건 — 지점·선생님으로 좁혔는지 본다(admin 클라이언트라 RLS가 대신 걸러 주지 않는다). */
  viewFilters: [] as Record<string, unknown>[],
  replies: [] as unknown[], writes: [] as unknown[], tables: [] as string[], disabled: [] as string[],
  /** 선생님별 스위치 표(0352a)의 읽기·쓰기 응답 — 다른 표의 응답 줄(replies)과 섞이지 않게 따로 둔다. */
  visible: { data: null, error: null } as unknown, visibleWrite: { error: null } as unknown,
}));
vi.mock("@/lib/auth/require-access", () => ({ requireAccess: h.access }));
vi.mock("@/lib/auth/perm-matrix", () => ({ canManageTenant: h.manage, canAccessTenant: h.read }));
vi.mock("@/lib/auth/view-as", () => ({ isReadonlyTeacherView: h.scope }));
vi.mock("@/lib/auth/view-mode", () => ({ effectiveTeacherId: h.effective }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: h.from }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/features/owner/server/queries", () => ({ getTenantSettings: async () => ({ modules: { disabled: h.disabled } }) }));
vi.mock("@/features/audit/server/log", () => ({ logAction: h.log }));
vi.mock("./teacher-axis-queries", () => ({ loadClassAxisRows: h.classes }));
import { getAttendanceSalaryRates, loadAttendanceSalaryRates } from "./salary-rates";
import { saveAttendanceSalaryRates, saveAttendanceSalaryVisible } from "./salary-rates-actions";
const teacherId = "aaaaaaaa-1111-1111-1111-111111111111";
const otherId = "bbbbbbbb-2222-2222-2222-222222222222";
/** 출석부가 보는 달 — 스위치는 달마다 따로다(원장 2026-10-07 *"9월에 보여주기 눌렀다고해서 10월에 보여주는건 아님"*). */
const MONTH = "2026-09";
const rates = { regular: { 초등: 40, 중등: 45, 고등: 50 }, special: { 초등: 55, 중등: 60, 고등: 65 }, classes: {} };
const freelancer = { data: { employment_type: "프리랜서", commission_rate: 10, commission_rates: {}, display_name: "김강사" }, error: null };
const savedRates = { data: { rates, updated_at: "2026-09-21" }, error: null };

beforeEach(() => {
  vi.clearAllMocks(); h.replies = []; h.writes = []; h.tables = []; h.disabled = []; h.viewFilters = []; h.writeOptions = [];
  h.visible = { data: null, error: null }; h.visibleWrite = { error: null };
  h.access.mockResolvedValue({ id: "admin", tenantId: "tenant", systemRole: "admin" });
  h.manage.mockImplementation(async (role: SystemRole) => accessLevel(role, "attendance_salary_settings") === "full"); h.scope.mockResolvedValue(false); h.classes.mockResolvedValue([]);
  h.read.mockImplementation(async (role: SystemRole) => accessLevel(role, "attendance_salary_settings") !== "none");
  h.effective.mockResolvedValue(null);
  h.from.mockImplementation((table: string) => {
    h.tables.push(table);
    const isView = table === VIEW_TABLE;
    let result: unknown = isView ? h.visible : h.replies.shift() ?? { data: null, error: null };
    const builder: Record<string, unknown> = {};
    const filters: Record<string, unknown> = {};
    if (isView) h.viewFilters.push(filters);
    for (const method of ["select", "maybeSingle"]) builder[method] = () => builder;
    builder.eq = (col: string, value: unknown) => { filters[col] = value; return builder; };
    builder.upsert = (payload: unknown, options?: unknown) => { h.writes.push(payload); h.writeOptions.push(options); if (isView) result = h.visibleWrite; return builder; };
    builder.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve);
    return builder;
  });
});
it.each(["teacher", "accountant", "viewer"])("never reads or writes salary rates for %s", async (systemRole) => {
  h.access.mockResolvedValue({ id: teacherId, tenantId: "tenant", systemRole });
  expect(await getAttendanceSalaryRates(teacherId, MONTH)).toBeNull();
  expect((await saveAttendanceSalaryRates({ teacherId, month: "2026-09", rates })).ok).toBe(false);
  expect(h.from).not.toHaveBeenCalled();
});
it("does not expose rates in an administrator's teacher preview", async () => {
  h.scope.mockResolvedValue(teacherId);
  expect(await getAttendanceSalaryRates(teacherId, MONTH)).toBeNull();
  expect(h.from).not.toHaveBeenCalled();
});
it("respects the attendance administrator permission gate", async () => {
  h.manage.mockResolvedValue(false); h.read.mockResolvedValue(false);
  expect((await saveAttendanceSalaryRates({ teacherId, month: "2026-09", rates })).ok).toBe(false);
  expect(h.from).not.toHaveBeenCalled();
});
it("saves the six rates for only the selected freelance teacher in the authenticated tenant", async () => {
  h.replies = [{ data: { employment_type: "프리랜서" }, error: null }, { data: null, error: null }, { error: null }];
  expect(await saveAttendanceSalaryRates({ teacherId, month: "2026-09", rates })).toEqual({ ok: true });
  expect(h.writes).toEqual([expect.objectContaining({ tenant_id: "tenant", teacher_id: teacherId, rates, updated_by: "admin" })]);
});
it("특강 포함은 선택한 선생님 설정에 저장하고 바뀔 때만 감사로그를 남긴다", async () => {
  const scoped = { ...rates, levels: ["고등"], includeSpecial: true };
  h.replies = [freelancer, { data: { rates: { ...rates, levels: ["고등"] } }, error: null }, { error: null }];
  expect(await saveAttendanceSalaryRates({ teacherId, month: MONTH, rates: scoped as never })).toEqual({ ok: true });
  expect(h.writes).toEqual([expect.objectContaining({ tenant_id: "tenant", teacher_id: teacherId, rates: scoped })]);
  expect(h.log).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ action: "payroll_sheet_special_scope_set", metadata: { userId: teacherId, includeSpecial: true, before: false } }));
  h.log.mockClear();
  h.replies = [freelancer, { data: { rates: scoped }, error: null }, { error: null }];
  await saveAttendanceSalaryRates({ teacherId, month: MONTH, rates: scoped as never });
  expect(h.log).not.toHaveBeenCalled();
});
// 원장 2026-10-07 *"이성우 선생님은 … 고등학생에 대해서만 급여 명세서가 나오도록"* — 대상 학년.
it("대상 학년을 저장하고, 바뀌었을 때만 감사로그를 남긴다 — 비율 숫자는 남기지 않는다", async () => {
  h.replies = [{ data: { employment_type: "프리랜서", display_name: "이강사" }, error: null }, { data: null, error: null }, { error: null }];
  expect(await saveAttendanceSalaryRates({ teacherId, month: "2026-09", rates: { ...rates, levels: ["고등"] } })).toEqual({ ok: true });
  expect(h.writes).toEqual([expect.objectContaining({ teacher_id: teacherId, rates: { ...rates, levels: ["고등"] } })]);
  expect(h.log).toHaveBeenCalledExactlyOnceWith({
    action: "payroll_sheet_levels_set", targetType: "user", targetLabel: "이강사",
    metadata: { userId: teacherId, levels: ["고등"], before: [] },
  });
  // 같은 대상 학년으로 다시 저장 — 달라진 결정이 없으니 남기지 않는다.
  h.log.mockClear();
  h.replies = [{ data: { employment_type: "프리랜서", display_name: "이강사" }, error: null }, { data: { rates: { ...rates, levels: ["고등"] } }, error: null }, { error: null }];
  expect(await saveAttendanceSalaryRates({ teacherId, month: "2026-09", rates: { ...rates, levels: ["고등"] } })).toEqual({ ok: true });
  expect(h.log).not.toHaveBeenCalled();
  // 전체로 되돌리면(세 학년 전부 = 저장값에서 칸이 빠진다) 그 사실을 남긴다.
  h.replies = [{ data: { employment_type: "프리랜서", display_name: "이강사" }, error: null }, { data: { rates: { ...rates, levels: ["고등"] } }, error: null }, { error: null }];
  expect(await saveAttendanceSalaryRates({ teacherId, month: "2026-09", rates: { ...rates, levels: ["초등", "중등", "고등"] } })).toEqual({ ok: true });
  expect(h.writes.at(-1)).toEqual(expect.objectContaining({ rates }));
  expect(h.log).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ metadata: { userId: teacherId, levels: [], before: ["고등"] } }));
});
it("🔴 대상 학년을 하나도 안 고른 요청은 저장하지 않는다 — 아무도 계산되지 않는 설정", async () => {
  expect(await saveAttendanceSalaryRates({ teacherId, month: "2026-09", rates: { ...rates, levels: [] } })).toEqual({ ok: false, error: "대상 학년을 하나 이상 골라 주세요" });
  expect((await saveAttendanceSalaryRates({ teacherId, month: "2026-09", rates: { ...rates, levels: ["수능"] } as never })).ok).toBe(false);
  expect(h.from).not.toHaveBeenCalled();
});
it("rejects a rate for an unrelated class and invalid ranges without saving", async () => {
  expect((await saveAttendanceSalaryRates({ teacherId, month: "2026-09", rates: { ...rates, special: { 고등: 101 } } })).ok).toBe(false);
  h.replies = [{ data: { employment_type: "프리랜서" }, error: null }, { data: null, error: null }];
  expect((await saveAttendanceSalaryRates({ teacherId, month: "2026-09", rates: { ...rates, classes: { [teacherId]: 40 } } })).ok).toBe(false);
  expect(h.writes).toEqual([]);
});
it("loads saved six-way rates without reverting to legacy rates", async () => {
  h.replies = [freelancer, savedRates];
  expect(await getAttendanceSalaryRates(teacherId, MONTH)).toMatchObject({ rates });
});
it("🔴 강사 정보 조회 실패 — 명세서(공용 로더)는 던지고 화면은 실급여 열만 비운다", async () => {
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  // 명세서가 null을 받으면 '프리랜서 아님'으로 읽혀 종전 티어 정산으로 떨어진다 — 다른 식의 금액이 나온다.
  h.replies = [{ data: null, error: { message: "timeout" } }];
  await expect(loadAttendanceSalaryRates("tenant", teacherId)).rejects.toThrow("강사 정보를 불러오지 못했습니다");
  // 화면은 일시 오류 한 번에 출석부가 통째로 죽지 않게 접는다(종전 동작).
  h.replies = [{ data: null, error: { message: "timeout" } }];
  expect(await getAttendanceSalaryRates(teacherId, MONTH)).toBeNull();
  spy.mockRestore();
});

// 원장 2026-10-07 — '합계 및 실급여 보여주기'는 선생님별 스위치(0352a)다. 켜면 관리자 화면과 선생님 본인 화면 둘 다.
describe("합계 및 실급여 보여주기 — 관리자 화면", () => {
  it("비율은 늘 받고(비율 설정 창의 재료) 스위치 상태를 함께 싣는다 — 줄이 없으면 꺼짐", async () => {
    h.replies = [freelancer, savedRates];
    expect(await getAttendanceSalaryRates(teacherId, MONTH)).toMatchObject({ teacherId, rates, manage: true, canEdit: true, visible: false });
    h.replies = [freelancer, savedRates];
    h.visible = { data: { visible: true }, error: null };
    expect(await getAttendanceSalaryRates(teacherId, MONTH)).toMatchObject({ manage: true, visible: true });
  });
  it("🔴 스위치 표는 지점·선생님으로 좁혀 읽는다(서버 전용 표 — RLS가 대신 걸러 주지 않는다)", async () => {
    h.replies = [freelancer, savedRates];
    await getAttendanceSalaryRates(teacherId, MONTH);
    expect(h.viewFilters).toEqual([{ tenant_id: "tenant", teacher_id: teacherId, period: MONTH }]);
    // 🔴 달마다 따로 읽는다 — 10월 출석부는 10월 줄을 본다(9월에 켰다고 10월에 보이지 않는다).
    h.viewFilters = []; h.replies = [freelancer, savedRates];
    await getAttendanceSalaryRates(teacherId, "2026-10");
    expect(h.viewFilters).toEqual([{ tenant_id: "tenant", teacher_id: teacherId, period: "2026-10" }]);
  });
  it("읽기만 되는 권한자 — 화면은 서되(버튼은 상태만) 고칠 수 없고, 저장은 거절된다", async () => {
    h.manage.mockResolvedValue(false); // 쓰기 수준은 없다
    h.read.mockResolvedValue(true);
    h.replies = [freelancer, savedRates];
    expect(await getAttendanceSalaryRates(teacherId, MONTH)).toMatchObject({ manage: true, canEdit: false, visible: false });
    expect((await saveAttendanceSalaryVisible({ teacherId, month: MONTH, visible: true })).ok).toBe(false);
    expect(h.writes).toEqual([]);
  });
  it("🔴 스위치 표를 못 읽어도(SQL 적용 전·일시 오류) 화면은 산다 — 꺼진 것으로 읽는다", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    h.replies = [freelancer, savedRates];
    h.visible = { data: null, error: { message: "Could not find the table" } };
    expect(await getAttendanceSalaryRates(teacherId, MONTH)).toMatchObject({ rates, manage: true, visible: false });
    spy.mockRestore();
  });
});

describe("합계 및 실급여 보여주기 — 선생님 본인 화면", () => {
  const asTeacher = () => {
    h.access.mockResolvedValue({ id: teacherId, tenantId: "tenant", systemRole: "teacher" });
    h.effective.mockResolvedValue(teacherId);
  };
  it("스위치가 켜져 있으면 제 출석부의 실급여 재료를 받는다 — 비율 설정·스위치 버튼은 없다(manage false)", async () => {
    asTeacher();
    h.visible = { data: { visible: true }, error: null };
    h.replies = [freelancer, savedRates];
    expect(await getAttendanceSalaryRates(teacherId, MONTH)).toEqual({ teacherId, rates, updatedAt: "2026-09-21", manage: false, canEdit: false, visible: true });
  });
  it("🔴 꺼져 있으면 비율·급여를 읽지도 않는다 — 스위치 표 한 번만 본다", async () => {
    asTeacher();
    expect(await getAttendanceSalaryRates(teacherId, MONTH)).toBeNull();
    h.visible = { data: { visible: false }, error: null };
    expect(await getAttendanceSalaryRates(teacherId, MONTH)).toBeNull();
    expect(new Set(h.tables)).toEqual(new Set([VIEW_TABLE]));
  });
  it("🔴 남의 출석부(강사 화면의 주인이 아님)는 스위치가 켜져 있어도 못 받는다 — 표를 읽지도 않는다", async () => {
    asTeacher();
    h.visible = { data: { visible: true }, error: null };
    expect(await getAttendanceSalaryRates(otherId, MONTH)).toBeNull();
    h.effective.mockResolvedValue(null); // 강사 화면이 아닌 요청
    expect(await getAttendanceSalaryRates(teacherId, MONTH)).toBeNull();
    expect(h.from).not.toHaveBeenCalled();
  });
  it("🔴 달 형식이 아니면 표를 읽지도 않고 없다", async () => {
    asTeacher();
    h.visible = { data: { visible: true }, error: null };
    expect(await getAttendanceSalaryRates(teacherId, "2026-9")).toBeNull();
    expect(h.from).not.toHaveBeenCalled();
  });
  it("급여 기능이 꺼진 학원이면 스위치와 무관하게 없다", async () => {
    asTeacher();
    h.disabled = ["payroll"];
    h.visible = { data: { visible: true }, error: null };
    expect(await getAttendanceSalaryRates(teacherId, MONTH)).toBeNull();
    expect(h.from).not.toHaveBeenCalled();
  });
  it("🔴 조회가 실패해도 던지지 않는다 — 선생님이 매일 여는 화면이라 실급여 열만 비운다", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    asTeacher();
    h.visible = { data: null, error: { message: "timeout" } };
    expect(await getAttendanceSalaryRates(teacherId, MONTH)).toBeNull();
    h.visible = { data: { visible: true }, error: null };
    h.replies = [freelancer, { data: null, error: { message: "timeout" } }]; // 비율 표 조회 실패 — 공용 로더는 던진다
    expect(await getAttendanceSalaryRates(teacherId, MONTH)).toBeNull();
    h.replies = [freelancer, { data: { rates: "깨진 값", updated_at: "2026-09-21" }, error: null }];
    expect(await getAttendanceSalaryRates(teacherId, MONTH)).toBeNull();
    spy.mockRestore();
  });
  it("겸직(관리자 계열 계정의 강사 화면) — 급여 권한이 없어도 **본인** 출석부는 스위치를 따른다", async () => {
    h.access.mockResolvedValue({ id: teacherId, tenantId: "tenant", systemRole: "counselor" });
    h.effective.mockResolvedValue(teacherId);
    h.visible = { data: { visible: true }, error: null };
    h.replies = [freelancer, savedRates];
    expect(await getAttendanceSalaryRates(teacherId, MONTH)).toMatchObject({ rates, manage: false, canEdit: false, visible: true });
    // 강사 화면이 아니면(관리자 화면에서 본인을 고름) 급여 권한이 없으니 없다.
    h.effective.mockResolvedValue(null);
    expect(await getAttendanceSalaryRates(teacherId, MONTH)).toBeNull();
  });
  it("프리랜서가 아니면 스위치가 켜져 있어도 없다(실급여 열은 프리랜서에게만 있다)", async () => {
    asTeacher();
    h.visible = { data: { visible: true }, error: null };
    h.replies = [{ data: { employment_type: "정규직" }, error: null }];
    expect(await getAttendanceSalaryRates(teacherId, MONTH)).toBeNull();
  });
});

describe("합계 및 실급여 보여주기 — 다른 강사 뷰(열람 전용)", () => {
  const viewAs = (systemRole: SystemRole) => {
    h.access.mockResolvedValue({ id: "viewer", tenantId: "tenant", systemRole });
    h.scope.mockResolvedValue(true);
    h.effective.mockResolvedValue(teacherId);
    h.visible = { data: { visible: true }, error: null };
    h.replies = [freelancer, savedRates];
  };
  it("급여 비율 설정 권한이 있는 사람은 그 선생님이 보는 그대로 본다 — 버튼은 없다", async () => {
    viewAs("master");
    expect(await getAttendanceSalaryRates(teacherId, MONTH)).toMatchObject({ rates, manage: false, canEdit: false, visible: true });
  });
  it("🔴 뷰 자격만 있고 급여 권한이 없으면 남의 실급여가 열리지 않는다", async () => {
    viewAs("counselor");
    expect(await getAttendanceSalaryRates(teacherId, MONTH)).toBeNull();
    expect(h.from).not.toHaveBeenCalled();
  });
  it("스위치가 꺼져 있으면 급여 권한이 있어도 그 선생님이 보는 그대로 — 없다", async () => {
    viewAs("master");
    h.visible = { data: { visible: false }, error: null };
    expect(await getAttendanceSalaryRates(teacherId, MONTH)).toBeNull();
    expect(new Set(h.tables)).toEqual(new Set(["attendance_salary_teacher_view"]));
  });
  it("스위치는 못 바꾼다(열람 전용)", async () => {
    viewAs("master");
    expect((await saveAttendanceSalaryVisible({ teacherId, month: MONTH, visible: false })).ok).toBe(false);
    expect(h.writes).toEqual([]);
  });
});

describe("합계 및 실급여 보여주기 — 저장", () => {
  it("급여 비율을 고칠 수 있는 사람이 프리랜서 선생님 한 명의 스위치를 바꾸고 감사로그를 남긴다(금액 없음)", async () => {
    h.replies = [freelancer];
    expect(await saveAttendanceSalaryVisible({ teacherId, month: MONTH, visible: true })).toEqual({ ok: true });
    expect(h.writes).toEqual([expect.objectContaining({ tenant_id: "tenant", teacher_id: teacherId, period: MONTH, visible: true, updated_by: "admin" })]);
    // 🔴 충돌 키는 지점 · 선생님 · **달** — 달이 빠지면 다른 달 줄을 덮는다(9월을 켜면 10월 줄이 바뀐다).
    expect(h.writeOptions).toEqual([{ onConflict: "tenant_id,teacher_id,period" }]);
    expect(h.log).toHaveBeenCalledWith({ action: "payroll_sheet_visible_set", targetType: "user", targetLabel: "김강사", metadata: { userId: teacherId, period: MONTH, visible: true } });
  });
  it.each(["teacher", "accountant", "viewer"])("%s 계정은 못 바꾼다 — 선생님이 스스로 켤 수 없다", async (systemRole) => {
    h.access.mockResolvedValue({ id: teacherId, tenantId: "tenant", systemRole });
    h.effective.mockResolvedValue(teacherId);
    expect((await saveAttendanceSalaryVisible({ teacherId, month: MONTH, visible: true })).ok).toBe(false);
    expect(h.from).not.toHaveBeenCalled();
    expect(h.log).not.toHaveBeenCalled();
  });
  it("프리랜서가 아닌 사람·잘못된 입력은 저장하지 않는다", async () => {
    h.replies = [{ data: { employment_type: "정규직", display_name: "박직원" }, error: null }];
    expect((await saveAttendanceSalaryVisible({ teacherId, month: MONTH, visible: true })).ok).toBe(false);
    expect((await saveAttendanceSalaryVisible({ teacherId: "x", month: MONTH, visible: true })).ok).toBe(false);
    expect((await saveAttendanceSalaryVisible({ teacherId, month: MONTH, visible: "yes" as unknown as boolean })).ok).toBe(false);
    // 달이 없거나 형식이 아니면 저장하지 않는다 — 달 없는 줄은 어느 달의 것도 아니다.
    expect((await saveAttendanceSalaryVisible({ teacherId, month: "2026-13", visible: true })).ok).toBe(false);
    expect((await saveAttendanceSalaryVisible({ teacherId, month: "" as string, visible: true })).ok).toBe(false);
    expect(h.writes).toEqual([]);
    expect(h.log).not.toHaveBeenCalled();
  });
  it("🔴 선생님 조회 실패를 '프리랜서가 아니다'로 말하지 않는다", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    h.replies = [{ data: null, error: { message: "timeout" } }];
    const result = await saveAttendanceSalaryVisible({ teacherId, month: MONTH, visible: true });
    expect(result.ok).toBe(false);
    expect(result.error).not.toContain("프리랜서");
    expect(result.error).toMatch(/[가-힣]/);
    expect(h.writes).toEqual([]);
    spy.mockRestore(); warn.mockRestore();
  });
  it("달별 저장으로 바꾸는 사이(옛 키에 걸림) — '이미 저장돼 있다'가 아니라 잠시 뒤 다시 누르라고 말한다", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    h.replies = [freelancer];
    h.visibleWrite = { error: { code: "23505", message: 'duplicate key value violates unique constraint "attendance_salary_teacher_view_pkey"' } };
    const result = await saveAttendanceSalaryVisible({ teacherId, month: "2026-10", visible: true });
    expect(result).toEqual({ ok: false, error: "설정을 바꾸는 중입니다. 잠시 후 다시 눌러 주세요" });
    spy.mockRestore(); warn.mockRestore();
  });
  it("저장이 실패하면 한글 안내를 돌려주고 감사로그는 남기지 않는다", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    h.replies = [freelancer];
    h.visibleWrite = { error: { code: "PGRST205", message: "Could not find the table 'public.attendance_salary_teacher_view' in the schema cache" } };
    const result = await saveAttendanceSalaryVisible({ teacherId, month: MONTH, visible: true });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/[가-힣]/);
    expect(result.error).not.toContain("attendance_salary_teacher_view");
    expect(h.log).not.toHaveBeenCalled();
    spy.mockRestore(); warn.mockRestore();
  });
});
