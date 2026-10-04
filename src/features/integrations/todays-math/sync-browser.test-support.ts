import type { CurrentUser } from "@/lib/auth/current-user";
import type { BindingConfig, Control, ControlUser } from "./sync-contract";

export const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const config: BindingConfig = {
  bindingId: id(1), tenantId: id(2), targetBranchId: id(3),
  sourceBaseUrl: "https://source.example", targetBaseUrl: "https://configured-target.example",
  keyId: "key", controlSecret: "c".repeat(32), webhookSecret: "w".repeat(32), ssoSecret: "s".repeat(32),
};
export const user: CurrentUser = {
  id: id(7), tenantId: config.tenantId, systemRole: "teacher", email: "teacher@example.com",
  displayName: "Teacher", jobTitle: null,
};
export const eligibleEntry: ControlUser = {
  id: user.id, email: user.email, name: user.displayName, status: "active", role: "teacher",
  subjects: ["math"], eligible: true, blockReasons: [],
  accountRevocationGeneration: "0", classListRevision: "0", classes: [],
};
export const activeControl: Control = {
  schemaVersion: 2, bindingId: config.bindingId, tenantId: config.tenantId,
  targetBranchId: config.targetBranchId, sourceEpoch: id(4), securityRevision: "2",
  tenantRevocationGeneration: "2", enabled: true, mode: "active", healthy: true,
  validatedAt: "2026-10-04T08:00:00Z", nextEffectiveAt: null, users: [],
};
