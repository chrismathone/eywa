import { vi } from "vitest";

export const KEY = "att:ffffffff-ffff-4fff-8fff-ffffffffffff";
export const PART = "ffffffff-ffff-4fff-8fff-ffffffffffff";
export const ATT = "11111111-1111-4111-8111-111111111111";
export const TEACHER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
export const DESK = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const bag = vi.hoisted(() => ({
  state: {
    calls: [] as { name: string; args: Record<string, unknown> }[],
    gap: "ok" as "ok" | "null" | "error",
    evidence: [] as unknown[],
    commandError: false,
    claimsSub: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" as string | null,
    userId: null as string | null,
    claimsThrow: false,
    userThrow: false,
  },
}));

export const m = bag;

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getClaims: async () => {
        if (bag.state.claimsThrow) throw new Error("claims");
        return { data: { claims: bag.state.claimsSub ? { sub: bag.state.claimsSub } : {} } };
      },
      getUser: async () => {
        if (bag.state.userThrow) throw new Error("user");
        return { data: { user: bag.state.userId ? { id: bag.state.userId } : null } };
      },
    },
    rpc: async (name: string, args: Record<string, unknown>) => {
      bag.state.calls.push({ name, args });
      if (name === "makeup_note_effect_gap") {
        if (bag.state.gap === "error") return { data: null, error: { message: "rejected" } };
        if (bag.state.gap === "null") return { data: null, error: null };
        const gap = args.p_gap as { effect_key?: string; kind?: string };
        return {
          data: {
            queued: true, id: "55555555-5555-4555-8555-555555555555",
            effect_key: gap.effect_key, kind: gap.kind, state: "failed", projection_state: "pending", case_ids: [],
          },
          error: null,
        };
      }
      if (name === "makeup_projection_evidence") return { data: bag.state.evidence.shift() ?? null, error: null };
      if (name === "makeup_command") {
        if (bag.state.commandError) return { data: null, error: { message: "rejected" } };
        return {
          data: {
            id: "22222222-2222-4222-8222-222222222222", revision: 1, replayed: false, effect_key: KEY,
            action: "participation", case_id: null, session_id: null, participant_id: PART, fulfillment_id: null,
            case_ids: [], quantities: null, warnings: [], projection_state: "pending",
          },
          error: null,
        };
      }
      return { data: null, error: { message: "unexpected" } };
    },
  }),
}));
