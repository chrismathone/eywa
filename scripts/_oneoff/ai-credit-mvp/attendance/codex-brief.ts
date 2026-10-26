// ④ Codex 잠정 정답 브리프 — 사람 정답표와 같은 칸(종류·날짜들·형태·확실성·근거). 모델 판정·과거 판정은 보여 주지 않는다.
// 🔴 이것은 사람 정답이 아니다 — 사무실·원장이 gold-labels.csv를 채우기 전까지의 잠정 기준(결과 표에 그렇게 적는다).
// node --import tsx scripts/_oneoff/ai-credit-mvp/attendance/codex-brief.ts <tuning|final>
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { RESULT_ROOT } from "../lib/runner";
import type { AtRecord } from "./prompts";

const set = process.argv[2] as "tuning" | "final";
const snapName = process.argv[3] ?? "attendance"; // attendance-tune2 = 10-02 전 추가 조정용
const snap = join(RESULT_ROOT, "01-snapshots", snapName);
const rows: AtRecord[] = readFileSync(join(snap, "inputs.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
const want = new Set<string>(JSON.parse(readFileSync(join(snap, "splits.json"), "utf8"))[set]);
const list = rows.filter((r) => want.has(r.id)).sort((a, b) => (a.messageDate + a.mid).localeCompare(b.messageDate + b.mid));
const dow = (d: string) => "일월화수목금토"[new Date(`${d}T00:00:00Z`).getUTCDay()];

const brief = `# 학부모 메시지 출결 판정 — 정답표 작성(블라인드)

너는 한국 학원 사무실 직원이다. 파일을 만들거나 고치지 말고, 아래 메시지만 읽고 답만 출력하라.
학부모·학생이 학원 알림장 앱에 남긴 메시지 ${list.length}건마다, 사람이 보고 확정하는 정답표 칸을 채운다.

## 칸
- category: "absence"(결석·못 감·쉼) | "late"(지각) | "early_leave"(조퇴·일찍 데려감) | "none"(그 밖 — 인사·감사·문의·지난 일 설명·보강 일정 협의·취소된 결석)
  · **앞으로(또는 오늘)의 출결 통보**만 출결이다. 이미 지나간 일의 설명은 none. 한 메시지에 문의와 통보가 함께 있으면 통보를 잡는다.
- dates: 해당 날짜 전부(YYYY-MM-DD) — '오늘'·'내일'·'목요일'은 **연락일 기준**으로 푼다(연락일 요일을 함께 적어 두었다). 기간이면 그 사이 날을 모두, 띄엄띄엄이면 그 날들만. 날짜를 알 수 없으면 빈 배열.
- form: "하루" | "기간" | "띄엄띄엄" | "없음"(none이면)
- uncertain: 조건부·가능성뿐('~할 수도', '확정되면 연락')이면 true
- evidence: 판단 근거 구절(원문 그대로)
- note: 애매한 점이 있으면 한 줄(없으면 "")

## 메시지
${list.map((r) => `### ${r.mid} · 연락일 ${r.messageDate}(${dow(r.messageDate)}) · 학생 ${r.student || "미상"}\n"""${r.content}"""`).join("\n\n")}
`;
const schema = {
  type: "object", additionalProperties: false, required: ["items"],
  properties: { items: { type: "array", items: { type: "object", additionalProperties: false, required: ["mid", "category", "dates", "form", "uncertain", "evidence", "note"],
    properties: { mid: { type: "string" }, category: { type: "string", enum: ["absence", "late", "early_leave", "none"] }, dates: { type: "array", items: { type: "string" } },
      form: { type: "string", enum: ["하루", "기간", "띄엄띄엄", "없음"] }, uncertain: { type: "boolean" }, evidence: { type: "string" }, note: { type: "string" } } } } },
};
const dir = join(RESULT_ROOT, "05-attendance", "codex", snapName === "attendance" ? set : `${snapName}-${set}`);
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "brief.md"), brief);
writeFileSync(join(dir, "schema.json"), JSON.stringify(schema, null, 2));
console.log(`${set}: ${list.length}건 · ${Math.round(brief.length / 1000)}K자 → ${dir}`);
