import { refreshDemoMath } from "../../src/features/demo-history/math-refresh";

// Preview: pnpm exec tsx --env-file=.env.local scripts/_oneoff/refresh-demo-math.mts
// Rehearse a future date without writing: add --apply --verify-rollback --as-of=YYYY-MM-DD

const day = process.argv.find((arg) => arg.startsWith("--as-of="))?.slice(8);
if (day && !/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error("--as-of requires YYYY-MM-DD");
refreshDemoMath(day ? new Date(`${day}T12:00:00+09:00`) : new Date(), process.argv.includes("--apply"), process.argv.includes("--verify-rollback"))
  .then((result) => console.log(JSON.stringify(result, null, 2)))
  .catch((error) => { console.error("Demo math refresh failed:", error); process.exitCode = 1; });
