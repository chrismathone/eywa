import "server-only";
import { z } from "zod";
import { parseAutomaticConfigs, parseBindingConfigs } from "./sync-contract";

const fields = new Set([
  "bindingId", "tenantId", "targetBranchId", "sourceBaseUrl", "targetBaseUrl",
  "keyId", "controlSecret", "webhookSecret", "ssoSecret", "provision",
]);
const configurationErrors = new Set([
  "duplicate_binding_key", "binding_identity_mismatch", "ambiguous_tenant_binding",
  "ambiguous_branch_binding", "duplicate_automatic_key", "automatic_origin_mismatch",
]);

/** Only static field names/codes leave this diagnostic, never values or error messages. */
function inspect(raw: string | undefined, parse: (raw: string | undefined) => unknown[]) {
  const configured = Boolean(raw?.trim());
  try { return { configured, valid: true, count: parse(raw).length }; }
  catch (error) {
    if (error instanceof SyntaxError) return { configured, valid: false, error: "invalid_json" };
    if (error instanceof z.ZodError) return {
      configured, valid: false, error: "invalid_schema",
      issues: error.issues.slice(0, 20).map((issue) => ({
        path: issue.path.map((part) => typeof part === "number" ? part : fields.has(String(part)) ? part : "unknown"),
        code: issue.code,
      })),
    };
    return { configured, valid: false, error: error instanceof Error && configurationErrors.has(error.message)
      ? error.message : "invalid_configuration" };
  }
}

export function syncConfigDiagnostics() {
  return {
    EYWA_SYNC_BINDINGS_JSON: inspect(process.env.EYWA_SYNC_BINDINGS_JSON, parseBindingConfigs),
    EYWA_SYNC_AUTO_JSON: inspect(process.env.EYWA_SYNC_AUTO_JSON, parseAutomaticConfigs),
  };
}
