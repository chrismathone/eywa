import { vi } from "vitest";

const bag = vi.hoisted(() => ({
  mode: "off" as "off" | "on" | "draining",
  rpcError: null as { message: string } | null,
  participants: [] as Record<string, unknown>[],
  rpcCalls: 0,
}));

export const nativeRead = bag;

vi.mock("@/features/owner/server/queries", () => ({
  getTenantSettings: async () => ({
    operations: { holidays: [] },
    makeups: { mode: bag.mode, allowAdditional: false, pilotSubjects: ["math"] },
  }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc: async () => {
      bag.rpcCalls += 1;
      if (bag.rpcError) return { data: null, error: bag.rpcError };
      return { data: { participants: bag.participants, legacy_maps: [], truncated: false }, error: null };
    },
  }),
}));
