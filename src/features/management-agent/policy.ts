import { z } from "zod";

export const DEFAULT_AGENT_POLICY = {
  mode: "off" as const,
  acknowledgeDays: 1,
  reminderDays: 3,
  notionAlerts: false,
};

export const agentPolicySchema = z.object({
  mode: z.enum(["off", "observe", "active"]),
  acknowledgeDays: z.number().int().min(1).max(14),
  reminderDays: z.number().int().min(1).max(30),
  notionAlerts: z.boolean(),
});
export type AgentPolicy = z.infer<typeof agentPolicySchema>;

export function agentPolicy(value: unknown): AgentPolicy {
  const parsed = agentPolicySchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_AGENT_POLICY;
}
