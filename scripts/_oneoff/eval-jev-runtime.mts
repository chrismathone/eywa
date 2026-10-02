/** Synthetic-only live regression of the application rubric + transport. No DB / notification code. */
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { callJev } from "../../src/lib/ai/jev";
import { withFactGuard } from "../../src/lib/ai/fact-guard";
import { buildAttendanceDecision, attendanceReviewReasons, ATTENDANCE_RUBRIC_VERSION } from "../../src/features/attendance/parent-alerts/jev-decision";

type Item = { id: string; group: string; text: string; expected: string; history?: string[]; historyDates?: string[]; messageDate?: string; student?: string; subject?: string; date?: string };
const calendar = process.argv.includes("--calendar");
const source = new URL(calendar ? "./fixtures/jev-attendance-calendar-20.json" : "./fixtures/jev-attendance-250.json", import.meta.url);
const items: Item[] = JSON.parse(await readFile(source, "utf8"));
const cases = items.map((item) => {
  const decision = buildAttendanceDecision({
    studentName: item.student ?? "민준", course: item.subject ?? "수학", targetDate: item.date ?? "2026-10-02",
    history: (item.history ?? []).map((content, i) => ({ date: item.historyDates?.[i] ?? item.messageDate ?? "2026-10-02", content })),
    latest: { date: item.messageDate ?? "2026-10-02", content: item.text },
  });
  for (const question of Object.values(decision.questions)) question.instructions = withFactGuard(question.instructions);
  return { item, decision };
});
const datasetHash = createHash("sha256").update(JSON.stringify(cases)).digest("hex");
const out = `output/jev-runtime/${new Date().toISOString().replaceAll(/[:.]/g, "-")}`;
await mkdir(out, { recursive: true });
await writeFile(`${out}/fixtures.json`, JSON.stringify({ datasetHash, rubric: ATTENDANCE_RUBRIC_VERSION, cases }, null, 2));
if (!process.argv.includes("--run")) { console.log(JSON.stringify({ prepared: cases.length, datasetHash, out })); process.exit(0); }
const apiKey = process.env.TYPESAFE_API_KEY_ATTENDANCE || process.env.TYPESAFE_API_KEY;
if (!apiKey) throw new Error("TYPESAFE_API_KEY is required");
type Result = { id: string; group: string; expected: string; choice?: string; confidence?: number; correct: boolean; elapsedMs?: number; inputTokens?: number; reviewReasons?: string[]; error?: string };
const results: Result[] = [];
let next = 0;
const start = performance.now();
await Promise.all(Array.from({ length: 4 }, async () => {
  while (next < cases.length) {
    const { item, decision } = cases[next++];
    let entry: Result;
    try {
      const result = await callJev({ ...decision, apiKey });
      const answer = result.data.attendance;
      entry = { id: item.id, group: item.group, expected: item.expected, choice: answer.choice, confidence: answer.confidence,
        correct: answer.choice === item.expected, elapsedMs: result.elapsedMs, inputTokens: result.usage.inputTokens ?? 0,
        reviewReasons: attendanceReviewReasons(answer, item.history?.length ?? 0) };
    } catch (error) {
      entry = { id: item.id, group: item.group, expected: item.expected, correct: false, error: error instanceof Error ? error.message : "failed" };
    }
    results.push(entry);
    if (results.length % 50 === 0) console.log(JSON.stringify({ completed: results.length, total: cases.length }));
  }
}));
const times = results.flatMap((r) => r.elapsedMs == null ? [] : [r.elapsedMs]).sort((a, b) => a - b);
const high = results.filter((r) => (r.confidence ?? 0) >= 0.9);
const unflagged = results.filter((r) => r.reviewReasons?.length === 0);
const inputTokens = results.reduce((sum, r) => sum + (r.inputTokens ?? 0), 0);
const summary = { cases: results.length, correct: results.filter((r) => r.correct).length,
  errors: results.filter((r) => r.error).length, highConfidence: { count: high.length, correct: high.filter((r) => r.correct).length },
  withoutReviewHint: { count: unflagged.length, correct: unflagged.filter((r) => r.correct).length },
  p50Ms: times[Math.floor(times.length * 0.5)], p95Ms: times[Math.ceil(times.length * 0.95) - 1],
  inputTokens, estimatedUsdAtPublishedRate: inputTokens * 0.042 / 1_000_000, wallMs: Math.round(performance.now() - start), datasetHash };
await writeFile(`${out}/results.json`, JSON.stringify({ summary, results }, null, 2));
console.log(JSON.stringify({ out, ...summary }));
