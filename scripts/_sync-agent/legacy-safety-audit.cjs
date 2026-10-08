// Regression of the four previously reproduced ownership failures.
// Historical failing evidence remains in the earlier run directory.
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { randomUUID } = require("node:crypto");

async function auditLegacyLease() {
  const { createLocalWorkerLock, decideWorkerLease } = await import(pathToFileURL(path.join(__dirname, "../_classnote/worker-lease.mjs")));
  const { createExecutionLease } = await import(pathToFileURL(path.join(__dirname, "../_classnote/worker-execution-lease.mjs")));
  const findings = [];
  const record = (id, scenario, expected, observed, requirementMet) => findings.push({ id, scenario, expected, observed, requirementMet });
  const deniedApi = { claim: async () => [], renew: async () => [], release: async () => [] };
  const noApproval = [createExecutionLease(deniedApi), createExecutionLease(deniedApi)];
  const emptyOwners = (await Promise.all(noApproval.map((lease) => lease.acquire()))).filter(Boolean).length;
  await Promise.all(noApproval.map((lease) => lease.release()));
  record("LEGACY01", "No server approval is returned", "No execution owner", { owners: emptyOwners }, emptyOwners === 0);

  const rows = [{ hostname: "same-name", alive: true, post_mode: true }];
  const sameNameOwners = ["a", "b"].map((instanceId) => decideWorkerLease({ rows, instanceId }).owner).filter(Boolean).length;
  record("LEGACY02", "Two PCs share a display hostname", "Hostname alone never grants execution", { owners: sameNameOwners }, sameNameOwners === 0);

  const denied = createLocalWorkerLock("virtual-denied", { createServer: () => { throw Object.assign(new Error("virtual denied"), { code: "EACCES" }); } });
  const allowed = await denied.acquire();
  record("LEGACY03", "OS lock cannot be acquired", "No execution authorization", { allowed }, allowed === false);

  const scope = `eywa-test-race:${randomUUID()}`;
  const contenders = Array.from({ length: 24 }, () => createLocalWorkerLock(scope));
  try {
    const owners = (await Promise.all(contenders.map((lock) => lock.acquire()))).filter(Boolean).length;
    record("LEGACY04", "24 simultaneous OS lock contenders", "Exactly one owner", { owners }, owners === 1);
  } finally { await Promise.all(contenders.map((lock) => lock.release())); }
  return {
    source: "scripts/_classnote/worker-lease.mjs + worker-execution-lease.mjs",
    scope: "Current implementation: simulated missing approval/permission error and real local OS lock contention. Real SQL races are checked separately.",
    findings, unresolved: findings.filter((finding) => !finding.requirementMet).length,
  };
}
module.exports = { auditLegacyLease };
if (require.main === module) auditLegacyLease().then((result) => console.log(JSON.stringify(result, null, 2)))
  .catch((error) => { console.error(error); process.exitCode = 1; });
