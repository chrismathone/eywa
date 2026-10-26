// ② 독립 평가자(Codex) 블라인드 채점 브리프 — 기준 v4 원문 + 앱과 같은 카드(모델 점수·체크리스트·기존 평점 없이).
// node --import tsx scripts/_oneoff/ai-credit-mvp/ratings/codex-brief.ts <tuning|final|regression> → 04-ratings/codex/<표본>/{brief.md, schema.json, map.json}
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cardText } from "@/features/report-rating/harness/card";
import { RUBRIC_V4 } from "@/features/report-rating/harness/rubric";
import type { RatingReport } from "@/features/report-rating/harness/types";
import { RESULT_ROOT } from "../lib/runner";

const set = process.argv[2];
const snap = join(RESULT_ROOT, "01-snapshots", "ratings");
const all: (RatingReport & { held?: boolean })[] = readFileSync(join(snap, "reports-all.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
const R = new Map(all.map((r) => [r.id, r]));
const ids: string[] = JSON.parse(readFileSync(join(snap, "splits.json"), "utf8"))[set];
const reports = ids.map((id) => R.get(id)!).filter((r) => r && !r.held).sort((a, b) => (a.d + a.id).localeCompare(b.d + b.id));
const map: Record<string, string> = {};
const cards = reports.map((r, i) => { map[`c${i + 1}`] = r.id; return cardText(r, `c${i + 1}`); });

const brief = `너는 학원 수업 알림장 평점 검수자다. 파일을 만들거나 고치지 말고, 명령도 실행하지 말고, 아래 자료만 읽고 답만 출력하라.
아래 [채점 기준]으로 알림장 ${reports.length}장을 한 장씩 따로 채점하라(서로 비교하지 말 것). 기준 문장을 글자대로 따른다.
출력: JSON 하나(스키마 고정) — cards = c1부터 c${reports.length}까지 빠짐없이. 항목마다 근거(note, 30자 안팎)를 먼저 쓰고 점수(1~5, concern만 해당 없으면 0).

[채점 기준]
${RUBRIC_V4}

[알림장 ${reports.length}장]
${cards.join("\n\n")}
`;
const item = { type: "object", additionalProperties: false, required: ["note", "score"], properties: { note: { type: "string" }, score: { type: "integer", minimum: 0, maximum: 5 } } };
const schema = {
  type: "object", additionalProperties: false, required: ["cards"],
  properties: { cards: { type: "array", items: { type: "object", additionalProperties: false,
    required: ["id", "warmth", "personal", "concern", "clarity", "trust", "claim_risk", "claim_reason"],
    properties: { id: { type: "string" }, warmth: item, personal: item, concern: item, clarity: item, trust: item, claim_risk: { type: "boolean" }, claim_reason: { type: "string" } } } } },
};
const dir = join(RESULT_ROOT, "04-ratings", "codex", set);
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "brief.md"), brief);
writeFileSync(join(dir, "schema.json"), JSON.stringify(schema, null, 2));
writeFileSync(join(dir, "map.json"), JSON.stringify(map));
console.log(`${set}: ${reports.length}장 · 브리프 ${Math.round(brief.length / 1000)}K자 → ${dir}`);
