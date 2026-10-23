import { describe, expect, it, vi } from "vitest";
import { createMemoSaver, type SaverDeps, type SaverStatus } from "./memo-saver";
import type { CellMemo } from "./rules";

const memo = (over: Partial<CellMemo> = {}): CellMemo => ({
  id: "m1", date: "2026-10-22", col: "김태건", startMin: 980, body: "처음", width: null, height: null,
  version: 1, updatedAt: "2026-10-22T09:40:00.000Z", updatedByName: "박소선", ...over,
});

/** 타이머를 손으로 돌리는 저장기 — 서버 액션 자리엔 기록하는 가짜. */
function rig(initial: CellMemo | null, over: Partial<SaverDeps> = {}) {
  const timers: (() => void)[] = [];
  const statuses: SaverStatus[] = [];
  const saves: { id: string | null; baseVersion: number; body: string }[] = [];
  const removes: { id: string; baseVersion: number }[] = [];
  const conflicts: { latest: CellMemo | null; mine: string; staleId: string | null }[] = [];
  let version = initial?.version ?? 0;
  const deps: SaverDeps = {
    save: vi.fn(async (a) => {
      saves.push(a);
      version += 1;
      return { ok: true as const, memo: memo({ id: a.id ?? "new", body: a.body, version }) };
    }),
    remove: vi.fn(async (a) => {
      removes.push(a);
      return { ok: true as const };
    }),
    onStatus: (s) => statuses.push(s),
    onSaved: vi.fn(),
    onRemoved: vi.fn(),
    onConflict: (latest, mine, staleId) => conflicts.push({ latest, mine, staleId }),
    setTimer: (fn) => timers.push(fn),
    clearTimer: () => timers.splice(0),
    ...over,
  };
  const saver = createMemoSaver(initial, deps);
  const tick = async () => {
    for (const fn of timers.splice(0)) fn();
    await new Promise((r) => setTimeout(r, 0));
  };
  return { saver, deps, timers, statuses, saves, removes, conflicts, tick };
}

describe("칸 메모 자동 저장 — 입력하는 대로(저장 단추 없음)", () => {
  it("잠깐 멈추면 한 번 보낸다 — 새 메모는 version 0으로 만들고, 다음은 돌려받은 version으로", async () => {
    const r = rig(null);
    r.saver.change("가");
    r.saver.change("가나");
    expect(r.saves).toHaveLength(0);
    await r.tick();
    expect(r.saves).toEqual([{ id: null, baseVersion: 0, body: "가나" }]);
    r.saver.change("가나다");
    await r.tick();
    expect(r.saves[1]).toEqual({ id: "new", baseVersion: 1, body: "가나다" });
  });

  it("🔴 저장 중에 또 고치면 겹쳐 보내지 않고, 끝난 뒤 앞 요청의 version으로 한 번 더", async () => {
    let release!: () => void;
    const gate = new Promise<void>((res) => (release = res));
    const r = rig(memo(), {
      save: vi.fn(async (a) => {
        await gate;
        return { ok: true as const, memo: memo({ body: a.body, version: a.baseVersion + 1 }) };
      }),
    });
    r.saver.change("하나");
    const first = r.saver.flush();
    r.saver.change("하나둘");
    void r.saver.flush();
    expect(r.deps.save).toHaveBeenCalledTimes(1);
    release();
    await first;
    expect(r.deps.save).toHaveBeenCalledTimes(2);
    expect((r.deps.save as ReturnType<typeof vi.fn>).mock.calls[1]![0]).toEqual({ id: "m1", baseVersion: 2, body: "하나둘" });
  });

  it("🔴 비운 메모는 입력 중엔 지우지 않고, 닫을 때(final) 지운다", async () => {
    const r = rig(memo());
    r.saver.change("");
    await r.tick();
    expect(r.removes).toHaveLength(0);
    expect(r.saver.isBusy()).toBe(true);
    await r.saver.flush(true);
    expect(r.removes).toEqual([{ id: "m1", baseVersion: 1 }]);
    expect(r.deps.onRemoved).toHaveBeenCalledWith("m1");
    expect(r.saver.current()).toEqual({ id: null, version: 0 });
  });

  it("고친 게 없으면 닫아도 아무것도 안 보낸다", async () => {
    const r = rig(memo());
    await r.saver.flush(true);
    expect(r.deps.save).not.toHaveBeenCalled();
    expect(r.deps.remove).not.toHaveBeenCalled();
  });
});

describe("🔴 동시 저장 — 늦게 저장한 쪽이 앞 저장을 조용히 덮지 않는다", () => {
  it("version이 다르면 최신을 받아들이고 내 글은 돌려준다 · 이어서 더 보내지 않는다", async () => {
    const theirs = memo({ body: "남이 쓴 글", version: 3, updatedByName: "김태건" });
    const r = rig(memo(), { save: vi.fn(async () => ({ ok: false as const, conflict: true as const, latest: theirs })) });
    r.saver.change("내 글");
    await r.saver.flush(true);
    expect(r.conflicts).toEqual([{ latest: theirs, mine: "내 글", staleId: "m1" }]);
    expect(r.saver.current()).toEqual({ id: "m1", version: 3 });
    expect(r.deps.save).toHaveBeenCalledTimes(1);
    expect(r.saver.isBusy()).toBe(false);
  });

  it("'내가 쓴 글로 덮어쓰기' = 받아 둔 최신 version 위에 다시 저장", async () => {
    const theirs = memo({ body: "남이 쓴 글", version: 3 });
    const save = vi
      .fn<SaverDeps["save"]>()
      .mockResolvedValueOnce({ ok: false, conflict: true, latest: theirs })
      .mockResolvedValueOnce({ ok: true, memo: memo({ body: "내 글", version: 4 }) });
    const r = rig(memo(), { save });
    r.saver.change("내 글");
    await r.saver.flush();
    r.saver.change("내 글");
    await r.tick();
    expect(save.mock.calls[1]![0]).toEqual({ id: "m1", baseVersion: 3, body: "내 글" });
  });

  it("다른 사람이 지웠으면(최신 없음) 새 메모로 다시 만들 수 있다", async () => {
    const save = vi
      .fn<SaverDeps["save"]>()
      .mockResolvedValueOnce({ ok: false, conflict: true, latest: null })
      .mockResolvedValueOnce({ ok: true, memo: memo({ id: "m2", body: "다시", version: 1 }) });
    const r = rig(memo(), { save });
    r.saver.change("고침");
    await r.saver.flush();
    expect(r.conflicts[0]!.latest).toBeNull();
    r.saver.change("다시");
    await r.tick();
    expect(save.mock.calls[1]![0]).toEqual({ id: null, baseVersion: 0, body: "다시" });
  });

  it("다른 화면의 최신은 내가 고치던 게 없을 때만 받아들인다", () => {
    const r = rig(memo());
    expect(r.saver.adoptIfClean(memo({ body: "새것", version: 2 }))).toBe(true);
    expect(r.saver.current().version).toBe(2);
    r.saver.change("고치는 중");
    expect(r.saver.adoptIfClean(memo({ body: "더 새것", version: 3 }))).toBe(false);
  });

  it("서버 오류는 멈추고 알린다(다음 입력·다시 저장으로 이어 간다)", async () => {
    const r = rig(memo(), { save: vi.fn(async () => ({ ok: false as const, error: "메모를 고칠 권한이 없습니다" })) });
    r.saver.change("x");
    await r.saver.flush();
    expect(r.statuses.at(-1)).toEqual({ kind: "error", message: "메모를 고칠 권한이 없습니다" });
    expect(r.saver.isBusy()).toBe(true);
  });
});
