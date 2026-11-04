/**
 * 업무 비서 'AI로 정리' — 같은 후보에서 순서와 이유만 다시 쓴다. 프롬프트 · 후검증 · 저장 모양(서버·클라 공용 · 순수 · Vitest).
 * 🔴 AI는 후보의 `ref`로만 가리킨다 — 누를 단추와 대상 학생은 후보가 정한다(AI가 명단을 만들지 않는다).
 * 후검증 = 모르는 ref 버림 · 자료에 없는 숫자 · 영문 · 선생님 이름이 든 문장은 그 줄만 자동 문장으로 되돌림(옛 브리핑 `validateTeamReport`와 같은 결).
 */
import { headlineOf, type Candidate, type SecretaryBrief, type SecretaryPlan, type SecretaryStep } from "./secretary-plan";

export type SecretaryInput = {
  today: string; weekday: string; day: number;
  candidates: { ref: string; title: string; why: string; count: number; facts: string[]; act: Candidate["action"]["kind"] }[];
  delegated: string[];
  names: string[];
};
/** 저장한 정리 — `counts` = 정리할 때의 후보별 수(그 뒤 바뀐 것을 알린다) · `runKind` = 직접 누름 · 예약(01:00 · 13:00) · `basisAt` = 숫자 기준 시각. */
export type RunKind = "button" | "schedule";
export type SecretaryNote = { at: string; model: string | null; plan: SecretaryPlan; counts: Record<string, number>; replaced: number; runKind: RunKind; basisAt: string | null };
/** 오늘 돌린 정리(시각 · 종류) — 화면이 '언제 돌렸는지'를 남긴다(원장 2026-11-02). */
export type SecretaryRun = { at: string; runKind: RunKind };
/** 예약 시각(KST) — 원장 2026-11-02 *"새벽 1시에 한번, 오후 1시에 한번"*. 크론(vercel.json)과 화면 안내가 이 값을 쓴다. */
export const SCHEDULE_HOURS = [1, 13] as const;
/** 프롬프트의 '오늘' — 예약 실행은 실행한 날, 숫자는 화면이 남긴 시각 기준. */
export type AsOf = { today: string; weekday: string; day: number; basis: string };

/**
 * 후보 검증 상한 — 서버 검증(`secretary-schema`)이 같은 값을 쓴다. 화면이 후보를 만들 때부터 이 안으로 자른다
 * (검토할 업무 요청이 21건이면 근거 줄이 21줄이 되어 'AI로 정리' · 마지막 후보 남기기가 400으로 함께 멈췄다).
 */
export const INPUT_LIMITS = { candidates: 20, facts: 20, delegated: 20, names: 1000, title: 160, why: 400, line: 400, name: 60, count: 1_000_000 } as const;
const cut = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
/** 표에 남는 후보 크기(바이트) 상한 — 표 제약은 200,000바이트인데 jsonb 글자는 쉼표 · 콜론 뒤에 띄어쓰기가 붙어 조금 더 크다. */
export const INPUT_BYTES = 180_000;
export const inputBytes = (input: unknown) => new TextEncoder().encode(JSON.stringify(input)).length;
/** 바이트를 넘으면 차례로 줄인다 — [근거 줄 수, 이름 수]. 이름 목록부터, 다음은 근거 줄. 마지막 칸이면 늘 들어간다. */
const FITS = [[INPUT_LIMITS.facts, INPUT_LIMITS.names], [INPUT_LIMITS.facts, 200], [10, 200], [5, 100], [2, 50], [0, 0]] as const;
/** 줄 목록을 상한 안으로 — 넘치면 마지막 줄을 '외 N건'으로(무엇이 빠졌는지 수는 남긴다). */
function capLines(list: readonly string[], max: number): string[] {
  if (max <= 0) return [];
  const lines = list.map((t) => cut(t, INPUT_LIMITS.line));
  return lines.length > max ? [...lines.slice(0, max - 1), `외 ${(lines.length - max + 1).toLocaleString("ko-KR")}건`] : lines;
}

export function secretaryInput(brief: SecretaryBrief, today: string, weekday: string, day: number): SecretaryInput {
  const d = brief.delegated;
  // 후보가 상한보다 많으면 우선순위가 낮은 것부터 뺀다(순서는 그대로).
  const kept = new Set([...brief.candidates].sort((a, b) => b.priority - a.priority).slice(0, INPUT_LIMITS.candidates).map((c) => c.ref));
  const delegated = capLines([
    ...(d.waiting ? [`보고를 기다리는 요청 ${d.waiting}건`] : []),
    ...d.late.map((l) => `기한 지난 요청: ${l.title} · 보고 안 함 ${l.missing.join(" · ") || "—"}`),
    ...(d.review.length ? [`내가 검토할 요청 ${d.review.length}건`] : []),
  ], INPUT_LIMITS.delegated);
  const names = brief.names.filter((n) => n.length <= INPUT_LIMITS.name);
  const build = (facts: number, nameCount: number): SecretaryInput => ({
    today, weekday, day,
    candidates: brief.candidates.filter((c) => kept.has(c.ref)).map(({ ref, title, why, count, facts: lines, action }) => ({
      ref, title: cut(title, INPUT_LIMITS.title), why: cut(why, INPUT_LIMITS.why), count: Math.min(Math.max(0, Math.round(count)), INPUT_LIMITS.count),
      facts: capLines(lines, facts), act: action.kind,
    })),
    delegated, names: names.slice(0, nameCount),
  });
  let input = build(FITS[0][0], FITS[0][1]);
  for (const [facts, nameCount] of FITS.slice(1)) {
    if (inputBytes(input) <= INPUT_BYTES) break;
    input = build(facts, nameCount);
  }
  return input;
}

/** AI가 받는 [후보] · [맡긴 업무] — 둘이 같으면 같은 정리다(이름 목록은 견주지 않는다). 화면의 '다시 남기기' · 예약의 '같은 후보 건너뛰기'가 같은 값을 쓴다. */
export const inputKey = (input: Pick<SecretaryInput, "candidates" | "delegated">) =>
  JSON.stringify([input.candidates.map((c) => [c.ref, c.title, c.why, c.count, c.facts, c.act]), input.delegated]);

const ACTION_TEXT: Record<Candidate["action"]["kind"], string> = { request: "담당자에게 업무 요청", detail: "명단 열어 보기", tasks: "할 일 창에서 처리", work: "업무 요청 열기", link: "그 화면 열기" };

export function buildSecretaryPrompt(input: SecretaryInput, asOf?: AsOf): string {
  const now = asOf ?? { today: input.today, weekday: input.weekday, day: input.day, basis: "" };
  return [
    "당신은 학원 원장의 업무 비서입니다. 아래 [후보]는 오늘 학원에서 챙길 일을 시스템이 이미 계산한 것입니다.",
    "이 자료만 근거로, 원장이 오늘 무엇부터 처리하면 되는지 순서를 정하고 이유를 적어 JSON으로만 답하세요.",
    "",
    "규칙:",
    "- 숫자를 다시 읽어 주는 보고가 아니라 '무엇부터 · 누구에게 맡길지 · 왜 지금인지'를 말한다.",
    "- steps는 오늘 먼저 할 순서대로 3~5개. ref는 [후보]에 있는 ref만 쓰고 같은 ref를 두 번 쓰지 않는다.",
    "- title은 25자 안팎의 할 일 문장(예: '겹친 학생을 담임에게 맡기기'). why는 1~2문장 — 그 순서인 이유를 자료의 사실(학생 이름 · 날짜 · 횟수 · 사람)로 적는다.",
    "- 서로 이어지는 신호를 짚는다: 같은 학생이 결석과 숙제에 함께 나오면 그 학생을, 한 사람에게 일이 몰렸으면 그 사람을 먼저.",
    "- later에는 오늘 미뤄도 되는 후보와 그 이유를 0~3개(steps에 쓴 ref는 쓰지 않는다).",
    "- 자료에 없는 숫자 · 이름 · 날짜 · 영어 단어를 쓰지 않는다. '확인할 수 없다'류의 문장은 쓰지 않는다. 존댓말.",
    "- headline은 원장에게 건네는 한두 문장 요약(80자 안팎).",
    '- 형식: {"headline":"...","steps":[{"ref":"...","title":"...","why":"..."}],"later":[{"ref":"...","why":"..."}]}',
    "",
    `[오늘] ${now.today}(${now.weekday}) · 이번 달 ${now.day}일째${now.basis ? ` · 아래 숫자는 ${now.basis} 기준` : ""}`,
    "",
    "[후보]",
    ...input.candidates.flatMap((c) => [`ref=${c.ref} · ${c.title} · 처리: ${ACTION_TEXT[c.act] ?? ACTION_TEXT.detail}`, `  자동 이유: ${c.why}`, ...c.facts.map((f) => `  - ${f}`)]),
    ...(input.delegated.length ? ["", "[맡긴 업무]", ...input.delegated.map((l) => `- ${l}`)] : []),
  ].join("\n");
}

const STOP = new Set(["담임", "담당", "각", "두", "세", "네", "여러", "해당", "다른", "모든", "같은", "그", "이", "영어", "수학", "원어민", "반"]);

/** 자료에서 나온 숫자 · 영문 · 이름만 쓸 수 있다. 1~5는 '세 가지'류 순번이라 허용. */
function checker(input: SecretaryInput) {
  const raw = JSON.stringify(input);
  const numbers = new Set([...(raw.match(/\d+/g) ?? []).map((n) => String(Number(n))), "1", "2", "3", "4", "5"]);
  const words = new Set((raw.match(/[A-Za-z]{2,}/g) ?? []).map((w) => w.toLowerCase()));
  return (text: string): boolean => {
    if ((text.match(/\d+/g) ?? []).some((n) => !numbers.has(String(Number(n))))) return false;
    if ((text.match(/[A-Za-z]{2,}/g) ?? []).some((w) => !words.has(w.toLowerCase()))) return false;
    for (const m of text.matchAll(/([가-힣]{1,4})\s?선생님/g)) {
      const token = m[1]!;
      if (!STOP.has(token) && !input.names.some((n) => n.includes(token))) return false;
    }
    return true;
  };
}

const str = (v: unknown, min: number, max: number) => (typeof v === "string" && v.trim().length >= min && v.trim().length <= max ? v.trim() : null);

/** AI 답 → 정리. 모르는 ref는 버리고, 걸린 문장은 그 줄만 자동 문장으로. 쓸 단계가 하나도 없으면 null. */
export function groundSecretary(raw: unknown, input: SecretaryInput): { plan: SecretaryPlan; replaced: number } | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { headline?: unknown; steps?: unknown; later?: unknown };
  const ok = checker(input);
  const byRef = new Map(input.candidates.map((c) => [c.ref, c]));
  let replaced = 0;
  const steps: SecretaryStep[] = [];
  for (const s of Array.isArray(r.steps) ? r.steps.slice(0, 6) : []) {
    const item = (s ?? {}) as { ref?: unknown; title?: unknown; why?: unknown };
    const ref = typeof item.ref === "string" ? item.ref.trim() : "";
    const c = byRef.get(ref);
    if (!c || steps.some((x) => x.ref === ref)) continue;
    const title = str(item.title, 2, 60);
    const why = str(item.why, 5, 260);
    if (title && why && ok(title) && ok(why)) steps.push({ ref, title, why });
    else { replaced += 1; steps.push({ ref, title: c.title, why: c.why }); }
  }
  if (!steps.length) return null;
  const later = (Array.isArray(r.later) ? r.later.slice(0, 3) : []).flatMap((l) => {
    const item = (l ?? {}) as { ref?: unknown; why?: unknown };
    const ref = typeof item.ref === "string" ? item.ref.trim() : "";
    const why = str(item.why, 5, 200);
    return byRef.has(ref) && !steps.some((s) => s.ref === ref) && why && ok(why) ? [{ ref, why }] : [];
  });
  const headline = str(r.headline, 5, 160);
  const headOk = !!headline && ok(headline);
  if (!headOk) replaced += 1;
  return { plan: { headline: headOk ? headline! : headlineOf(steps), steps, later }, replaced };
}

/** 정리한 뒤 바뀐 후보 — `반복 결석 학생 23 → 25`. 새로 생긴 후보도 알린다. */
export function changedSince(note: Pick<SecretaryNote, "counts">, candidates: readonly Pick<Candidate, "ref" | "title" | "count">[]): string[] {
  // 사람 단계는 같은 값을 사람으로 다시 묶은 것 — 순위가 바뀌면 '새로 생김'으로 보이기만 해서 뺀다.
  return candidates.filter((c) => !c.ref.startsWith("person:")).flatMap((c) => {
    const before = note.counts[c.ref];
    if (before === undefined) return [`새로 생김: ${c.title}`];
    return before === c.count ? [] : [`${c.title.replace(/\s[\d,]+[명건]$/, "")} ${before.toLocaleString("ko-KR")} → ${c.count.toLocaleString("ko-KR")}`];
  });
}

/** 시각 표기(KST) — 오늘이면 `오늘 09:12`, 아니면 `11/2 21:10`. 숫자 기준 · 돌린 시각이 같은 글. */
export function basisText(iso: string, today: string): string {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  const time = `${p.hour === "24" ? "00" : p.hour}:${p.minute}`;
  return `${p.year}-${p.month}-${p.day}` === today ? `오늘 ${time}` : `${Number(p.month)}/${Number(p.day)} ${time}`;
}

/** 정리 출처 한 줄 — `AI 정리 · 13:00 예약 · 숫자 기준 오늘 09:12`(예약은 화면이 남긴 후보로 정리해서 두 시각이 다르다). */
export function noteSource(note: Pick<SecretaryNote, "at" | "runKind" | "basisAt">, today: string): string {
  const at = basisText(note.at, today).replace(/^오늘 /, "");
  const basis = note.runKind === "schedule" && note.basisAt ? ` · 숫자 기준 ${basisText(note.basisAt, today)}` : "";
  return `AI 정리 · ${at} ${note.runKind === "schedule" ? "예약" : "직접"}${basis}`;
}
