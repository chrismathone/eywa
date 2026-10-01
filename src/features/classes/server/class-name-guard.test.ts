import { beforeEach, describe, expect, it, vi } from "vitest";
import { logAction } from "@/features/audit/server/log";
import { rollbackFreedClassName, writeWithClassNameGuard } from "./class-name-guard";
import { byId, fakeClassesDb, type FakeClassRow } from "./fake-classes-db.test-support";

vi.mock("@/features/audit/server/log", () => ({ logAction: vi.fn() }));

const TODAY = "2026-10-01";
const A = "tenant-a";
const row = (p: Partial<FakeClassRow> & { id: string; class_name: string }): FakeClassRow => ({
  tenant_id: A,
  subject: "english",
  is_active: true,
  closed_at: null,
  ...p,
});

/** 침산 실제 사례 모양 — PL4를 PL5로 바꾸려는데 7/2 종강·폐지된 PL5가 이름을 쥐고 있다. */
function seed(extra: FakeClassRow[] = []) {
  return fakeClassesDb([
    row({ id: "pl4", class_name: "PL4" }),
    row({ id: "old-pl5", class_name: "PL5", is_active: false, closed_at: "2026-07-02" }),
    ...extra,
  ]);
}

type Db = ReturnType<typeof fakeClassesDb>;
const asDb = (db: Db) => db as unknown as Parameters<typeof writeWithClassNameGuard>[0]["db"];

/** 반 수정과 같은 모양 — 대상 반의 이름을 바꾼다. */
function rename(db: Db, opts: { name?: string; request?: { name: string; holderId: string; to: string } | null; canFree?: boolean; write?: () => Promise<{ data: boolean; error: unknown }> } = {}) {
  const name = opts.name ?? "PL5";
  return writeWithClassNameGuard({
    db: asDb(db),
    target: { tenantId: A, subject: "english", name, excludeId: "pl4" },
    today: TODAY,
    request: opts.request ?? null,
    canFree: async () => opts.canFree ?? true,
    write:
      opts.write ??
      (async () => {
        const { error } = await db.from("classes").update({ class_name: name }).eq("id", "pl4");
        return { data: true, error };
      }),
    savedClassId: () => "pl4",
    failMessage: "저장 실패",
  });
}

const REQUEST = { name: "PL5", holderId: "old-pl5", to: "PL5 (~26.07.02)" };

beforeEach(() => vi.mocked(logAction).mockClear());

describe("반 이름 충돌 가드 — 버튼 없이는 남의 반을 건드리지 않는다", () => {
  it("겹치는 반이 없으면 그냥 저장한다(비우기·감사로그 없음)", async () => {
    const db = seed();
    const r = await rename(db, { name: "PL6" });
    expect(r).toMatchObject({ ok: true, freed: null });
    expect(byId(db, "pl4").class_name).toBe("PL6");
    expect(logAction).not.toHaveBeenCalled();
  });

  it("종강·폐지 반이 쥔 이름 → 저장하지 않고 상태·버튼용 새 이름을 돌려준다(그 반은 그대로)", async () => {
    const db = seed();
    const r = await rename(db);
    expect(r).toEqual({
      ok: false,
      conflict: {
        name: "PL5",
        status: "closed",
        message: "같은 과목에 중복되는 반 이름이 있습니다. (종강 처리된 반)",
        holderId: "old-pl5",
        freeTo: "PL5 (~26.07.02)",
        allowFree: true,
      },
    });
    expect(byId(db, "old-pl5").class_name).toBe("PL5");
    expect(byId(db, "pl4").class_name).toBe("PL4");
    expect(logAction).not.toHaveBeenCalled();
  });

  it("운영 중인 반과 겹치면 문구만(버튼 없음) — 위조한 비우기 요청도 무시한다", async () => {
    const db = fakeClassesDb([row({ id: "pl4", class_name: "PL4" }), row({ id: "live", class_name: "PL5" })]);
    const r = await rename(db, { request: { name: "PL5", holderId: "live", to: "PL5 (~종강)" } });
    expect(r).toMatchObject({ ok: false, conflict: { status: "operating", freeTo: null, message: expect.stringContaining("운영 중인 반") } });
    expect(byId(db, "live").class_name).toBe("PL5");
    expect(byId(db, "pl4").class_name).toBe("PL4");
  });

  it("남의 반 이름을 바꿀 권한이 없으면(강사) 버튼용 이름을 안 주고 요청도 무시한다", async () => {
    const db = seed();
    const r = await rename(db, { canFree: false, request: REQUEST });
    expect(r).toMatchObject({ ok: false, conflict: { status: "closed", freeTo: null, allowFree: false } });
    expect(byId(db, "old-pl5").class_name).toBe("PL5");
  });

  it("종강일이 없는 폐지 반은 '폐지된 반'·'(~종강)'", async () => {
    const db = fakeClassesDb([row({ id: "pl4", class_name: "PL4" }), row({ id: "gone", class_name: "PL5", is_active: false })]);
    expect(await rename(db)).toMatchObject({ ok: false, conflict: { status: "archived", freeTo: "PL5 (~종강)" } });
  });
});

describe("반 이름 충돌 가드 — 버튼을 누른 요청", () => {
  it("그 반 이름을 접미사로 비우고 저장한다 + 비운 반을 대상으로 감사로그", async () => {
    const db = seed();
    const r = await rename(db, { request: REQUEST });
    expect(r).toMatchObject({ ok: true, freed: { id: "old-pl5", from: "PL5", to: "PL5 (~26.07.02)", status: "closed" } });
    expect(byId(db, "old-pl5").class_name).toBe("PL5 (~26.07.02)");
    expect(byId(db, "pl4").class_name).toBe("PL5");
    expect(logAction).toHaveBeenCalledTimes(1);
    expect(logAction).toHaveBeenCalledWith({
      action: "class_update",
      targetType: "class",
      targetLabel: "PL5 (~26.07.02)",
      metadata: expect.objectContaining({
        classId: "old-pl5",
        changed: ["반 이름"],
        changes: [{ field: "반 이름", from: "PL5", to: "PL5 (~26.07.02)" }],
        note: expect.stringContaining("종강 처리된 반이 쥔 이름을 비움"),
        freedForClassId: "pl4",
      }),
    });
  });

  it("접미사 이름까지 있으면 ' 2'를 붙여 겹치지 않게", async () => {
    const db = seed([row({ id: "older", class_name: "PL5 (~26.07.02)", is_active: false, closed_at: "2026-07-01" })]);
    const first = await rename(db);
    expect(first).toMatchObject({ ok: false, conflict: { freeTo: "PL5 (~26.07.02) 2" } });
    const r = await rename(db, { request: { ...REQUEST, to: "PL5 (~26.07.02) 2" } });
    expect(r).toMatchObject({ ok: true });
    expect(byId(db, "old-pl5").class_name).toBe("PL5 (~26.07.02) 2");
    expect(byId(db, "older").class_name).toBe("PL5 (~26.07.02)");
  });

  it("동의한 내용과 지금이 다르면(그 사이 재운영됨) 비우지 않고 다시 묻는다", async () => {
    const db = seed();
    byId(db, "old-pl5").is_active = true;
    byId(db, "old-pl5").closed_at = "2026-12-31"; // 종강 예정으로 되돌림 = 운영 중
    const r = await rename(db, { request: REQUEST });
    expect(r).toMatchObject({ ok: false, conflict: { status: "operating", freeTo: null } });
    expect(byId(db, "old-pl5").class_name).toBe("PL5");
  });

  it("버튼에 적힌 새 이름이 그새 달라졌으면 비우지 않고 새 이름으로 다시 묻는다", async () => {
    const db = seed([row({ id: "older", class_name: "PL5 (~26.07.02)", is_active: false, closed_at: "2026-07-01" })]);
    const r = await rename(db, { request: REQUEST });
    expect(r).toMatchObject({ ok: false, conflict: { freeTo: "PL5 (~26.07.02) 2" } });
    expect(byId(db, "old-pl5").class_name).toBe("PL5");
  });

  it("버튼을 누르기 전에 반 이름 칸을 고쳤으면 그 동의는 무시한다", async () => {
    const db = seed([row({ id: "x", class_name: "PL6", is_active: false, closed_at: "2026-07-01" })]);
    const r = await rename(db, { name: "PL6", request: REQUEST });
    expect(r).toMatchObject({ ok: false, conflict: { name: "PL6", holderId: "x" } });
    expect(byId(db, "old-pl5").class_name).toBe("PL5");
    expect(byId(db, "x").class_name).toBe("PL6");
  });

  it("저장이 실패하면 비운 이름을 되돌리고(감사로그 없음) 일반 실패를 돌려준다", async () => {
    const db = seed();
    const r = await rename(db, { request: REQUEST, write: async () => ({ data: true, error: { code: "08006" } }) });
    expect(r).toEqual({ ok: false, error: "저장 실패" });
    expect(byId(db, "old-pl5").class_name).toBe("PL5");
    expect(byId(db, "pl4").class_name).toBe("PL4");
    expect(logAction).not.toHaveBeenCalled();
  });

  it("그 사이 다른 반이 그 이름을 가져가 되돌리지 못하면 — 비운 사실을 감사로그에 남기고 지금 상태로 알린다", async () => {
    const db = seed([row({ id: "rival", class_name: "PL4b" })]);
    const r = await rename(db, {
      request: REQUEST,
      write: async () => {
        // 동시에 다른 사람이 rival을 PL5로 먼저 저장했다 → 내 저장은 23505.
        await db.from("classes").update({ class_name: "PL5" }).eq("id", "rival");
        const { error } = await db.from("classes").update({ class_name: "PL5" }).eq("id", "pl4");
        return { data: true, error };
      },
    });
    // 화면은 '운영 중인 반'과 겹쳤다는 것 + 비우려던 반 이름이 바뀐 채 남았다는 것을 함께 말한다.
    expect(r).toMatchObject({
      ok: false,
      conflict: { status: "operating", holderId: "rival", message: expect.stringContaining("'PL5 (~26.07.02)'(으)로 바뀐 채 남았습니다") },
    });
    expect(byId(db, "old-pl5").class_name).toBe("PL5 (~26.07.02)");
    expect(logAction).toHaveBeenCalledTimes(1);
    const meta = vi.mocked(logAction).mock.calls[0]![0].metadata!;
    expect(meta).toMatchObject({
      classId: "old-pl5",
      note: expect.stringContaining("되돌리지 못함(그사이 다른 반이 그 이름을 씀)"),
      // 이 경로에선 이 줄이 그 변경의 유일한 기록이다 — 변경 내역을 함께 남긴다.
      changes: [{ field: "반 이름", from: "PL5", to: "PL5 (~26.07.02)" }],
    });
    // 그 저장은 실패했다 — "누구를 위해 비웠나"를 지어내지 않는다.
    expect(meta).not.toHaveProperty("freedForClassId");
  });

  it("23505인데 이름을 쥔 반이 없으면(다른 유니크 제약) 일반 실패 — 지어내지 않는다", async () => {
    const db = seed();
    const r = await rename(db, { name: "PL7", write: async () => ({ data: true, error: { code: "23505" } }) });
    expect(r).toEqual({ ok: false, error: "저장 실패" });
  });
});

describe("반 이름 충돌 가드 — 다른 지점·다른 과목은 건드리지 않는다", () => {
  it("다른 지점·다른 과목의 같은 이름은 충돌이 아니다", async () => {
    const db = seed();
    byId(db, "old-pl5").class_name = "PL9";
    db.rows.push(
      row({ id: "other-tenant", tenant_id: "tenant-b", class_name: "PL5", is_active: false, closed_at: "2026-07-02" }),
      row({ id: "other-subject", subject: "math", class_name: "PL5", is_active: false, closed_at: "2026-07-02" }),
    );
    const r = await rename(db, { request: { name: "PL5", holderId: "other-tenant", to: "PL5 (~26.07.02)" } });
    expect(r).toMatchObject({ ok: true, freed: null });
    expect(byId(db, "pl4").class_name).toBe("PL5");
    expect(byId(db, "other-tenant").class_name).toBe("PL5");
    expect(byId(db, "other-subject").class_name).toBe("PL5");
  });

  it("다른 과목에 같은 접미사 이름이 있어도 이 과목 후보는 첫 이름 그대로", async () => {
    const db = seed([row({ id: "m", subject: "math", class_name: "PL5 (~26.07.02)", is_active: false })]);
    expect(await rename(db)).toMatchObject({ ok: false, conflict: { freeTo: "PL5 (~26.07.02)" } });
  });
});

describe("반 이름 충돌 가드 — 감사로그 문구", () => {
  it("화면에 그대로 나가는 사유(note)에 영문 컬럼명이 없다", async () => {
    const db = seed();
    await rename(db, { request: REQUEST });
    const note = String(vi.mocked(logAction).mock.calls[0]![0].metadata!.note);
    expect(note).not.toMatch(/[A-Za-z_]{3,}/);
  });
});

describe("반 이름 충돌 가드 — 나중에 무르기(새 반 교시 저장 실패)", () => {
  it("비운 이름을 되돌리고 되돌린 것도 감사로그에 남긴다", async () => {
    const db = seed();
    byId(db, "old-pl5").class_name = "PL5 (~26.07.02)";
    const ok = await rollbackFreedClassName(
      asDb(db),
      { tenantId: A, subject: "english", name: "PL5" },
      { id: "old-pl5", from: "PL5", to: "PL5 (~26.07.02)", status: "closed" },
    );
    expect(ok).toBe(true);
    expect(byId(db, "old-pl5").class_name).toBe("PL5");
    expect(logAction).toHaveBeenCalledWith(
      expect.objectContaining({
        targetLabel: "PL5",
        metadata: expect.objectContaining({ changes: [{ field: "반 이름", from: "PL5 (~26.07.02)", to: "PL5" }] }),
      }),
    );
  });

  it("되돌리지 못하면 사유만 남긴다 — '비움' 로그가 이미 있어 이름 변경을 두 번 찍지 않는다", async () => {
    const db = seed([row({ id: "taker", class_name: "PL5" })]); // 그사이 다른 반이 PL5를 가져갔다
    byId(db, "old-pl5").class_name = "PL5 (~26.07.02)";
    const ok = await rollbackFreedClassName(
      asDb(db),
      { tenantId: A, subject: "english", name: "PL5" },
      { id: "old-pl5", from: "PL5", to: "PL5 (~26.07.02)", status: "closed" },
    );
    expect(ok).toBe(false);
    expect(byId(db, "old-pl5").class_name).toBe("PL5 (~26.07.02)");
    const meta = vi.mocked(logAction).mock.calls[0]![0].metadata!;
    expect(meta).toMatchObject({ classId: "old-pl5", changes: [], changed: [], note: expect.stringContaining("되돌리지 못함") });
  });
});
