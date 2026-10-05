/** Local synthetic integration environment. Never copy or load .env.local here. */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { token } from "./local-auth.mjs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--webpack", "--hostname", "127.0.0.1", "--port", "3045"], {
  cwd: root, stdio: "inherit", env: { ...process.env,
    DATABASE_URL: "postgres://makeup_test:makeup_local_only@127.0.0.1:55444/makeup_browser",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:55445",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: token("anon"), SUPABASE_SERVICE_ROLE_KEY: token("service_role"),
    NEXT_PUBLIC_APP_URL: "http://127.0.0.1:3045", NEXT_PUBLIC_DEV_WINDOW_MODE_OVERRIDE: "windows",
    LEGACY_REDIRECT_HOSTS: "", NODE_ENV: "development",
  },
});
child.on("exit", code => { process.exitCode = code ?? 1; });
process.on("SIGINT", () => child.kill("SIGINT"));
process.on("SIGTERM", () => child.kill("SIGTERM"));
