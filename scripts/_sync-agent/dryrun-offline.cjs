// Test-process preload only. Never load this in an operational worker.
// This blocks Node networking, including imports made by a forked Vitest worker.
// It is a guard for trusted repository tests, not an OS sandbox for arbitrary programs.
const fs = require("node:fs");
const { syncBuiltinESMExports } = require("node:module");

function blocked(operation) {
  const audit = process.env.EYWA_DRYRUN_NETWORK_AUDIT;
  if (!audit) throw new Error("Offline dry-run requires its network audit destination.");
  // Deliberately omit request arguments: URLs/headers can contain credentials.
  fs.appendFileSync(audit, JSON.stringify({ at: new Date().toISOString(), pid: process.pid, operation }) + "\n");
  const error = new Error(`Offline dry-run blocked network access: ${operation}`);
  error.code = "EYWA_DRYRUN_NETWORK_BLOCKED";
  throw error;
}

for (const protocol of ["http", "https"]) {
  const mod = require(`node:${protocol}`);
  for (const method of ["request", "get"]) mod[method] = () => blocked(`${protocol}.${method}`);
}
require("node:net").Socket.prototype.connect = () => blocked("net.Socket.connect");
require("node:tls").connect = () => blocked("tls.connect");
require("node:dgram").Socket.prototype.send = () => blocked("dgram.Socket.send");
const dns = require("node:dns");
for (const [label, mod] of [["dns", dns], ["dns.promises", dns.promises]]) {
  for (const key of Object.keys(mod)) {
    if (/^(lookup|resolve|reverse)/.test(key) && typeof mod[key] === "function") {
      mod[key] = () => blocked(`${label}.${key}`);
    }
  }
}
globalThis.fetch = async () => blocked("fetch");
syncBuiltinESMExports();
