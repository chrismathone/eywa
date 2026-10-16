// 강사별 **멘트 말투 프로파일** — 순수(Vitest). 0262a `teacher_ment_styles`.
//
// 왜 있나(원장 2026-08-18 → 착수 2026-09-12): 0214a가 "직접 쓴 멘트"(manual)·"자동작성 후 고친 멘트"(auto_edited)를 강사별로
// 모아 두는데 읽는 곳이 없었다. 이 모듈이 코퍼스를 **접는 규칙**(표본 · 지문 · AI 응답 검증 · 프롬프트 지침)을 한 벌로 든다 —
// 서버(빌드·읽기)·cron·화면이 같은 규칙을 쓴다. 프롬프트 두 쪽(프로파일을 **만드는** 것 · 자동작성에 **붙이는** 지침)은 ./ment-style-prompt.ts.
// 🔴 말투만 옮긴다 — 내용(학생 이름·점수·진도·날짜)은 안 된다. 응답은 `profileMentionsAny`(성 뺀 이름·조사 꼴까지)로 걸러 새면 저장 안 함.
// 🔴 표본이 적으면 만들지 않는다(MIN). 🔴 표본은 manual + auto_edited **둘 다**(원장 2026-09-12; 수정본 자리 20건 먼저, 프롬프트엔 manual이 앞).
// 🔴 영어 행은 코퍼스 밖 — 영어 자동작성은 템플릿 모드(`generateEnglishMent`)라 프로파일을 읽지 않는다(넣으면 수학 말투 오염 + 거짓 안내).
import { withoutAttachmentLines } from "@/features/report-templates/attachment-lines";
import { stripImageSlots } from "@/features/report-templates/image-slots";
import { AFTER_GIVEN, studentNameVariants } from "@/features/report-templates/name-mention";

/** 이보다 표본이 적으면 프로파일을 만들지 않는다(기존 프로파일이 있으면 그대로 둔다). */
export const MENT_STYLE_MIN_SAMPLES = 12;
/** 프로파일을 만들 때 AI에 싣는 표본 상한. */
export const MENT_STYLE_MAX_SAMPLES = 60;
/** 그중 자동작성 후 수정 멘트에 **먼저 확보하는** 자리 — 직접 작성이 많아도 "둘 다"가 성립하게. */
export const MENT_STYLE_MAX_EDITED = 20;
/** 코퍼스 창(일) — 오래된 말투보다 요즘 말투. */
export const MENT_STYLE_WINDOW_DAYS = 120;
/** 이보다 짧은 조각("완료"·"오답")은 말투라 할 게 없다. */
export const MENT_STYLE_MIN_CHARS = 8;
/** 코퍼스에서 빼는 과목 키 — 그 과목의 자동작성이 프로파일을 읽지 않는다(영어 = 템플릿 모드, 0260a). */
export const MENT_STYLE_EXCLUDED_SUBJECTS: readonly string[] = ["english"];

export type StyleSampleSource = "manual" | "auto_edited";

export type StyleSampleRow = {
  id: string;
  notes: string | null | undefined;
  source: StyleSampleSource;
  /** ISO — 최신 순 정렬·corpus_until 계산에 쓴다. */
  createdAt: string;
  studentId?: string | null;
  /** 자동작성 원문(0370a) — 자동작성 후 수정 표본에만. 없으면(기록 전·표 미적용) 종전대로 최종 글만 본다. */
  draft?: string | null;
};

export type StyleSample = {
  id: string;
  text: string;
  source: StyleSampleSource;
  createdAt: string;
  studentId: string | null;
  /** 고치기 전 자동작성 원문(0370a) — 있으면 프롬프트가 원문 ↔ 최종을 함께 보여 '늘 고치는 것'을 뽑는다. */
  draft: string | null;
};

/** 첨부 줄(`[첨부: …]`)과 그림 자리 줄(`[시험결과지]`)은 문장이 아니다 — 둘 다 벗긴다. */
const normalizeText = (s: string | null | undefined) =>
  withoutAttachmentLines(stripImageSlots(s ?? ""))
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .trim();

/**
 * 표본 고르기 — 짧은 조각 제외 · 같은 글 중복 제거 · 최신 순 · 자동작성 후 수정은 상한만큼 **먼저 자리를 잡고**
 * 직접 작성이 나머지를 채운다(직접 작성이 60건 넘어도 수정본이 0이 되지 않게). 프롬프트 순서는 직접 작성이 앞.
 * 결정적이어야 한다(같은 코퍼스 = 같은 표본 = 같은 지문).
 */
export function pickStyleSamples(rows: StyleSampleRow[]): StyleSample[] {
  const seen = new Set<string>();
  const clean: StyleSample[] = [];
  for (const r of rows) {
    const text = normalizeText(r.notes);
    if (text.length < MENT_STYLE_MIN_CHARS) continue;
    const key = text.replace(/\s+/g, "");
    if (seen.has(key)) continue;
    seen.add(key);
    // 원문은 수정 표본에만, 최종과 같으면(실제로 안 고침) 버린다.
    const draft = r.source === "auto_edited" ? normalizeText(r.draft) : "";
    clean.push({ id: r.id, text, source: r.source, createdAt: r.createdAt, studentId: r.studentId ?? null, draft: draft && draft !== text ? draft : null });
  }
  const newestFirst = (a: StyleSample, b: StyleSample) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : a.id < b.id ? -1 : 1);
  const edited = clean.filter((s) => s.source === "auto_edited").sort(newestFirst).slice(0, MENT_STYLE_MAX_EDITED);
  const manual = clean.filter((s) => s.source === "manual").sort(newestFirst).slice(0, MENT_STYLE_MAX_SAMPLES - edited.length);
  return [...manual, ...edited];
}

/**
 * 표본 집합의 지문(id·출처, 순서 무관) + **프롬프트 규칙 버전** — 같으면 AI를 다시 부르지 않는다.
 * 버전을 섞는 이유: 표본이 그대로여도 프롬프트를 고쳤으면 다시 접어야 한다(안 섞으면 [지금 갱신]이 "변동 없음"으로 끝난다).
 */
export function styleCorpusHash(samples: readonly StyleSample[], promptVersion: number): string {
  // 원문 유무도 섞는다 — 같은 표본이라도 원문이 붙으면 다시 접어야 '늘 고치는 것'이 선다.
  const keys = samples.map((s) => `${s.id}:${s.source}${s.draft ? "+d" : ""}`).sort();
  let h = 5381;
  for (const k of keys) for (let i = 0; i < k.length; i++) h = ((h * 33) ^ k.charCodeAt(i)) >>> 0;
  return `v${promptVersion}-${keys.length}-${h.toString(16)}`;
}

/** 표본 중 가장 최근 작성 시각(ISO) — 없으면 null. */
export function corpusUntil(samples: readonly StyleSample[]): string | null {
  let max: string | null = null;
  for (const s of samples) if (!max || s.createdAt > max) max = s.createdAt;
  return max;
}

export type MentStyleProfile = {
  /** 어조 — 존댓말 종결형·격식·온도. */
  tone: string;
  /** 문장 구조·리듬 — 짧게 끊는지, 줄바꿈을 쓰는지. */
  sentence: string;
  /** 보통 길이 — "짧다(1~2문장)" 등. */
  length: string;
  /** 자주 쓰는 표현(표본에 실제로 있는 짧은 어구). */
  phrases: string[];
  /** 끝맺는 방식 — 과제 안내·다음 수업 예고. */
  closing: string;
  /** 이 선생님이 쓰지 않는 표현(선택). */
  caution: string;
  /**
   * 자동작성에서 이 선생님이 **늘 고치는 것**(0370a 원문 ↔ 최종 — 지우는 말·바꾸는 말·덧붙이는 말). 원문이 쌓이기 전 프로파일엔 없다.
   * 원장 2026-10-16 *"한계를 수정할 수 있을까"* — 0214a만으론 "고쳤다"는 사실만 알고 **무엇을** 고쳤는지는 몰랐다.
   */
  edits?: string[];
};

const LIMITS = { tone: 160, sentence: 200, length: 100, closing: 160, caution: 160, phrase: 24, phrases: 8, edit: 80, edits: 5 } as const;

/**
 * '늘 고치는 것'에서 버릴 줄(parseMentStyleProfile) — 재리뷰 2026-10-16이 낱말 목록의 우회("끝인사를 넣는다"·"마지막에 다음 수업 예고를 붙인다")와
 * 오탐("'~하겠습니다'를 '~합니다'로 바꾼다")을 찾았다. 그래서 낱말이 아니라 **고침의 방향**으로 가른다:
 *  · 무엇을 **덧붙이는** 줄은 늘 버린다 — [입력]에 없는 말(인사·예고·일정)을 지어내게 한다.
 *  · 인사·계획·안내 같은 위험 낱말은 **지우거나 바꾸는** 줄일 때만 남긴다("'감사합니다'를 지운다"는 끝인사 금지와 같은 방향).
 *  · 코드가 붙이는 문장(영상 과제 안내·학부모님께 드리는 말)에 대한 줄은 늘 버린다 — 따라 하면 [입력]의 영상 과제 사실이 빠진다.
 */
const EDIT_ADD = /덧붙|추가|넣는다|넣어|붙인다|붙여/;
const EDIT_RISKY = /감사|고맙|안녕|인사|좋은\s*하루|수고|화이팅|파이팅|겠|려고|예고|안내|보강|일정|당부|부탁|다음\s*(?:수업|시간)/;
const EDIT_REMOVE = /지운다|뺀다|없앤다|쓰지\s*않는다|바꾼다|고친다/;
const EDIT_CODE = /영상|학부모님께/;
const editBanned = (t: string) => EDIT_ADD.test(t) || EDIT_CODE.test(t) || (EDIT_RISKY.test(t) && !EDIT_REMOVE.test(t));

/** '늘 고치는 것'을 뽑을 근거(고치기 전 원문이 붙은 표본)가 이만큼 없으면 비운다 — 원문 없이 받은 edits는 모델이 지어낸 것이다. */
export const MENT_STYLE_MIN_DRAFTS_FOR_EDITS = 3;

/** 원문이 붙은 표본이 모자라면 edits를 비운다(빌드가 부른다 — 0370a 적용 직후엔 전원이 원문 0개다). */
export function keepGroundedEdits(profile: MentStyleProfile, samples: readonly StyleSample[], min = MENT_STYLE_MIN_DRAFTS_FOR_EDITS): MentStyleProfile {
  return samples.filter((s) => s.draft).length >= min ? profile : { ...profile, edits: [] };
}

/** 문자열 칸 정리 — 프롬프트의 줄바꿈 기호(⏎)가 응답에 되돌아오면 뗀다(지침에 실리면 멘트 모델이 그 기호를 그대로 찍는다). */
const clampText = (v: unknown, max: number): string =>
  typeof v === "string" ? v.replace(/\s*\(⏎\)|⏎/g, "").replace(/\s+/g, " ").trim().slice(0, max) : "";

/**
 * AI 응답을 프로파일로 좁힌다 — 모양이 안 맞거나 어조·문장이 비면 null(저장 안 함).
 * 🔴 '자주 쓰는 표현'은 **짧은 어구만** — 숫자가 들었거나("18/20"·"3단원") 상한보다 길면 **자르지 않고 버린다**.
 *    실코퍼스 드라이런(2026-09-12)에서 모델이 *"오늘 대표원장님의 학습 설명회가 있었습니다"* 같은 **그날의 사건**을
 *    표현으로 냈다 — 그게 다른 아이 알림장에 실리면 없는 사실이다. 길이가 곧 내용의 냄새라 상한을 낮게 둔다.
 */
export function parseMentStyleProfile(raw: unknown): MentStyleProfile | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const tone = clampText(o.tone, LIMITS.tone);
  const sentence = clampText(o.sentence, LIMITS.sentence);
  if (!tone || !sentence) return null;
  const phrases: string[] = [];
  for (const p of Array.isArray(o.phrases) ? o.phrases : []) {
    const t = typeof p === "string" ? p.replace(/\s+/g, " ").trim() : "";
    if (!t || t.length > LIMITS.phrase || /\d/.test(t) || phrases.includes(t)) continue;
    phrases.push(t);
    if (phrases.length >= LIMITS.phrases) break;
  }
  // '늘 고치는 것' — 짧은 한 줄씩, 숫자가 든 줄(점수·쪽수 = 그날의 내용)은 버린다. 길면 자르지 않고 버린다(표현과 같은 이유).
  // 🔴 인사말·계획·덧붙이는 내용(일정·안내·당부)·코드가 붙이는 문장(영상 과제 안내·학부모님께 드리는 말)이 든 줄도 버린다 — "처음부터 그렇게
  //    쓰세요"로 실리면 끝인사 금지(v3)를 다시 뚫거나 [입력]에 없는 말을 지어내게 한다(적대적 재리뷰 2026-10-16).
  const edits: string[] = [];
  for (const e of Array.isArray(o.edits) ? o.edits : []) {
    const t = typeof e === "string" ? e.replace(/\s*\(⏎\)|⏎/g, "").replace(/\s+/g, " ").trim() : "";
    if (!t || t.length > LIMITS.edit || /\d/.test(t) || editBanned(t) || edits.includes(t)) continue;
    edits.push(t);
    if (edits.length >= LIMITS.edits) break;
  }
  return {
    tone,
    sentence,
    length: clampText(o.length, LIMITS.length),
    phrases,
    closing: clampText(o.closing, LIMITS.closing),
    caution: clampText(o.caution, LIMITS.caution),
    edits,
  };
}

const squash = (s: string) => s.replace(/\s+/g, "");

/**
 * '자주 쓰는 표현'을 **표본에 실제로 반복되는 것만** 남긴다(기본 2개 이상의 표본에 등장) — 프롬프트의 "반복되는 특징만"을
 * 코드가 한 번 더 강제한다. 한 번 나온 어구는 그날의 내용이지 말투가 아니다(드라이런에서 실제로 그렇게 나왔다).
 */
export function keepRecurringPhrases(profile: MentStyleProfile, samples: readonly StyleSample[], min = 2): MentStyleProfile {
  const texts = samples.map((s) => squash(s.text));
  const phrases = profile.phrases.filter((p) => {
    const needle = squash(p);
    if (!needle) return false;
    let n = 0;
    for (const t of texts) if (t.includes(needle) && ++n >= min) return true;
    return false;
  });
  return { ...profile, phrases };
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * 프로파일에 **이름이 새었는지** — 표본 학생의 이름이 어느 칸에든 들어 있으면 그 이름들을 돌려준다.
 * 🔴 전체 이름(“박서연”)만 보면 못 잡는다 — 강사는 "서연이가…"·"서연만…"이라고 쓴다(리뷰 2026-09-12). 그래서 `studentNameVariants`가
 *    주는 꼴 전부를 본다: 첫 항목(= 동명이인 접미·공백을 뗀 전체 이름)은 그대로 포함 검사, 나머지(성 뺀 이름)는 비한글 경계 + 조사·호칭 꼴
 *    (`AFTER_GIVEN` — 발송 게이트와 **같은 목록**). 흔한 낱말과 같은 두 글자 이름("하나"·"보람")은 거짓 양성이 날 수 있으나 방향은
 *    안전(저장 거부)이고 빌드가 사유를 로그로 남긴다. 하나라도 있으면 저장하지 않는다(지침에 실린 이름은 다른 아이 알림장에 나간다).
 */
export function profileMentionsAny(profile: MentStyleProfile, names: readonly string[]): string[] {
  const hay = [profile.tone, profile.sentence, profile.length, profile.closing, profile.caution, ...profile.phrases, ...(profile.edits ?? [])].join("\n");
  const out: string[] = [];
  for (const raw of names) {
    const name = raw.trim();
    if (name.length < 2 || out.includes(name)) continue;
    const [base, ...rest] = studentNameVariants(name);
    const hit =
      (!!base && hay.includes(base)) || rest.some((v) => new RegExp(`(?:^|[^가-힣])${escapeRe(v)}${AFTER_GIVEN}`, "m").test(hay));
    if (hit) out.push(name);
  }
  return out;
}

/**
 * "teacher_ment_styles 표가 아직 없다"(0262a 미적용) 판별 — select는 42P01(스키마 캐시 stale)/PGRST205("Could not find the table …
 * in the schema cache"). 코드가 경로마다 달라(#95) 메시지도 보되, **표 이름 + 부재 문구**가 같이 있을 때만(권한·FK 오류 문구에도
 * 표 이름은 실린다 — 그걸 "미적용"으로 읽으면 cron 결과가 조용히 위장된다).
 */
export function isMentStyleTableMissingError(err: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!err) return false;
  if (err.code === "42P01" || err.code === "PGRST205") return true;
  const m = err.message ?? "";
  return m.includes("teacher_ment_styles") && /does not exist|schema cache|could not find/i.test(m);
}
