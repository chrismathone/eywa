// ① 독립 평가자(Codex) 블라인드 정답 브리프 — 모델 이름·모델 제안·기존 값 없이 근거 카드와 판정 기준만.
// node --import tsx scripts/_oneoff/ai-credit-mvp/withdrawals/codex-brief.ts <tuning|final> [기준 버전, 기본 v2]
// → 03-withdrawals/codex/<set>/{brief.md, schema.json} — 실행은 codex exec -s read-only (read-only 샌드박스, 파일 수정 없음).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { RESULT_ROOT } from "../lib/runner";
import { cardText, type WdRecord } from "./card";
import { GUIDELINES, taxonomyText } from "./guideline";
import { recordedCategories } from "./recorded";

const set = process.argv[2] as "tuning" | "final";
const gv = process.argv[3] ?? "v2";
if (!GUIDELINES[gv]) throw new Error(`기준 ${gv} 없음`);
if (set !== "tuning" && set !== "final") throw new Error("tuning | final");
const SNAP = join(RESULT_ROOT, "01-snapshots", "withdrawals");
const rows: WdRecord[] = readFileSync(join(SNAP, "inputs.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
const splits = JSON.parse(readFileSync(join(SNAP, "splits.json"), "utf8")) as Record<"tuning" | "final", string[]>;
const want = new Set(splits[set]);
const cases = rows.filter((r) => want.has(r.sid) && !r.held);

const brief = `# 퇴원 사유 판정 — 독립 평가(블라인드)

너는 학원(한국 · 수학/영어) 퇴원 기록을 읽고 **퇴원 사유를 분류하는 독립 평가자**다. 파일을 만들거나 고치지 말고, 아래 카드만 읽고 답만 출력하라.
학생 ${cases.length}명. 학생마다 카드 하나. 카드에 없는 사실을 지어내지 말 것.

## 대분류 14 · 세부(key)
${taxonomyText()}

## ${GUIDELINES[gv]}

## 출력
JSON 하나(스키마 고정): cases = 학생마다 하나, 카드 순서대로.
- sid: 카드의 학생 id
- status: "제안" | "충돌" | "근거 부족"
- reason: 대분류 key(영문) — '제안'일 때만, 아니면 null
- detail: 세부 key — 직접 근거가 있을 때만, 아니면 null
- memo: reason이 other일 때 실제 사유(원문 표현, 20자 안팎), 아니면 null
- evidence_src: 근거 id(mk · a:<원본id>:<칸 이름> · e1 · c1 · p1) — 근거가 없으면 null
- evidence_quote: 그 근거 글에서 **그대로 복사한** 짧은 구절(고치거나 요약하지 말 것) — 없으면 null
- note: 판단 이유 한 줄(충돌이면 무엇과 무엇이 어긋나는지)

## 카드
${cases.map((r) => cardText(r, gv >= "v3" ? { recorded: recordedCategories(r) } : {})).join("\n\n")}
`;
const nullable = { type: ["string", "null"] };
const schema = {
  type: "object", additionalProperties: false, required: ["cases"],
  properties: { cases: { type: "array", items: { type: "object", additionalProperties: false,
    required: ["sid", "status", "reason", "detail", "memo", "evidence_src", "evidence_quote", "note"],
    properties: { sid: { type: "string" }, status: { type: "string", enum: ["제안", "충돌", "근거 부족"] }, reason: nullable, detail: nullable, memo: nullable,
      evidence_src: nullable, evidence_quote: nullable, note: { type: "string" } } } } },
};
const dir = join(RESULT_ROOT, "03-withdrawals", "codex", gv === "v1" ? set : `${set}-${gv}`);
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "brief.md"), brief);
writeFileSync(join(dir, "schema.json"), JSON.stringify(schema, null, 2));
console.log(`${set}: ${cases.length}명 · 브리프 ${Math.round(brief.length / 1000)}KB → ${dir}`);
