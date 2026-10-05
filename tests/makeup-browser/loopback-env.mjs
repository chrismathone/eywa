/** Keep browser verification isolated from inherited application credentials. */
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { token } from "./local-auth.mjs";

export function loopbackEnv(root, inherited = process.env) {
  assert.ok(!readdirSync(root).some(name => /^\.env(?:\.|$)/.test(name) && !name.endsWith(".example")), "Verification checkout must contain no environment files");
  const systemKeys = new Set(["PATH", "PATHEXT", "SYSTEMROOT", "WINDIR", "COMSPEC", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "PROGRAMFILES", "PROGRAMFILES(X86)"]);
  const system = Object.fromEntries(Object.entries(inherited).filter(([key]) => systemKeys.has(key.toUpperCase())));
  return { ...system,
    DATABASE_URL: "postgres://makeup_test:makeup_local_only@127.0.0.1:55444/makeup_browser",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:55445",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: token("anon"), SUPABASE_SERVICE_ROLE_KEY: token("service_role"),
    NEXT_PUBLIC_APP_URL: "http://127.0.0.1:3045", LEGACY_REDIRECT_HOSTS: "", NODE_ENV: "production",
    NEXT_TELEMETRY_DISABLED: "1",
  };
}
