/**
 * **수학 보고서 새 방식 — 테스트 학생 한정 시범**(원장 2026-10-21). 순수 모듈(Vitest).
 *
 * 원장 지시: *"해당 작업은 수학과 테스트 학생이한테만 반영해서 테스트 먼저 진행해보기 위함"* — 범위는 학생 '테스트' 한 명
 * (질문 답 "학생 '테스트' 기준"). 시범 대상 수학 행에서만 아래 다섯 가지가 바뀐다.
 *   1. 수학 보고서(멘트·추세) 칸은 **자동작성 전엔 보기만**, 자동작성 뒤엔 고칠 수 있다(원장 2026-10-23 — 종전 '항상 보기만'을 뒤집음, `pilotCanEdit`).
 *   2. 자동작성을 한 번도 안 한 글은 ClassNote 발송을 막는다(화면 게이트 + 서버 `saveAndQueueClassnote` 이중 — 작성 방식 auto·auto_edited만 통과).
 *   3. 특이사항 자리표시 = 격려 멘트 예시.
 *   4. 소단원(오늘 진도의 차시)별 **이해도 10점 만점** 칸 — 일부를 빼고 남은 것만 자동작성에 쓴다.
 *   5. 자동작성 글 = `{이름}는 오늘 … 진도를 나갔습니다` + 이해도 + AI 본문 + 특이사항(맨 아래 그대로).
 *
 * 🔴 대상은 **id 명단 하나**(`MATH_REPORT_PILOT_STUDENT_IDS`)이고 판정은 `isMathReportPilot` 한 함수다 — 화면·서버가 같은 답을 낸다.
 *    시범이 끝나 전원에게 열 땐 이 명단을 지우고 판정을 과목만 보게 바꾼다(그때 이 주석도 고칠 것).
 */

import { skipStatusOf } from "./progress-status";

/**
 * 시범 대상 학생 id — 학생 '테스트' + '학원이'(injaewon). 학원이는 원장이 원일 계정·'학원이(테스트)' 반에서 바로 확인하려고 더했다
 * (2026-10-21 — '테스트'는 퇴원·수강 0건이라 화면에 안 뜬다).
 */
export const MATH_REPORT_PILOT_STUDENT_IDS: readonly string[] = [
  "67a53999-fb62-4753-a938-9a5ce4af9e61", // 테스트
  "6219e442-aa57-455f-a5bc-834b222d9e1c", // 학원이
  "5de5c803-6cf6-4ad9-85f0-d184334c679e", // 학원삼 — 원일 계정 테스트용(2026-10-22, 학원이 반 담임이 박소선으로 바뀌어 따로 만듦)
];

/** 이 학생·과목 행이 시범 대상인가. 과목키가 없는 행(데모)은 수학으로 본다(원스크린 관례). */
export function isMathReportPilot(studentId: string | null | undefined, subjectKey: string | null | undefined): boolean {
  if (!studentId || !MATH_REPORT_PILOT_STUDENT_IDS.includes(studentId)) return false;
  return !subjectKey || subjectKey === "math";
}

/** 한글 음절에 받침이 있나 — 한글이 아니면 false(조사 '는/와'로). */
function hasBatchim(ch: string | undefined): boolean {
  if (!ch) return false;
  const c = ch.charCodeAt(0);
  if (c < 0xac00 || c > 0xd7a3) return false;
  return (c - 0xac00) % 28 !== 0;
}

/**
 * 학부모 글에서 부르는 이름 + 주제 조사 — "이승엽" → "승엽이는", "김지수" → "지수는".
 * 괄호·공백 뒤 꼬리("홍길동 (테스트)")와 동명이인 구분 글자("김라윤A" — 실측 재원생 497명 중 37명)는 뗀다.
 * 한글 세 글자·두 글자(외자 "이윤" → "윤이는")면 성을 뗀다. 네 글자 이상은 그대로(복성을 추측하지 않는다 — 실측 0명).
 */
export function topicName(fullName: string): string {
  const base = (fullName.replace(/[([].*$/, "").trim().split(/\s+/)[0] ?? "").replace(/[A-Za-z0-9]+$/, "");
  const given = /^[가-힣]{2,3}$/.test(base) ? base.slice(1) : base;
  if (!given) return "";
  return hasBatchim(given.slice(-1)) ? `${given}이는` : `${given}는`;
}

/** 차시 → 학부모에게 보일 소단원 이름. 앞의 단원 번호(`1-1-1 `)는 뗀다(번호만 있으면 그대로). */
export function lessonTitle(lesson: string): string {
  const t = lesson.replace(/^\s*\d+-\d+-\d+\s*/, "").trim();
  return t || lesson.trim();
}

/** 진도칸(개행으로 이은 차시) → 소단원 목록(중복 제거, 순서 유지). */
export function pilotLessons(today: string | null | undefined): string[] {
  const out: string[] = [];
  for (const raw of (today ?? "").split("\n")) {
    const l = raw.trim();
    if (l && !out.includes(l)) out.push(l);
  }
  return out;
}

/**
 * 첫 문장 — 원장 지시 *"단원 하나면 하나로 갔다 3개면 어디서 어디까지 나갔다"*.
 * 1개 = "승엽이는 오늘 소수와 거듭제곱 진도를 나갔습니다." / 2개 = "A와 B" / 3개 이상 = "A부터 B까지".
 * `stopLabel`(월말평가 등 진도 중단일) = 진도 대신 그날 한 일을 적는다.
 */
export function progressLead(fullName: string, lessons: readonly string[], stopLabel?: string | null): string {
  // '우리 ○○이는' — 친근감(원장 2026-10-21 *"학생이름 앞에 '우리' 붙여서 친근감 표현"*).
  const name = topicName(fullName);
  if (!name) return "";
  const who = `우리 ${name}`;
  if (stopLabel) return `${who} 오늘 ${stopLabel} 수업을 했습니다.`;
  const titles = lessons.map(lessonTitle).filter(Boolean);
  if (titles.length === 0) return "";
  // 소단원 이름은 따옴표로 묶는다 — 이름 안의 '의'·'와'가 문장 조사와 섞여 읽기 어렵다(원장 2026-10-23 *"너무 짧고 이상함"*).
  const q = (t: string) => `'${t}'`;
  const close = " 오늘 배운 내용이 잘 자리 잡을 수 있도록 다음 시간에도 이어서 꼼꼼히 다지겠습니다.";
  if (titles.length === 1) return `${who} 오늘 ${q(titles[0]!)} 진도를 나갔습니다.${close}`;
  if (titles.length === 2) {
    const [a, b] = titles;
    return `${who} 오늘 ${q(a!)}${hasBatchim(a!.slice(-1)) ? "과" : "와"} ${q(b!)}, 두 소단원 진도를 나갔습니다.${close}`;
  }
  return `${who} 오늘 ${q(titles[0]!)}부터 ${q(titles[titles.length - 1]!)}까지 모두 ${titles.length}개 소단원 진도를 나갔습니다.${close}`;
}

/** 소단원별 이해도 상태 — 점수(차시 원문 키 → 0~10) + 뺀 차시. 세션 `subject_progress`에 실린다. */
export type UnderstandingState = { scores: Record<string, number>; off: string[] };

export const EMPTY_UNDERSTANDING: UnderstandingState = { scores: {}, off: [] };

/** 이해도 만점. */
export const UNDERSTANDING_MAX = 10;

/** 0~10 정수로 맞춘다. 숫자가 아니면 null(칸 비움). */
export function clampUnderstanding(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(UNDERSTANDING_MAX, Math.round(n)));
}

/** 세션에서 읽은 값(모양을 믿지 않는다) → 상태. */
export function readUnderstanding(raw: unknown): UnderstandingState {
  if (!raw || typeof raw !== "object") return EMPTY_UNDERSTANDING;
  const r = raw as { scores?: unknown; off?: unknown };
  const scores: Record<string, number> = {};
  if (r.scores && typeof r.scores === "object")
    for (const [k, v] of Object.entries(r.scores as Record<string, unknown>)) {
      const n = clampUnderstanding(v);
      if (n != null) scores[k] = n;
    }
  const off = Array.isArray(r.off) ? r.off.filter((x): x is string => typeof x === "string") : [];
  return { scores, off };
}

export type UnderstandingRow = { lesson: string; title: string; score: number | null; off: boolean };

/** 화면 줄 — 오늘 진도의 차시마다 한 줄(뺀 것도 '뺌'으로 남겨 되살릴 수 있게). */
export function understandingRows(today: string | null | undefined, st: UnderstandingState | undefined): UnderstandingRow[] {
  const s = st ?? EMPTY_UNDERSTANDING;
  return pilotLessons(today).map((lesson) => ({
    lesson,
    title: lessonTitle(lesson),
    score: s.scores[lesson] ?? null,
    off: s.off.includes(lesson),
  }));
}

/** 자동작성에 쓰는 이해도 — 빼지 않았고 점수를 매긴 소단원만. */
export function activeUnderstanding(
  today: string | null | undefined,
  st: UnderstandingState | undefined,
): { title: string; score: number }[] {
  return understandingRows(today, st)
    .filter((r) => !r.off && r.score != null)
    .map((r) => ({ title: r.title, score: r.score! }));
}

/**
 * 이해도 서명 — 자동작성할 때 쓴 이해도와 지금 칸 값이 같은지 대조한다(발송 게이트).
 * 🔴 점수는 학부모 글에 **숫자로 싣지 않는다**(원장 2026-10-21 *"점수로 하지 말고 … 말로 풀어서"*) — 글만 봐서는
 *    점수가 바뀌었는지 알 수 없어서, 자동작성 시점의 서명을 화면이 들고 있다가 비교한다.
 */
export function understandingSig(items: readonly { title: string; score: number }[] | undefined): string {
  return (items ?? []).map((i) => `${i.title}=${i.score}`).join("|");
}

/**
 * 항목 제목 — 학부모 글을 **항목별로 나눠** 무엇에 대한 답인지 보이게 한다(원장 2026-10-22 *"텍스트로 우르르 들어가는 게 아닌
 * 섹션을 나눠서 어떤 것에 어떤 답인지 볼 수 있게"*). ClassNote 본문은 평문이라 기호 한 글자로 머리를 단다.
 */
export const PILOT_SECTION_TITLES = {
  progress: "진도",
  daily: "일일 테스트",
  check: "확인 테스트",
  levels: "수업 평가",
  attitude: "수업 태도",
  homework: "숙제 완성도", // 원장 2026-10-23 *"과제 → 숙제완성도로 이름 변경"* — 라벨만(값은 그대로 지난 과제 수행률)
  understanding: "오늘의 수업", // 원장 2026-10-23 *"이해도가 아니라 오늘수업의 이해도로"* → *"오늘의 수업으로 명칭 변경"* — 라벨만(표의 줄 이름은 짧게 '이해도')
  homeworkToday: "오늘의 숙제", // 원장 2026-10-23(옛 '오늘 과제')
  note: "사랑의 한마디", // 원장 2026-10-23 *"강사 한줄멘트 → 사랑의 한마디"*(옛 '선생님 한마디')
} as const;

/**
 * 이름을 바꾸기 전 제목 — 이미 저장된 글을 학부모 카드가 같은 모양으로 그리고, 옛 글 끝의 한마디도 그 자리에서 바꿔 끼우려고 남긴다.
 * 새 글에는 쓰지 않는다.
 */
export const PILOT_LEGACY_TITLES = {
  homework: "과제 수행률",
  homeworkToday: "오늘 과제",
  note: "선생님 한마디",
} as const;

/** 항목 하나 — 내용이 비면 항목째 뺀다(없는 것을 '없음'으로 지어 쓰지 않는다). */
export function pilotSection(title: string, body: string | null | undefined): string {
  const b = (body ?? "").trim();
  return b ? `■ ${title}\n${b}` : "";
}

/** 맨 끝 '사랑의 한마디' 항목 — 강사가 적은 원문 그대로. */
export function noteBlock(note: string | null | undefined): string {
  return pilotSection(PILOT_SECTION_TITLES.note, note);
}

/**
 * 시범 대상 자동작성 글 조립 — `lead`(수업 평가 표 · 진도 항목) → `body`(이미 항목으로 나눈 글, math-report-pilot-sections.ts) →
 * 사랑의 한마디(맨 아래, 강사가 적은 원문 그대로 — AI에 주지 않는다).
 */
export function composePilotMent(parts: { lead: string; body: string; note: string }): string {
  return [parts.lead, parts.body, noteBlock(parts.note)]
    .map((p) => p.trim())
    .filter(Boolean)
    .join("\n\n");
}

/**
 * 강사 한줄 멘트를 고치면 자동작성 글 맨 끝을 **그 자리에서** 바꿔 끼운다(원장 2026-10-22 *"AI 자동 작성 후 치면 실시간으로
 * 우측에 반영해서 강사 한줄 멘트 쓰고 볼 수 있게"*). 한줄 멘트는 AI에 주지 않고 원문을 맨 끝에 붙이므로(composePilotMent)
 * 다시 자동작성할 필요가 없다 — 끝의 옛 멘트만 떼고 새 멘트를 붙인다.
 * 자동작성을 한 번도 안 했거나 끝이 옛 멘트로 끝나지 않으면 null(손대지 않는다).
 * 자동작성 뒤 강사가 고친 글도 끝만 바꾼다(원장 2026-10-23 *"자동작성하고나면 수정은 할수있게"*).
 */
export function pilotRecomposeNote(
  draft: string | null | undefined,
  autoDraft: string | null | undefined,
  prevNote: string | null | undefined,
  nextNote: string | null | undefined,
): string | null {
  if (!(autoDraft ?? "").trim()) return null;
  const d = (draft ?? "").trim();
  const p = (prevNote ?? "").trim();
  // 옛 제목('선생님 한마디')으로 끝난 글도 끝만 바꾼다 — 바꿔 끼우면 새 제목이 된다.
  const tails = p ? [noteBlock(p), pilotSection(PILOT_LEGACY_TITLES.note, p)] : [""];
  let base: string | null = null;
  for (const tail of tails) {
    if (!tail) base = d;
    else if (d === tail) base = "";
    else if (d.endsWith(`\n\n${tail}`)) base = d.slice(0, d.length - tail.length - 2);
    if (base !== null) break;
  }
  if (base === null) return null;
  return composePilotMent({ lead: base, body: "", note: nextNote ?? "" });
}

/** 강사 한줄 멘트가 적혀 있나 — 시범 대상은 필수(원장 2026-10-22 *"한줄멘트 … 없으면 발송 안 되게"*). */
export function hasPilotOneLine(note: string | null | undefined): boolean {
  return (note ?? "").trim() !== "";
}

/** 서버 발송 게이트 거절 문구 — 강사 한줄 멘트가 없거나 보고서 끝에 붙어 있지 않다. */
export const PILOT_ONELINE_REQUIRED_ERROR =
  "이 학생의 수학 보고서는 '사랑의 한마디'를 적어야 보낼 수 있습니다(저장은 됐습니다) — 사랑의 한마디를 적은 뒤 다시 보내 주세요";

/** 서버 판정 — 한줄 멘트가 있고 보낼 글 맨 끝에 그대로 붙어 있나. */
export function pilotOneLineAttached(notes: string | null | undefined, oneLine: string | null | undefined): boolean {
  const o = (oneLine ?? "").trim();
  return o !== "" && (notes ?? "").trim().endsWith(o);
}

/** 자동작성 글이 그대로 칸에 있나(발송 게이트). 자동작성을 안 했거나 글이 달라졌으면 false. */
export function isPilotAutoWritten(draft: string | null | undefined, autoDraft: string | null | undefined): boolean {
  const a = (autoDraft ?? "").trim();
  return a !== "" && (draft ?? "").trim() === a;
}

/**
 * AI 본문 지시 — 첫 문장·특이사항은 코드가 붙이므로 본문이 같은 말을 되풀이하지 않게 하고, 이해도 점수는 **말로** 풀게 한다.
 * 원장 2026-10-21: *"점수로 하지 말고 점수에 따라 강점, 낮으면 낮은 만큼 응원 또는 격려와 같은 식으로 말로 풀어서"*.
 * 원장 2026-10-21 후속: *"학생이름 앞에 '우리' 붙여서 친근감"* · *"못했을 경우 학원에서 챙기겠다 / 다음 시간에 챙기겠다 등 학원에서 신경을 쓴다는 어투"*. · *"개념을 힘들어했다는 등 표현이 좋음"*(낮은 이해도 = '○○을 힘들어했습니다' 꼴)
 *   · *"응용문제 식을 세우는 이런 식의 추측성은 사용 금지 — 학생이 어떤 걸 어려워했는지 모르자나"*(2026-10-22) — 대상은 소단원 이름·개념까지만.
 * 프롬프트 본문(원장 편집 가능) 밖, 섹션 끝에 코드로 붙는다.
 */
export const PILOT_AI_DIRECTIVE = [
  "[이번 알림장 추가 규칙]",
  "- 이 알림장은 항목별로 나뉩니다(수업 평가·진도·일일 테스트·수업 태도·숙제 완성도·오늘의 수업·오늘의 숙제·사랑의 한마디). 진도·테스트·태도·숙제·사랑의 한마디는 따로 붙으니, comment에는 '오늘의 수업' 항목에 들어갈 문장만 쓰세요 — 인사, 진도 나열, 테스트 점수, 수업 태도, 과제 이야기는 쓰지 마세요.",
  "- comment는 학생 이름으로 시작하지 말고, 첫 소단원 이야기부터 바로 시작하세요.",
  "- 본문에서 학생을 부를 때는 이름 앞에 '우리'를 붙여 친근하게 부르세요. 부를 이름은 맨 아래 [부르는 이름]에 있습니다 — 그 이름 말고 다른 이름은 절대 쓰지 마세요.",
  "- '소단원별 이해도'가 있으면 소단원마다 한두 문장으로 말로 풀어 쓰세요. '잘 이해함'인 소단원은 아이의 강점으로 구체적으로 칭찬하세요.",
  "- '대체로 따라왔으나 아직 조금 어려워함'·'어려워함'인 소단원은 반드시 두 단계로 쓰세요. ① 먼저 그 소단원을 아이가 힘들어했다는 사실만 부드럽게 말합니다 — 대상은 소단원 이름(또는 그 소단원의 개념)까지만입니다(중간 예: '연립방정식의 풀이는 대체로 잘 따라왔지만 아직 조금 어려워했습니다' / 낮음 예: '해가 특수한 연립방정식 개념을 조금 힘들어했습니다'). 소단원 안의 어느 부분이 어려웠는지(응용 문제·식 세우기·계산·풀이 정리·문장제 등)는 입력에 없는 정보이므로 절대 추측해서 쓰지 마세요 — 선생님이 점수만 매겼을 뿐, 무엇이 어려웠는지는 알려 주지 않았습니다. '이해도가 낮다'·'못한다'·'부족하다' 같은 직접적인 표현은 쓰지 마세요. ② 그다음 '그래서'·'그만큼' 같은 말로 이어, 바로 그 이유 때문에 학원에서 챙기겠다고 아이를 향한 응원·격려와 함께 마무리합니다(예: '그래서 다음 시간에 한 번 더 짚어 확실히 챙기겠습니다', '충분히 해낼 수 있는 부분이라 그만큼 수업 중에 꼼꼼히 살펴보겠습니다'). 상태 설명 없이 '챙기겠습니다'만 쓰면 학부모가 왜 챙기는지 알 수 없으니 절대 그렇게 쓰지 마세요.",
  "- 아이가 잘 못한 부분·과제를 못 해 온 부분도 아이나 가정에 책임을 돌리지 말고, 학원이 책임지고 챙긴다는 어투로 마무리하세요. 가정에 숙제·복습을 부탁하는 말로 끝내지 마세요.",
  "- 점수 숫자·'10점 만점'·'이해도 N점' 같은 표현은 절대 쓰지 마세요. 소단원 이름은 그대로 써도 됩니다.",
  "- comment에는 학부모님께 보낼 문장만 쓰세요. 규칙을 지켰는지에 대한 설명이나 고쳐 쓰겠다는 말은 절대 넣지 마세요.",
].join("\n");

/** 부르는 이름 — "학원삼" → "원삼이", "김지수" → "지수"(`topicName`에서 조사 '는'만 뗀 것). 모르면 "". */
export function callName(fullName: string): string {
  return topicName(fullName).replace(/는$/, "");
}

/**
 * 이 학생의 AI 지시 — 공통 규칙 + 부르는 이름. 원장 2026-10-23 *"왜 로그인 한 사람의 이름으로 뜨는거지?"* — 사실 입력엔 학생 이름이
 * 없었고, 지시의 예시 이름('우리 승엽이가')을 모델이 그대로 베꼈다. 그래서 예시 이름을 없애고 이 학생의 실제 이름을 준다.
 */
export function pilotAiDirective(fullName: string): string {
  const call = callName(fullName);
  return [PILOT_AI_DIRECTIVE, call ? `[부르는 이름] 우리 ${call}` : "[부르는 이름] 없음 — 이름을 부르지 말고 '아이'라고 쓰세요."].join("\n");
}

/** 이해도 점수 → AI에 줄 말. 숫자를 주면 금지해도 '10점 만점에 N점'을 베꼈다(2026-10-23 실측). 경계는 수업 평가 표와 같은 쪽(8↑ · 5~7 · 4↓). */
export function understandingBandText(score: number): string {
  if (score >= 8) return "잘 이해함";
  if (score >= 5) return "대체로 따라왔으나 아직 조금 어려워함";
  return "어려워함";
}

/** 모델이 규칙을 어기고 남긴 문장 — 점수 숫자 · 규칙에 대한 혼잣말("금지 표현이니 제외하고 다시 쓰겠습니다"). */
const LEAK = /\d+\s*점|만점|점수|금지 표현|다시 쓰|제외하고|규칙을|지침을|지침에/;

/** 모델이 아무것도 못 남겼을 때의 이해도 글 — 소단원마다 한 문장, 아직 어려워하면 학원이 챙긴다는 말. */
export function fallbackUnderstanding(items: readonly { title: string; score: number }[]): string {
  return items
    .map(({ title, score }) => {
      const t = `'${title}'${hasBatchim(title.slice(-1)) ? "은" : "는"}`;
      if (score >= 8) return `${t} 잘 이해하고 있습니다.`;
      if (score >= 5) return `${t} 대체로 잘 따라왔지만 아직 조금 어려워했습니다. 그래서 다음 시간에 한 번 더 짚어 확실히 챙기겠습니다.`;
      return `${t} 조금 힘들어했습니다. 그래서 다음 시간에 한 번 더 짚어 확실히 챙기겠습니다.`;
    })
    .join(" ");
}

/**
 * AI 이해도 글 후보정 — 점수 숫자·규칙 혼잣말이 든 **문장을 통째로** 뺀다(고쳐 쓰지 않는다 — 지어내지 않으려고).
 * 다 빠지면 `fallbackUnderstanding`. 지시가 무시돼도 학부모에게 숫자·혼잣말이 가지 않게 하는 마지막 관문.
 */
export function cleanPilotUnderstanding(text: string, items: readonly { title: string; score: number }[]): string {
  const out = text
    .replace(/\s+/g, " ")
    .trim()
    .split(/(?<=[.!?])\s+/)
    .filter((sen) => sen && !LEAK.test(sen))
    .join(" ")
    .trim();
  return out || (items.length ? fallbackUnderstanding(items) : "");
}

/** 서버 발송 게이트 거절 문구 — 자동작성 글이 아니거나 고쳐졌다. */
export const PILOT_AUTOWRITE_REQUIRED_ERROR =
  "이 학생의 수학 보고서는 '자동작성'을 먼저 해야 보낼 수 있습니다(저장은 됐습니다) — 자동작성을 누른 뒤 다시 보내 주세요";

/**
 * 자동작성 글이 **지금 칸 값과 맞나** — 자동작성 뒤에 진도·테스트·태도·과제·이해도를 바꾸면 글은 옛 값 그대로라 다시 눌러야 한다
 * (한줄 멘트는 그 자리에서 바뀌므로 예외 — pilotRecomposeNote). 진도 항목·맨 끝 한마디는 글에서 대조하고, 나머지는 자동작성 때
 * 남긴 사실 서명(`writtenSig`)과 대조한다(이해도 점수처럼 글에 숫자로 없는 값이 있다).
 * ⚠️ 서명은 화면 상태라 새로고침하면 없다 — 없으면 서명 대조를 건너뛴다(막지 않는다).
 */
export function isPilotDraftCurrent(
  draft: string | null | undefined,
  now: {
    studentName: string;
    today: string | null | undefined;
    note: string | null | undefined;
    /** 지금 칸 값의 사실 서명(math-report-pilot-sections.ts `pilotFactsSig`) — 자동작성 때 남긴 `writtenSig`와 대조한다. */
    factsSig: string;
    writtenSig?: string;
  },
): boolean {
  const d = (draft ?? "").trim();
  const lead = progressLead(now.studentName, pilotLessons(now.today), skipStatusOf(now.today));
  // 진도 항목은 맨 앞이거나 '수업 평가' 표 바로 뒤(원장 2026-10-23 표를 맨 위로).
  const sec = lead ? pilotSection(PILOT_SECTION_TITLES.progress, lead) : "";
  if (sec && !d.startsWith(sec) && !d.includes(`\n\n${sec}`)) return false;
  if (now.writtenSig !== undefined && now.writtenSig !== now.factsSig) return false;
  const note = (now.note ?? "").trim();
  if (note && !d.endsWith(note)) return false;
  return true;
}

/**
 * 자동작성을 한 번이라도 했나 — 시범 대상 멘트 칸은 그 전엔 잠기고, 그 뒤엔 고칠 수 있다
 * (원장 2026-10-23 *"자동작성하고나면 수정은 할수있게 열어줘"*, 종전 2026-10-21 *"수정하지 못하도록 막고 보이게만"*을 뒤집음).
 */
export function pilotCanEdit(autoDraft: string | null | undefined): boolean {
  return (autoDraft ?? "").trim() !== "";
}

/**
 * 발송 게이트용(카드·표 공용) — 자동작성을 한 번은 해야 하고, 그 뒤 칸 값(진도·테스트·태도·과제·이해도)이 바뀌었으면 다시 눌러야 한다.
 * · 자동작성 글 그대로 = 종전 대조 전부(진도 첫 문장 · 사실 서명 · 끝의 한마디).
 * · 강사가 고친 글 = 글 대조(진도 첫 문장)는 못 한다 — 사실 서명과 끝의 한마디만 본다(고친 글을 '다시 자동작성'으로 지우게 하지 않는다).
 */
export function pilotNeedsAutoWrite(
  draft: string | null | undefined,
  autoDraft: string | null | undefined,
  now: Parameters<typeof isPilotDraftCurrent>[1],
): boolean {
  const d = (draft ?? "").trim();
  if (!pilotCanEdit(autoDraft) || !d) return true;
  if (isPilotAutoWritten(draft, autoDraft)) return !isPilotDraftCurrent(draft, now);
  if (now.writtenSig !== undefined && now.writtenSig !== now.factsSig) return true;
  const note = (now.note ?? "").trim();
  return note !== "" && !d.endsWith(note);
}
