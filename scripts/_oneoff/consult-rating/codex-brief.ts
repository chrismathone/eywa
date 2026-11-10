// Codex 블라인드 채점 브리프 — 모델 점수 없이 같은 기준(CONSULT_RUBRIC)·같은 카드(consultationCard)로. 출력 = ~/eywa-data/consult-rating/codex/<표본>/brief.md
// TSX_TSCONFIG_PATH=scripts/_oneoff/consult-rating/tsconfig.json node --import tsx scripts/_oneoff/consult-rating/codex-brief.ts <표본 이름>
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { consultationCard } from "@/features/consultation-rating/harness/card";
import { CONSULT_RUBRIC } from "@/features/consultation-rating/harness/rubric";
import type { ConsultationRatingInput } from "@/features/consultation-rating/harness/types";

const ROOT = join(homedir(), "eywa-data", "consult-rating");
const tag = process.argv[2];
const cards = JSON.parse(readFileSync(join(ROOT, "samples", `${tag}.masked.json`), "utf8")) as { id: string; input: ConsultationRatingInput }[];
const brief = `너는 학원 원생 상담 기록 평점 검수자다. 파일을 만들거나 고치지 말고, 명령도 실행하지 말고, 아래 자료만 읽고 답만 출력하라. 한국어로 답한다.
아래 [채점 기준]으로 상담 기록 ${cards.length}건을 **한 건씩 따로** 채점하라(서로 비교하지 말 것). 기준 문장을 글자대로 따른다. 이름은 ○○/△△로 가려져 있다.
출력: 마지막에 코드블록 하나의 JSON — {"cards":[{"id":"s1","score":3,"reason":"한 줄 이유(40자 안팎)","kinds":["schedule"],"unsure":false}, …]} — s1부터 s${cards.length}까지 빠짐없이.

[채점 기준]
${CONSULT_RUBRIC}

[상담 기록 ${cards.length}건]
${cards.map((c) => `### ${c.id}\n${consultationCard(c.input)}`).join("\n\n")}
`;
const dir = join(ROOT, "codex", tag);
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "brief.md"), brief);
console.log(`${tag}: ${cards.length}건 · 브리프 ${Math.round(brief.length / 1000)}K자 → ${dir}/brief.md`);
