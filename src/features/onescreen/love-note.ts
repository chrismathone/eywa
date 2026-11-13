/**
 * 사랑의 한마디 **초안** — 순수 규칙(Vitest). 서버 액션(server/love-note-actions.ts)과 화면 버튼이 같은 모양을 쓴다.
 *
 * 원장 2026-10-28 *"사랑의 한마디도 선생님이 그러면 자주 적고 하는 걸로 학습하고 수정은 어떻게 하는지도 그에 맞게
 * 초안 작성 버튼 따로 눌러서 넣어지게"* — 10-26의 '선생님이 직접'은 풀었다(초안은 **버튼을 누를 때만** 칸에 들어가고,
 * 선생님이 고쳐서 보낸다). '매크로성 반복 금지'(10-26)는 그대로 — 이 학생에게 최근 보낸 한마디를 되풀이하지 않게 한다.
 *
 * 🔑 재료 = 그날 화면에 입력된 사실뿐(태도·테스트·숙제·진도·이해도(선생님이 매긴 것만)·출결 문장). 지난 한마디는 **말투 예시**,
 *    AI 초안 ↔ 선생님이 실제로 보낸 글 쌍은 **고치는 습관** 예시다 — 사실의 출처가 아니다(프롬프트가 그렇게 말한다).
 * 🔑 예시 글의 학생 이름은 `○○`로 가린다 — 다른 학생 이름이 이 학생 글에 새지 않게. 생성 뒤에도 한 번 더 본다(`checkLoveNote`).
 */
import { hasMentLeak } from "./ment-leak";

export const LOVE_NOTE_HEAD = "■ 사랑의 한마디";

/** 화면이 보내는 그날의 사실 — 서버가 길이를 자른다(`sanitizeLoveNoteFacts`). */
export type LoveNoteFacts = {
  attitude?: string;
  /** "20문제 중 18개 맞음" · "시험 없음" 같은 화면 표기 그대로. */
  dailyTest?: string;
  /** 지난 숙제 완성도("90%"·"미제출"). */
  homework?: string;
  /** 오늘 진도(소단원 이름들). */
  progress?: string;
  /** 선생님이 **매긴** 이해도만(기본값 10은 싣지 않는다 — 안 매긴 값을 사실로 쓰지 않게). */
  understanding?: { title: string; level: string }[];
  /** 출결 한 줄(지각·결석·보강 문장). */
  attendance?: string;
};

const clip = (v: unknown, max: number): string =>
  typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "";

export function sanitizeLoveNoteFacts(raw: unknown): LoveNoteFacts {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const understanding = Array.isArray(r.understanding)
    ? r.understanding
        .map((u) => {
          const o = (u && typeof u === "object" ? u : {}) as Record<string, unknown>;
          return { title: clip(o.title, 80), level: clip(o.level, 20) };
        })
        .filter((u) => u.title && u.level)
        .slice(0, 12)
    : [];
  return {
    attitude: clip(r.attitude, 40),
    dailyTest: clip(r.dailyTest, 80),
    homework: clip(r.homework, 40),
    progress: clip(r.progress, 300),
    understanding,
    attendance: clip(r.attendance, 300),
  };
}

export function hasLoveNoteFacts(f: LoveNoteFacts): boolean {
  return !!(f.attitude || f.dailyTest || f.homework || f.progress || f.understanding?.length || f.attendance);
}

/** 이해도 점수(10·7·4) → 말. 화면 버튼과 같은 세 단계. */
export function understandingLevelWord(score: number): string {
  return score >= 10 ? "잘 이해함" : score >= 7 ? "보통" : "어려워함";
}

/** 보고서 글에서 사랑의 한마디 항목 본문만. 항목이 없으면 null. */
export function extractLoveNote(notes: string | null | undefined): string | null {
  if (!notes) return null;
  const i = notes.indexOf(LOVE_NOTE_HEAD);
  if (i < 0) return null;
  const rest = notes.slice(i + LOVE_NOTE_HEAD.length).replace(/^[^\n]*\n?/, "");
  const end = rest.search(/\n■/);
  const body = (end < 0 ? rest : rest.slice(0, end)).trim();
  return body || null;
}

/**
 * 가릴 이름 조각 — 전체 이름 + 세 글자 이름이면 성을 뗀 두 글자(선생님들이 "지아 멋집니다"처럼 쓴다).
 * 끝의 구분 알파벳(`이다윤A`)은 떼고 본다. 두 글자 미만은 가리지 않는다(흔한 낱말을 지우게 된다).
 */
export function nameTokens(name: string): string[] {
  const n = name.trim().replace(/[A-Za-z]+$/, "").trim();
  if (n.length < 2) return [];
  const out = [n];
  if (n.length === 3) out.push(n.slice(1));
  return out;
}

export function maskNames(text: string, names: readonly string[]): string {
  const tokens = [...new Set(names.flatMap(nameTokens))].sort((a, b) => b.length - a.length);
  let out = text;
  for (const t of tokens) out = out.split(t).join("○○");
  return out;
}

/** 같은 말인가 — 공백·문장부호 차이는 같다로 본다. */
const squash = (s: string) => s.replace(/[\s.,!?~·…'"“”‘’()]/g, "");

export type LoveNoteSuggestionRow = { studentId: string; reportDate: string; subject: string; aiNote: string };
export type LoveNoteFinalRow = { studentId: string; reportDate: string; subject: string; note: string | null };

/** AI 초안 ↔ 실제로 보낸 한마디 쌍 — 선생님이 **고친** 것만(그대로 보냈거나 비운 것은 습관 재료가 아니다). */
export function pairLoveNoteEdits(
  suggestions: readonly LoveNoteSuggestionRow[],
  finals: readonly LoveNoteFinalRow[],
  limit = 10,
): { ai: string; sent: string }[] {
  const byKey = new Map(finals.map((f) => [`${f.studentId}|${f.reportDate}|${f.subject}`, f.note]));
  const out: { ai: string; sent: string }[] = [];
  for (const s of suggestions) {
    const sent = byKey.get(`${s.studentId}|${s.reportDate}|${s.subject}`)?.trim();
    if (!sent || squash(sent) === squash(s.aiNote)) continue;
    out.push({ ai: s.aiNote.trim(), sent });
    if (out.length >= limit) break;
  }
  return out;
}

/** 사실 블록 — 프롬프트에 그대로 싣는다. 빈 줄은 뺀다. */
export function loveNoteFactLines(f: LoveNoteFacts): string[] {
  return [
    f.attitude ? `수업 태도: ${f.attitude}` : "",
    f.dailyTest ? `일일 테스트: ${f.dailyTest}` : "",
    f.homework ? `지난 숙제 완성도: ${f.homework}` : "",
    f.progress ? `오늘 진도: ${f.progress}` : "",
    f.understanding?.length ? `이해도: ${f.understanding.map((u) => `${u.title}(${u.level})`).join(", ")}` : "",
    f.attendance ? `출결: ${f.attendance}` : "",
  ].filter(Boolean);
}

export function buildLoveNotePrompt(p: {
  studentName: string;
  facts: LoveNoteFacts;
  /** 이 선생님이 보낸 한마디(이름 가림) — 말투 예시. */
  examples: readonly string[];
  /** 이 학생에게 최근 보낸 한마디 — 되풀이 금지. */
  recentToStudent: readonly string[];
  /** AI 초안 → 선생님이 고쳐 보낸 글(이름 가림). */
  editPairs: readonly { ai: string; sent: string }[];
}): string {
  const given = nameTokens(p.studentName)[1] ?? nameTokens(p.studentName)[0] ?? p.studentName;
  const lines = [
    "학원 수업보고서 맨 끝의 '사랑의 한마디'(선생님이 학부모께 보내는 학생 응원 한마디)의 초안을 쓴다. 선생님이 읽고 고쳐서 보낸다.",
    "",
    "[규칙]",
    "- 1~3문장, 존댓말. 아래 선생님 예시의 말투·길이·자주 쓰는 표현·학생을 부르는 방식을 따른다.",
    `- 학생 이름은 '${p.studentName}'(선생님이 이름만 부르면 '${given}')이다. 다른 이름은 쓰지 않는다. 예시의 '○○'는 다른 학생이다.`,
    "- 내용의 근거는 [오늘 사실]뿐이다. 응원·격려는 해도 되지만, 사실에 없는 행동·태도·감정·관찰·약속·계획을 지어내지 않는다.",
    "- [오늘 사실]에 없는 숫자를 쓰지 않는다. 점수·퍼센트를 그대로 되풀이하지 말고 말로 칭찬하거나 격려한다.",
    "- 사실이 좋지 않으면(태도 안좋음·미제출·어려워함) 꾸짖지 말고 다음을 응원하는 말로 쓴다.",
    "- [최근 이 학생에게 보낸 한마디]와 같은 문장·같은 틀을 되풀이하지 않는다.",
    "- 예시 글과 고친 글은 말투 참고일 뿐 사실이 아니다. 그 안의 내용을 가져오지 않는다.",
    "",
    "[오늘 사실]",
    ...loveNoteFactLines(p.facts),
  ];
  if (p.examples.length) lines.push("", "[이 선생님이 쓴 사랑의 한마디 예시]", ...p.examples.map((e) => `- ${e.replace(/\s*\n\s*/g, " ")}`));
  if (p.editPairs.length)
    lines.push(
      "",
      "[AI 초안을 이 선생님이 이렇게 고쳐 보냈다 — 고치는 습관을 따른다]",
      ...p.editPairs.map((e) => `- 초안: ${e.ai.replace(/\s*\n\s*/g, " ")}\n  보냄: ${e.sent.replace(/\s*\n\s*/g, " ")}`),
    );
  if (p.recentToStudent.length)
    lines.push("", "[최근 이 학생에게 보낸 한마디 — 되풀이 금지]", ...p.recentToStudent.map((e) => `- ${e.replace(/\s*\n\s*/g, " ")}`));
  lines.push("", '응답은 JSON 하나: {"note": "사랑의 한마디 초안"}');
  return lines.join("\n");
}

export function parseLoveNote(data: unknown): string | null {
  const o = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const note = typeof o.note === "string" ? o.note.trim() : "";
  if (!note) return null;
  // 모델이 항목 제목을 같이 써 보내면 뗀다(칸에는 본문만 들어간다).
  return note.replace(/^■?\s*사랑의 한마디\s*[:：]?\s*/, "").trim().slice(0, 500) || null;
}

/**
 * 생성 뒤 검사 — ① 사실에 없는 숫자 ② 다른 학생 이름(예시에 나온 이름 · 이 학생 이름 조각은 제외). 걸리면 쓰지 않는다.
 * 숫자는 자릿수 묶음 단위로 본다("18개"의 18이 사실 줄 어딘가에 있으면 통과).
 */
export function checkLoveNote(
  note: string,
  p: { facts: LoveNoteFacts; studentName: string; otherNames: readonly string[] },
): { ok: true } | { ok: false; reason: "number" | "name" | "leak" } {
  // 혼잣말·지시 되받기·글자 그대로의 줄바꿈 기호가 든 초안은 쓰지 않는다(원장 2026-11-12, `ment-leak.ts`).
  if (/\\[nrt]/.test(note) || note.split(/(?<=[.!?])\s+|\n/).some((sen) => hasMentLeak(sen))) return { ok: false, reason: "leak" };
  const factText = loveNoteFactLines(p.facts).join(" ");
  const factNums = new Set(factText.match(/\d+/g) ?? []);
  for (const n of note.match(/\d+/g) ?? []) if (!factNums.has(n)) return { ok: false, reason: "number" };
  const mine = new Set(nameTokens(p.studentName));
  const others = [...new Set(p.otherNames.flatMap(nameTokens))].filter((t) => !mine.has(t) && ![...mine].some((m) => m.includes(t)));
  // 세 글자 전체 이름은 그대로, 두 글자(성 뗀 이름)는 **부르는 꼴**일 때만 — '하나도'·'수진하게' 같은 낱말을 이름으로 오인하지 않게.
  const esc = (t: string) => t.replace(/[.*+?^$|()[\]{}\\]/g, "\\$&");
  const hit = (t: string) => (t.length >= 3 ? note.includes(t) : new RegExp(esc(t) + "(?=[이가는은를을의야아,.!\\s]|$)").test(note));
  if (others.some(hit)) return { ok: false, reason: "name" };
  return { ok: true };
}
