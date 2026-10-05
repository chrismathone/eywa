import { beforeEach, describe, expect, it, vi } from "vitest";

const DATE = "2026-10-05";

const m = vi.hoisted(() => {
  const state = {
    mode: "on", calls: [] as Record<string, unknown>[], rows: [] as string[],
    repeat: false, stuck: false,
  };
  return {
    state,
    rpc: async (_name: string, args: { p_filter: Record<string, unknown> }) => {
      const filter = args.p_filter;
      state.calls.push(filter);
      const size = Number(filter.limit ?? 500);
      const after = filter.after && typeof filter.after === "object" ? filter.after as { id?: string } : null;
      const found = after?.id ? state.rows.indexOf(after.id) : -1;
      const start = state.repeat && after ? 0 : found >= 0 ? found + 1 : 0;
      const ids = state.rows.slice(start, start + size);
      const more = state.stuck || (state.repeat ? !after : start + size < state.rows.length);
      const last = ids[ids.length - 1];
      const cursorId = state.stuck && after?.id ? after.id : last;
      return {
        data: {
          participants: ids.map((id) => ({
            id, student_id: "s", subject_key: "math", session_date: DATE, class_id: "c",
            teacher_id: "t", status: "unknown", case_ids: [], start_time: "16:20:00",
          })),
          legacy_maps: [], truncated: more, total: state.stuck ? state.rows.length + 500 : state.rows.length,
          next_after: more && cursorId ? { session_date: DATE, start_time: "16:20:00", id: cursorId } : null,
        },
        error: null,
      };
    },
  };
});

vi.mock("@/features/owner/server/queries", () => ({
  getTenantSettings: async () => ({ makeups: { mode: m.state.mode, pilotSubjects: ["math"], allowAdditional: false } }),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: m.rpc }) }));

import { loadNativeParticipants } from "./participants";

beforeEach(() => {
  m.state.mode = "on";
  m.state.calls = [];
  m.state.rows = [];
  m.state.repeat = false;
  m.state.stuck = false;
});

describe("참여 목록 페이지", () => {
  it("첫 쪽은 page 만, 다음 쪽은 after 만 보내 501행과 1001행을 읽는다", async () => {
    for (const count of [501, 1001]) {
      m.state.rows = Array.from({ length: count }, (_, i) => `p${String(i).padStart(4, "0")}`);
      m.state.calls = [];
      const out = await loadNativeParticipants({ session_date: DATE, page: 9, page_size: 20, after: { id: "caller" } });
      expect(out.status).toBe("ok");
      if (out.status !== "ok") continue;
      expect(out.value.truncated).toBe(false);
      expect(out.value.participants).toHaveLength(count);
      expect(out.value.total).toBe(count);
      expect(out.value.nextAfter).toBeNull();
      expect(m.state.calls.length).toBe(Math.ceil(count / 500));
      expect(m.state.calls[0]).toMatchObject({ page: 1, page_size: 500, limit: 500, session_date: DATE });
      expect(m.state.calls[0]).not.toHaveProperty("after");
      expect(m.state.calls[1]).not.toHaveProperty("page");
      expect(m.state.calls[1]).not.toHaveProperty("page_size");
      expect(m.state.calls[1]).toMatchObject({
        limit: 500, session_date: DATE, after: { session_date: DATE, start_time: "16:20", id: "p0499" },
      });
    }
  });

  it("같은 식별자를 다시 주면 잘림으로 실패한다", async () => {
    m.state.rows = Array.from({ length: 600 }, (_, i) => `p${i}`);
    m.state.repeat = true;
    await expect(loadNativeParticipants({ session_date: DATE })).resolves.toEqual({
      status: "failed", error: "보강 참여 목록이 잘렸습니다",
    });
  });

  it("커서가 앞으로 가지 않으면 잘림으로 실패한다", async () => {
    m.state.rows = Array.from({ length: 700 }, (_, i) => `p${String(i).padStart(4, "0")}`);
    m.state.stuck = true;
    await expect(loadNativeParticipants({ session_date: DATE })).resolves.toEqual({
      status: "failed", error: "보강 참여 목록이 잘렸습니다",
    });
  });

  it("4,000명은 읽고 그 다음은 더 있다는 오류다", async () => {
    m.state.rows = Array.from({ length: 4000 }, (_, i) => `p${String(i).padStart(4, "0")}`);
    const fit = await loadNativeParticipants({ session_date: DATE });
    expect(fit.status).toBe("ok");
    if (fit.status === "ok") expect(fit.value.participants).toHaveLength(4000);
    expect(m.state.calls).toHaveLength(8);
    m.state.rows = Array.from({ length: 4001 }, (_, i) => `p${String(i).padStart(4, "0")}`);
    m.state.calls = [];
    await expect(loadNativeParticipants({ session_date: DATE })).resolves.toEqual({
      status: "failed", error: "보강 참여가 더 있습니다. 기간을 나눠 다시 조회해 주세요",
    });
    expect(m.state.calls).toHaveLength(8);
  });

  it("운영이 꺼져 있으면 목록을 묻지 않는다", async () => {
    m.state.mode = "off";
    m.state.rows = ["p0"];
    await expect(loadNativeParticipants({ session_date: DATE })).resolves.toEqual({ status: "off" });
    expect(m.state.calls).toHaveLength(0);
  });
});
