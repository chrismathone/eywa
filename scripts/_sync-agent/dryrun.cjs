// Offline regression check for the existing workers and their web consumers.
// Does NOT start operational daemons, pass --apply/--post, or load .env files.
// Usage: node scripts/_sync-agent/dryrun.cjs
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "../..");
const normalize = (file) => file.replaceAll("\\", "/");
const roots = ["scripts/_classnote", "scripts/_makeedu", "src", "tests/unit"];
const walk = (dir) => fs.readdirSync(path.join(root, dir), { recursive: true })
  .map((file) => normalize(path.join(dir, file)));
const candidates = roots.flatMap(walk).filter((file) => /\.(test|spec)\.(mjs|ts|tsx)$/.test(file));
const direct = /^scripts\/_(classnote|makeedu)\/|^src\/features\/(video-submit|video-homework|classnote-reply|report-admin)\/|classnote|makeedu|video-drive|integrations-face|push-eligibility|sync-error|textbook-(send|notice|audit|ownership)|homework-videos|video-site-form/i;
const reference = /classnote|makeedu|homework_video|homeworkVideo|video-submit|video-homework/i;
const files = candidates.filter((file) => direct.test(file) || reference.test(fs.readFileSync(path.join(root, file), "utf8"))).sort();
if (!files.length) throw new Error("No worker-related tests found.");

const runDir = path.join(root, "work/unified-sync-agent-dryrun", new Date().toISOString().replaceAll(":", "-"));
fs.mkdirSync(runDir, { recursive: true });
const write = (name, value) => fs.writeFileSync(path.join(runDir, name), JSON.stringify(value, null, 2) + "\n");
const hash = (file) => crypto.createHash("sha256").update(fs.readFileSync(path.join(root, file))).digest("hex");
const workerFiles = roots.slice(0, 2).flatMap(walk).filter((file) => /\.(mjs|cjs|ps1|bat)$/.test(file) && !/\.test\./.test(file)).sort();
const workerHashes = Object.fromEntries(workerFiles.map((file) => [file, hash(file)]));

// Allow only OS/runtime paths, not inherited DB, Supabase, cloud, or worker credentials.
const osKeys = new Set(["PATH", "PATHEXT", "SYSTEMROOT", "WINDIR", "COMSPEC", "SYSTEMDRIVE", "TEMP", "TMP", "HOME", "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "APPDATA", "LOCALAPPDATA", "PROGRAMDATA", "PROGRAMFILES", "PROGRAMFILES(X86)", "OS", "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE"]);
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => osKeys.has(key.toUpperCase())));
Object.assign(env, {
  NODE_ENV: "test", CI: "true", NO_COLOR: "1",
  NODE_OPTIONS: `--require "${normalize(path.join(__dirname, "dryrun-offline.cjs"))}"`,
  EYWA_DRYRUN_NETWORK_AUDIT: path.join(runDir, "network-attempts.jsonl"),
});
fs.writeFileSync(env.EYWA_DRYRUN_NETWORK_AUDIT, "");

// Prove the guard is active BEFORE relying on it. These attempts have no real data.
const probes = [
  "fetch('https://example.invalid/')",
  "require('node:http').get('http://example.invalid/')",
  "require('node:https').request('https://example.invalid/')",
  "require('node:net').connect({host:'192.0.2.1',port:9})",
  "require('node:tls').connect({host:'example.invalid',port:443})",
  "require('node:dns').promises.lookup('example.invalid')",
  "require('node:dgram').createSocket('udp4').send(Buffer.from('offline-test'),9,'192.0.2.1')",
];
const probeAudit = path.join(runDir, "guard-selfcheck.jsonl");
fs.writeFileSync(probeAudit, "");
for (const expression of probes) {
  const code = `Promise.resolve().then(()=>${expression}).then(()=>process.exit(9),e=>process.exit(e.code==='EYWA_DRYRUN_NETWORK_BLOCKED'?0:8))`;
  const probe = spawnSync(process.execPath, ["-e", code], {
    cwd: root, env: { ...env, EYWA_DRYRUN_NETWORK_AUDIT: probeAudit },
    stdio: "pipe", windowsHide: true, timeout: 5000,
  });
  if (probe.error || probe.status !== 0) throw new Error("Offline network guard self-check failed; no tests were started.");
}
const selfChecks = fs.readFileSync(probeAudit, "utf8").trim().split("\n").filter(Boolean);
if (selfChecks.length !== probes.length) throw new Error("Offline guard audit incomplete; no tests were started.");

const safety = spawnSync(process.execPath, [path.join(__dirname, "legacy-safety-audit.cjs")], {
  cwd: root, env, encoding: "utf8", windowsHide: true, timeout: 15_000,
});
if (safety.error || safety.status !== 0) throw new Error("Legacy safety simulation failed to run; inspect it before proceeding.");
const legacySafety = JSON.parse(safety.stdout);
write("legacy-safety-findings.json", legacySafety);

// Separately constrained local DB stage. Its script inspects the labeled fixture
// container and permits only its 127.0.0.1 port; DATABASE_URL is never consulted.
const fixtureEnv = { ...env };
delete fixtureEnv.NODE_OPTIONS;
const databaseCheck = spawnSync(process.execPath, [path.join(__dirname, "lease-db-check.cjs")], {
  cwd: root, env: fixtureEnv, encoding: "utf8", windowsHide: true, timeout: 90_000,
});
if (databaseCheck.error || databaseCheck.status !== 0) {
  fs.writeFileSync(path.join(runDir, "database-check.log"), databaseCheck.stderr ?? "");
  throw new Error(`Isolated database check did not pass. Evidence: ${runDir}`);
}
const databaseReport = JSON.parse(databaseCheck.stdout);
write("database-check.json", databaseReport);

write("manifest.json", {
  startedAt: new Date().toISOString(), node: process.version, files,
  scope: "Existing worker regression tests and web tests selected by path or worker/video references. Not unified EXE acceptance tests.",
  guardSelfChecks: selfChecks.length, workerHashes,
  databaseChecks: databaseReport.passed,
});
console.log(`Offline dry-run: ${files.length} test files; ${selfChecks.length} network guard checks passed.`);
console.log(`Evidence: ${runDir}`);

const output = fs.openSync(path.join(runDir, "vitest.log"), "w");
let result;
try {
  result = spawnSync(process.execPath, [path.join(root, "node_modules/vitest/vitest.mjs"), "run", ...files,
    "--reporter=json", `--outputFile=${path.join(runDir, "vitest-results.json")}`], {
    cwd: root, env, stdio: ["ignore", output, output], windowsHide: true,
    // A stalled fake/browser test must not leave a dry-run going indefinitely.
    timeout: 15 * 60_000,
  });
} finally { fs.closeSync(output); }
const resultPath = path.join(runDir, "vitest-results.json");
const report = fs.existsSync(resultPath) ? JSON.parse(fs.readFileSync(resultPath, "utf8")) : null;
const networkAttempts = fs.readFileSync(env.EYWA_DRYRUN_NETWORK_AUDIT, "utf8").trim().split("\n").filter(Boolean).length;
const workerChanges = workerFiles.filter((file) => !fs.existsSync(path.join(root, file)) || hash(file) !== workerHashes[file]);
const assertions = report?.testResults?.flatMap((file) => file.assertionResults.map((test) => ({
  file: normalize(path.relative(root, file.name)), name: test.fullName, status: test.status,
}))) ?? [];
const executedFiles = new Set((report?.testResults ?? []).map((file) => normalize(path.relative(root, file.name))));
const missingFiles = files.filter((file) => !executedFiles.has(file));
const summary = {
  finishedAt: new Date().toISOString(), exitCode: result?.status ?? null,
  runnerError: result?.error?.code ?? null,
  selectedFiles: files.length, reportedFiles: executedFiles.size, missingFiles,
  passed: assertions.filter((test) => test.status === "passed").length,
  failed: assertions.filter((test) => test.status === "failed"),
  skipped: assertions.filter((test) => ["pending", "skipped", "todo", "disabled"].includes(test.status)),
  networkAttempts, workerChanges,
  legacySafetyGaps: legacySafety.unresolved,
  databaseChecksPassed: databaseReport.passed,
  regressionPassed: result?.status === 0 && report?.success === true && missingFiles.length === 0 && networkAttempts === 0 && workerChanges.length === 0,
  unifiedExeAcceptance: "SEPARATE_DESKTOP_ACCEPTANCE_REQUIRED",
};
summary.virtualChecksPassed = summary.regressionPassed && legacySafety.unresolved === 0 && summary.skipped.length === 0 && databaseReport.passed >= 12;
write("summary.json", summary);
console.log(JSON.stringify(summary, null, 2));
// A passing regression suite must not hide an adversarial safety finding.
process.exitCode = summary.virtualChecksPassed ? 0 : 1;
