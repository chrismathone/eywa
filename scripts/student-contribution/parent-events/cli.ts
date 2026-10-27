/** prepare is read-only. apply/revoke require the explicitly approved report fingerprint and owner. */
import postgres from "postgres";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import { execFileSync } from "node:child_process";
import { checkedConnection } from "../backfill-source";
import { CONTRIBUTION_PILOT_TENANT } from "../../../src/features/student-contribution/model/access";
import { kstToday } from "../../../src/lib/date-kst";
import { buildEventBundle, type EventBundle, type EventSourcePack } from "./bundle";
import { readEventDatabase } from "./snapshot";
import { verifyDriveSources } from "./drive-verify";
import { applyInitialEvents, revokeEventImport } from "./import-write";
import { verifySourceSnapshot, type FreshSourceSnapshot } from "./source-freshness";
const args = process.argv.slice(2), command = args[0];
function option(key: string) { const index = args.indexOf(key); if (index < 0 || !args[index + 1] || args[index + 1]!.startsWith("--")) throw new Error(`Missing ${key}`); return args[index + 1]!; }
const json = <T>(path: string) => JSON.parse(readFileSync(path, "utf8")) as T;
async function main() {
  if (!["prepare", "apply", "revoke"].includes(command ?? "")) throw new Error("Use prepare --sources <pack.json> --out <report.json>; apply/revoke require explicit owner approval");
  const tenant = CONTRIBUTION_PILOT_TENANT;
  const privacyKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const db = postgres(checkedConnection(), { ssl: "require", prepare: false, max: 1, onnotice: () => {} });
  try {
    if (command === "revoke") {
      const result = await revokeEventImport(db, tenant, option("--import"), option("--approve-fingerprint"), option("--owner"), option("--reason"));
      console.log(JSON.stringify(result)); return;
    }
    const pack = json<EventSourcePack>(option("--sources"));
    if (command === "prepare") {
      const output = resolve(option("--out"));
      if (!output.startsWith(resolve("work") + sep)) throw new Error("Private import bundles must stay in the ignored work directory");
      execFileSync("git", ["check-ignore", "--quiet", "--", output], { stdio: "ignore" });
      const driveVerifiedAt = args.includes("--verified-source-snapshot")
        ? verifySourceSnapshot(pack, json<FreshSourceSnapshot>(option("--verified-source-snapshot")), kstToday())
        : (await verifyDriveSources(pack), new Date().toISOString());
      const report = await db.begin("isolation level repeatable read read only", async sql => buildEventBundle(await readEventDatabase(sql, tenant), pack, kstToday(), privacyKey));
      report.driveVerifiedAt = driveVerifiedAt;
      writeFileSync(output, JSON.stringify(report, null, 2), { flag: "wx", mode: 0o600 });
      console.log(JSON.stringify({ readOnly: true, fingerprint: report.fingerprint, summary: report.summary })); return;
    }
    const report = json<EventBundle>(option("--report"));
    if (report.tenantId !== tenant) throw new Error("Wrong academy");
    if (report.today !== kstToday() || !report.driveVerifiedAt) throw new Error("Prepare a current-day Drive-verified report before approval");
    const result = await applyInitialEvents(db, report, pack, { owner: option("--owner"), approvedFingerprint: option("--approve-fingerprint"), scoringApproved: args.includes("--approve-scoring"), privacyKey }, () => verifyDriveSources(pack));
    console.log(JSON.stringify({ ...result, scoringEnabled: false, next: "Enable the approved rate separately and run the normal aggregation" }));
  } finally { await db.end({ timeout: 5 }); }
}
main().catch(error => { console.error(String(error.message).replace(/postgres(?:ql)?:\/\/\S+/gi, "[database-url]")); process.exitCode = 1; });
