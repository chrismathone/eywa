import { z } from "zod";
import type { AccessMatrix } from "@/lib/permissions";

/** Supported occurrence/attendance contract in this release, separate from tenant subject labels. */
export const MAKEUP_PILOT_CAPABILITIES = ["math"] as const;

export const makeupSettingsSchema = z.object({
  mode: z.enum(["off", "on", "draining"]),
  allowAdditional: z.boolean(),
  pilotSubjects: z.array(z.enum(MAKEUP_PILOT_CAPABILITIES)).min(1).max(10),
});
export type MakeupSettings = z.infer<typeof makeupSettingsSchema>;

export const DEFAULT_MAKEUP_SETTINGS: MakeupSettings = {
  mode: "off", allowAdditional: false, pilotSubjects: ["math"],
};

/** An absent or invalid configuration never activates the new feature. */
export function normalizeMakeupSettings(raw: unknown): MakeupSettings {
  const parsed = makeupSettingsSchema.safeParse(raw);
  return parsed.success ? { ...parsed.data, pilotSubjects: [...new Set(parsed.data.pilotSubjects)] }
    : { ...DEFAULT_MAKEUP_SETTINGS, pilotSubjects: [...DEFAULT_MAKEUP_SETTINGS.pilotSubjects] };
}

/** Apply after both tenant and personal permission overrides. */
export function capMakeupMode(matrix: AccessMatrix, mode: MakeupSettings["mode"]): AccessMatrix {
  if (mode !== "off") return matrix;
  return { ...matrix, makeups: {
    master: "none", admin: "none", manager: "none", teacher: "none",
    counselor: "none", accountant: "none", viewer: "none", parttime: "none", student: "none",
  } };
}
