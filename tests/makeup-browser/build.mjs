/** Build with owned loopback services only; never load or copy environment files. */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { loopbackEnv } from "./loopback-env.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const child = spawn(process.execPath, ["--max-old-space-size=6144", "node_modules/next/dist/bin/next", "build", "--webpack"], {
  cwd: root, stdio: "inherit", env: loopbackEnv(root),
});
child.on("exit", code => { process.exitCode = code ?? 1; });
process.on("SIGINT", () => child.kill("SIGINT"));
process.on("SIGTERM", () => child.kill("SIGTERM"));
