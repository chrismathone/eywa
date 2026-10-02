/** Jev-only experiment: literal date candidates + typed judgments + calendar code.
 * Synthetic examples only; never writes attendance, notifications, or production DB.
 * node --env-file=.env.local --import tsx scripts/_oneoff/eval-jev-attendance.mts --run
 */
import { mkdir, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { FACT_GUARD } from "../../src/lib/ai/fact-guard";

const baseDate = "2026-10-02";
type Case = { id: string; text: string; category: string; events: string[]; context?: string; base?: string; review?: boolean };
const cases: Case[] = [
  { id: "a01", text: "오늘 아파서 결석합니다.", category: "absence", events: ["2026-10-02:absence"] },
  { id: "a02", text: "내일 30분 늦게 갈게요.", category: "late", events: ["2026-10-03:late"] },
  { id: "a03", text: "모레 수업 중간에 먼저 데리러 갑니다.", category: "early_leave", events: ["2026-10-04:early_leave"] },
  { id: "a04", text: "10월 5일부터 8일까지 가족 여행으로 결석합니다.", category: "absence", events: [5,6,7,8].map(d => `2026-10-0${d}:absence`) },
  { id: "a05", text: "10월 5일과 8일만 결석하고 6일은 정상 등원해요.", category: "absence", events: ["2026-10-05:absence", "2026-10-08:absence"] },
  { id: "a06", text: "10월 5일은 결석하고 6일은 20분 늦게 갑니다.", category: "mixed", events: ["2026-10-05:absence", "2026-10-06:late"] },
  { id: "a07", text: "오늘 결석 취소합니다. 정상 등원해요.", category: "correction", events: [] },
  { id: "a08", text: "오늘 결석은 아니고 10분 늦습니다.", category: "late", events: ["2026-10-02:late"] },
  { id: "a09", text: "지난주 못 갔던 수업 보강 언제 할 수 있나요?", category: "none", events: [] },
  { id: "a10", text: "10월 5일 보강 가능한가요? 8일은 결석합니다.", category: "absence", events: ["2026-10-08:absence"] },
  { id: "a11", text: "10월 5일, 6일에 못 갑니다.", category: "absence", events: ["2026-10-05:absence", "2026-10-06:absence"] },
  { id: "a12", text: "다음 주 월요일에는 가족 일정으로 쉽니다.", category: "absence", events: ["2026-10-05:absence"] },
  { id: "a13", text: "내일 결석할게요.", base: "2026-12-31", category: "absence", events: ["2027-01-01:absence"] },
  { id: "a14", text: "오늘 오후 5시에 먼저 데려갑니다.", category: "early_leave", events: ["2026-10-02:early_leave"] },
  { id: "a15", text: "개인 사정으로 결석합니다.", category: "absence", events: [], review: true },
  { id: "a16", text: "2월 30일에 결석합니다.", base: "2026-02-01", category: "absence", events: [], review: true },
  { id: "a17", text: "다음 주 월요일부터 다음 주 수요일까지 못 갑니다.", category: "absence", events: ["2026-10-05:absence", "2026-10-06:absence", "2026-10-07:absence"] },
  { id: "a18", context: "강사: 내일 결석 처리해드릴까요?", text: "네 그렇게 해주세요.", category: "absence", events: ["2026-10-03:absence"] },
  { id: "a19", text: "오늘 수학은 정상 출석하고 영어만 결석합니다.", category: "absence", events: ["2026-10-02:absence"] },
  { id: "a20", text: "10월 5일은 빠지지 않고 8일만 쉽니다.", category: "absence", events: ["2026-10-08:absence"] },
  { id: "a21", text: "내일 상태 봐서 결석할 수도 있는데 확정되면 다시 연락드릴게요.", category: "unclear", events: [], review: true },
  { id: "a22", text: "오늘부터 3일 동안 결석합니다.", category: "absence", events: ["2026-10-02:absence", "2026-10-03:absence", "2026-10-04:absence"], review: true },
  { id: "a23", text: "12월 31일부터 1월 2일까지 결석합니다.", base: "2026-12-29", category: "absence", events: ["2026-12-31:absence", "2027-01-01:absence", "2027-01-02:absence"] },
  { id: "a24", text: "내일 결석한다고 썼는데 아니에요. 모레 결석입니다.", category: "absence", events: ["2026-10-04:absence"] },
];
const eventTypes = ["absence", "late", "early_leave"];
const categoryCriteria = {
  absence: "앞으로 수업에 빠진다는 통보. 과거 설명·가정·가능성·취소된 결석은 제외.",
  late: "앞으로 수업에 늦게 온다는 통보. 결석을 부정하고 지각을 통보하면 이것.",
  early_leave: "앞으로 수업 중간에 일찍 떠난다는 통보.",
  mixed: "새로 유효한 출결 통보 중 결석·지각·조퇴가 서로 다른 날짜나 과목에 둘 이상 공존함.",
  correction: "기존 결석·지각·조퇴를 취소하고 정상 등원한다고만 정정함. 다른 날의 새 결석도 있으면 absence.",
  none: "새 출결 통보 없음. 인사·지난 일 설명·보강 문의·차량만 변경.",
  unclear: "결석할 수도 있다는 조건부 가능성뿐이거나 내용이 불충분하여 새 출결이 확정되지 않음.",
};
type Candidate = { id: string; literal: string; date: string | null; offset: number };
function plusDays(iso: string, n: number) { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function candidates(text: string, base: string): Candidate[] {
  const baseObj = new Date(`${base}T00:00:00Z`);
  let year = baseObj.getUTCFullYear(), month = baseObj.getUTCMonth() + 1;
  const out: Candidate[] = [];
  const regex = /(?:이번\s*주|다음\s*주)\s*[월화수목금토일]요일|오늘|내일|모레|(?:(\d{1,2})\s*월\s*)?(\d{1,2})\s*일/g;
  for (const m of text.matchAll(regex)) {
    const literal = m[0];
    let date: string | null = null;
    if (["오늘", "내일", "모레"].includes(literal)) date = plusDays(base, ["오늘", "내일", "모레"].indexOf(literal));
    else if (literal.includes("요일")) {
      const weekday = "월화수목금토일".indexOf(literal.match(/([월화수목금토일])요일/)![1]);
      const mondayOffset = -((baseObj.getUTCDay() + 6) % 7);
      date = plusDays(base, mondayOffset + weekday + (literal.startsWith("다음") ? 7 : 0));
    } else {
      // '3일 동안' is a duration, not a day-of-month; unsupported durations are reviewed below.
      if (!m[1] && /^\s*(동안|간\b)/.test(text.slice(m.index! + literal.length))) continue;
      if (m[1]) { const nextMonth = Number(m[1]); if (month === 12 && nextMonth === 1) year++; month = nextMonth; }
      const day = Number(m[2]);
      const value = new Date(Date.UTC(year, month - 1, day));
      if (value.getUTCFullYear() === year && value.getUTCMonth() + 1 === month && value.getUTCDate() === day) date = value.toISOString().slice(0,10);
    }
    out.push({ id: `d${out.length}`, literal, date, offset: m.index! });
  }
  return out;
}
const scope = `${FACT_GUARD}\n한국 학원의 최신 학부모 댓글을 읽는다. previous_context는 최신 답이 생략한 의미를 풀 때만 사용한다. 이전 요청이 취소되면 취소된 요청은 통보로 세지 않는다. 날짜 계산은 하지 않고 문장에 쓰인 표현의 역할만 판단한다.`;
if (!process.argv.includes("--run")) throw new Error("Explicit --run required.");
const apiKey = process.env.TYPESAFE_API_KEY;
if (!apiKey) throw new Error("TYPESAFE_API_KEY missing.");
type Question = { type: "choice"; instructions: string; criteria: Record<string, string> } | { type: "noul"; instructions: string };
type ChoiceAnswer = { type: "choice"; choice: string; confidence: number; probabilities: Record<string, number> };
type NoulAnswer = { type: "noul"; noul: number };
type Answers = Record<string, ChoiceAnswer | NoulAnswer> & { category: ChoiceAnswer; continuous: NoulAnswer };
type AttendanceResult = Case & {
  candidates: Candidate[]; predictedCategory: string; predictedEvents: string[];
  categoryCorrect: boolean; datesCorrect: boolean; needsReview: boolean; expectedReview: boolean;
  latencyMs: number; answers: Answers; usage?: { input_tokens?: number };
};
const results: AttendanceResult[] = [];
let next = 0;
async function worker() {
  while (next < cases.length) {
    const c = cases[next++];
    const source = `${c.context ? `${c.context}\n` : ""}${c.text}`;
    const found = candidates(source, c.base ?? baseDate);
    const questions: Record<string, Question> = {
      category: { type: "choice", instructions: `${scope}\n현재 유효한 출결 통보 종류는?`, criteria: categoryCriteria },
      continuous: { type: "noul", instructions: `${scope}\n최신 연락은 두 날짜 사이 모든 날에 같은 출결 통보가 적용되는 연속 기간을 명시하는가? '부터~까지'는 그렇다. 날짜를 '와/과/및/쉼표'로 나열하거나 정상 등원일 예외가 있으면 아니다.` },
    };
    for (const candidate of found) {
      questions[candidate.id] = { type: "choice", instructions: `${scope}\n원문 source_text에서 위치 ${candidate.offset}의 '${candidate.literal}'가 가리키는 날짜에 현재 유효한 출결 통보는? 선택은 이 날짜에만 해당해야 한다. 보강 요청일·취소된 결석일·정상 등원일·확정되지 않은 가정은 none. 앞의 날짜가 '~부터'이고 뒤의 날짜가 '~까지'면 시작과 끝 둘 다 그 통보에 해당한다.`, criteria: { absence: categoryCriteria.absence, late: categoryCriteria.late, early_leave: categoryCriteria.early_leave, none: "이 날짜는 확정된 새 결석·지각·조퇴에 해당하지 않음." } };
    }
    const start = performance.now();
    const response = await fetch("https://api.typesafe.ai/v1/systemone", {
      method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "jev-1.13.0", state: { source_text: source, latest_parent_comment: c.text, previous_context: c.context ?? null }, questions }),
      signal: AbortSignal.timeout(25000),
    });
    if (!response.ok) throw new Error(`TypeSafe HTTP ${response.status}`);
    const data = await response.json();
    const answers = data.answers as Answers;
    for (const [key, question] of Object.entries(questions)) {
      const answer = answers?.[key];
      if (question.type === "choice" && (answer?.type !== "choice" || !(answer.choice in question.criteria) || typeof answer.confidence !== "number")) throw new Error(`Invalid choice ${key}`);
      if (question.type === "noul" && (answer?.type !== "noul" || typeof answer.noul !== "number")) throw new Error(`Invalid noul ${key}`);
    }
    const dateChoice = (id: string) => (answers[id] as ChoiceAnswer).choice;
    const selected = found.filter(d => d.date && eventTypes.includes(dateChoice(d.id)));
    const events = new Set(selected.map(d => `${d.date}:${dateChoice(d.id)}`));
    const confidenceReview = Object.values(answers).some(a => a.type === "choice" && a.confidence < 0.8);
    const parserReview = found.some(d => !d.date) || (eventTypes.includes(answers.category.choice) && found.length === 0) || /\d+일\s*(동안|간)/.test(source);
    if (answers.continuous.noul >= 0.5 && selected.length === 2 && dateChoice(selected[0].id) === dateChoice(selected[1].id)) {
      const [first, last] = selected.map(d => d.date!).sort();
      const days = Math.round((Date.parse(last) - Date.parse(first)) / 86400000);
      if (days >= 0 && days <= 90) for (let i = 0; i <= days; i++) events.add(`${plusDays(first, i)}:${dateChoice(selected[0].id)}`);
    }
    const actualEvents = [...events].sort();
    const categoryCorrect = answers.category.choice === c.category;
    const datesCorrect = JSON.stringify(actualEvents) === JSON.stringify([...c.events].sort());
    const needsReview = confidenceReview || parserReview || answers.category.choice === "unclear" || answers.category.choice === "correction" || answers.category.choice === "mixed" || (answers.continuous.noul > 0.2 && answers.continuous.noul < 0.8);
    const result = { ...c, candidates: found, predictedCategory: answers.category.choice, predictedEvents: actualEvents, categoryCorrect, datesCorrect, needsReview, expectedReview: c.review ?? false, latencyMs: Math.round(performance.now() - start), answers, usage: data.usage };
    results.push(result);
    console.log(JSON.stringify({ id: c.id, categoryCorrect, datesCorrect, needsReview }));
  }
}
await Promise.all([worker(), worker(), worker()]);
results.sort((a,b) => a.id.localeCompare(b.id));
const timings = results.map(r => r.latencyMs).sort((a,b)=>a-b);
const inputTokens = results.reduce((n,r)=>n+(r.usage?.input_tokens ?? 0),0);
const summary = {
  dataset: "24 synthetic cases; date parser prototype, not production integration; no DeepSeek calls",
  count: results.length, categoryCorrect: results.filter(r=>r.categoryCorrect).length,
  datesCorrect: results.filter(r=>r.datesCorrect).length,
  exactMatch: results.filter(r=>r.categoryCorrect && r.datesCorrect).length,
  review: results.filter(r=>r.needsReview).length,
  wrongWithoutReview: results.filter(r=>!r.needsReview && (!r.categoryCorrect || !r.datesCorrect)).map(r=>r.id),
  p50Ms: timings[Math.floor(timings.length*.5)], p95Ms: timings[Math.ceil(timings.length*.95)-1],
  inputTokens, estimatedUsdAtPublishedRate: inputTokens * .042 / 1_000_000,
};
await mkdir("output/jev-classnote", { recursive: true });
await writeFile("output/jev-classnote/attendance.json", JSON.stringify({createdAt:new Date().toISOString(),summary,results},null,2)+"\n");
console.log(JSON.stringify(summary,null,2));
