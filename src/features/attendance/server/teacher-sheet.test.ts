/**
 * 프리랜서 명세서가 쓰는 **출석부 조립**(`loadTeacherSheet`)의 행동 — 금액으로 쓸 수 없는 재료를 만나면 멈추는가.
 *
 * 🔴 화면은 조회가 일부 실패해도 표를 살리려고 접는다. 같은 조립이 금액이 되면 접힌 재료가 곧 틀린 금액이라,
 *    접은 쪽이 남긴 표식(`folded-read.ts` · 매트릭스 `degraded` · 청구 `degraded`)을 **전부** 확인해야 한다.
 *    문자열 가드(`teacher-sheet-wiring.test.ts`)는 호출 모양만 잠그므로 누락은 여기서 잡는다(재리뷰 2026-10-06).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { markFolded } from "@/lib/folded-read";

const h = vi.hoisted(() => ({
  lens: vi.fn(),
  settings: vi.fn(),
  since: vi.fn(),
  taughtBy: vi.fn(),
  matrix: vi.fn(),
  billing: vi.fn(),
  pool: vi.fn(),
}));
vi.mock("server-only", () => ({}));
// 요청 캐시는 이 테스트의 축이 아니다 — 호출마다 그대로 돈다(서버 액션 안과 같은 조건).
vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), cache: <T,>(fn: T) => fn }));
vi.mock("@/lib/auth/view-mode", () => ({ effectiveTeacherId: h.lens }));
vi.mock("@/features/owner/server/queries", () => ({ getTenantSettings: h.settings }));
vi.mock("@/features/classes/server/teacher-as-of-queries", () => ({ getHomeroomSinceIndex: h.since }));
vi.mock("./taught-by-db", () => ({ taughtByColumnState: h.taughtBy }));
vi.mock("./queries", () => ({ getMonthlyAttendanceMatrix: h.matrix }));
vi.mock("./makeup-pool", () => ({ findMakeupPoolClass: h.pool }));
vi.mock("./class-billing", () => ({
  getAttendanceClassBilledAmounts: h.billing,
  mergeAttendanceClassBilling: (a: { degraded?: string[] }, b: { degraded?: string[] }) => ({
    ...a,
    ...(a.degraded || b.degraded ? { degraded: [...(a.degraded ?? []), ...(b.degraded ?? [])] } : {}),
  }),
}));

import { TeacherSheetError } from "../teacher-sheet-error";
import { loadTeacherSheet } from "./teacher-sheet";

const T = "teacher-1";
const POOL = "pool-1";
const CLASSES = [
  { id: "c1", className: "중등E A", subject: "english", isSpecial: false, teacherId: T, teacherName: "가", teacherActive: true, slotTeachers: [] },
  { id: "c2", className: "남의 반", subject: "english", isSpecial: false, teacherId: "other", teacherName: "나", teacherActive: true, slotTeachers: [] },
];
const settings = () => ({ operations: { subjects: [{ key: "english", label: "영어" }], holidays: [] }, modules: { disabled: [] } });
const emptyBilling = () => ({ billed: {}, confirmedSessions: {}, confirmedPrices: {}, priceConfirmed: [], carryMarks: {} });

/** 매트릭스 응답 — 호출 인자(반 id)로 갈라 준다. `over`로 특정 호출만 접힌 재료를 싣는다. */
function matrices(over: Partial<Record<"base" | "c1" | typeof POOL, { degraded?: string[]; students?: { id: string }[] }>> = {}) {
  h.matrix.mockImplementation(async (_month: string, classId: string | null) => {
    const key = classId ?? "base";
    const students = over[key as "base"]?.students ?? (classId ? [{ id: "s1", name: "학생", grade: "중2" }] : []);
    return { classes: CLASSES, students, marks: {}, units: {}, ...(over[key as "base"]?.degraded ? { degraded: over[key as "base"]!.degraded } : {}) };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  h.lens.mockResolvedValue(null);
  h.settings.mockResolvedValue(settings());
  h.since.mockResolvedValue({ byClassTeacher: new Map(), since: "2025-10-01" });
  h.taughtBy.mockResolvedValue("ready");
  h.pool.mockResolvedValue(null);
  h.billing.mockResolvedValue(emptyBilling());
  matrices();
});

const load = () => loadTeacherSheet("tenant", T, "2026-09");
async function reasonOf(): Promise<string> {
  try {
    await load();
  } catch (e) {
    expect(e).toBeInstanceOf(TeacherSheetError);
    return (e as Error).message;
  }
  throw new Error("산정을 멈추지 않았다");
}

describe("출석부 조립 — 정상 경로", () => {
  it("그 강사가 가르치는 반만 서고(남의 반 제외) 화면과 같은 인자로 매트릭스를 부른다", async () => {
    const sheet = await load();
    expect(sheet.groups.map((g) => g.classId)).toEqual(["c1"]);
    expect(sheet.sessionBillingOn).toBe(true);
    expect(sheet.unitSuffix).toBe("U");
    expect(h.matrix).toHaveBeenCalledWith("2026-09", "c1", "month", T, null);
    expect(h.matrix).not.toHaveBeenCalledWith("2026-09", "c2", "month", T, null);
  });

  it("보는 사람의 강사 렌즈가 대상과 같으면 통과한다(반 집합이 같다)", async () => {
    h.lens.mockResolvedValue(T);
    await expect(load()).resolves.toMatchObject({ groups: [{ classId: "c1" }] });
  });

  it("보강 반 묶음은 명단이 있을 때만 붙는다", async () => {
    h.pool.mockResolvedValue(POOL);
    const sheet = await load();
    expect(sheet.groups.map((g) => [g.classId, g.makeupPool])).toEqual([["c1", false], [POOL, true]]);
    expect(h.pool).toHaveBeenCalledWith("tenant", T, { strict: true });
  });
});

describe("🔴 금액으로 쓸 수 없는 재료 — 티어로 떨어뜨리지도, 접힌 채 계산하지도 않고 멈춘다", () => {
  it("보는 사람이 다른 강사의 보기로 들어와 있다 — 조회 전에 멈춘다", async () => {
    h.lens.mockResolvedValue("someone-else");
    expect(await reasonOf()).toContain("강사뷰 상태에서는 다른 선생님의 출석부 금액을 계산할 수 없습니다");
    expect(h.matrix).not.toHaveBeenCalled();
  });

  it("담임 변경 기록(머리 확인) · 대신 보강 귀속 확인 실패", async () => {
    h.since.mockResolvedValue({ byClassTeacher: new Map(), since: "2025-10-01", incomplete: true });
    expect(await reasonOf()).toContain("담임 변경 기록을 읽지 못해");
    h.since.mockResolvedValue({ byClassTeacher: new Map(), since: "2025-10-01" });
    h.taughtBy.mockResolvedValue("unknown");
    expect(await reasonOf()).toContain("대신 보강 기록을 확인하지 못해");
    // 칸이 없다고 **확인된** 학원(0316a 미적용)은 멈추지 않는다 — 귀속이 애초에 없다.
    h.taughtBy.mockResolvedValue("missing");
    await expect(load()).resolves.toBeTruthy();
  });

  it("학원 설정을 못 읽어 기본값으로 접혔다 — 휴일 0개·과목·기능 스위치가 기본값인 채 금액이 되지 않는다", async () => {
    h.settings.mockResolvedValue(markFolded(settings(), "학원 설정을 읽지 못했습니다"));
    expect(await reasonOf()).toBe("학원 설정을 읽지 못했습니다 — 수업료를 산정하지 않았습니다. 잠시 후 다시 열어 주세요.");
  });

  it("반 목록(기본 매트릭스)이 담임 이력 없이 만들어졌다", async () => {
    matrices({ base: { degraded: ["담임 변경 기록을 읽지 못했습니다"] } });
    expect(await reasonOf()).toContain("담임 변경 기록을 읽지 못했습니다 — 수업료를 산정하지 않았습니다.");
  });

  it("🔴 머리 확인은 통과했는데 **그 반의 매트릭스만** 이력·설정을 접었다 — 서버 액션(발행)에선 조회가 반마다 따로 돈다", async () => {
    matrices({ c1: { degraded: ["담임 변경 기록을 읽지 못했습니다", "학원 설정을 읽지 못했습니다"] } });
    expect(await reasonOf()).toBe("담임 변경 기록을 읽지 못했습니다 · 학원 설정을 읽지 못했습니다 — 수업료를 산정하지 않았습니다. 잠시 후 다시 열어 주세요.");
  });

  it("보강 반 — 못 읽음 · 그 매트릭스가 접힘(명단이 0명이어도)", async () => {
    h.pool.mockRejectedValue(new Error("timeout"));
    expect(await reasonOf()).toContain("보강 반을 읽지 못해");
    h.pool.mockResolvedValue(POOL);
    matrices({ [POOL]: { degraded: ["담임 변경 기록을 읽지 못했습니다"], students: [] } });
    expect(await reasonOf()).toContain("담임 변경 기록을 읽지 못했습니다");
  });

  it("청구 조회가 접은 재료(금액 이월 · 보강 반 청구) — 사유는 한 번씩만 적는다", async () => {
    h.pool.mockResolvedValue(POOL);
    h.billing.mockResolvedValue({ ...emptyBilling(), degraded: ["금액 이월 내역을 읽지 못했습니다"] });
    expect(await reasonOf()).toBe("금액 이월 내역을 읽지 못했습니다 — 수업료를 산정하지 않았습니다. 잠시 후 다시 열어 주세요.");
  });

  it("예상 밖 오류는 사유로 바꾸지 않는다 — 그대로 던진다(호출부가 오류 화면으로 보낸다)", async () => {
    h.matrix.mockRejectedValue(new Error("boom"));
    await expect(load()).rejects.toThrow("boom");
    await expect(load()).rejects.not.toBeInstanceOf(TeacherSheetError);
  });
});
