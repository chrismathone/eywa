/** Production browser verification with owned loopback services only. */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { loopbackEnv } from "./loopback-env.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", "3045"], {
  cwd: root, stdio: "inherit", env: loopbackEnv(root),
});
child.on("exit", code => { process.exitCode = code ?? 1; });
process.on("SIGINT", () => child.kill("SIGINT"));
process.on("SIGTERM", () => child.kill("SIGTERM"));
