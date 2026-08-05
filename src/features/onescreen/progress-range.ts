/**
 * 학부모 카드 진도 **물결(~) 축약** — 원장 2026-08-05: *"진도가 너무 많이 선택하면 공간 많이 잡아먹는거 같은데
 * 물결 표시하는건 어때 / 스마트하게 같은 1-5-1~1-5-6, 이런식으로 / 같은 중단(원)끼리만 물결처리해도 되고"*.
 *
 * 하루에 9차시를 나가면 학부모 카드에 9줄이 굵게 쌓인다(실측: 초5 1-5-1~1-6-5). 이걸
 * `1-5-1~1-5-4 분수의 덧셈과 뺄셈` / `1-6-1~1-6-5 다각형의 둘레와 넓이` 두 줄로 접는다.
 *
 * 🔴 **표시 전용이다. 저장값(`lesson_reports.progress`)은 손대지 않는다.** 그 값은 진도 위치추적
 *    ([positionOf](../progress/curriculum-position.ts) — 마지막 줄이 그날 최종 진도)·'이전 진도' 승계
 *    ([carryProgress](./progress-status.ts))·AI 멘트의 사실 재료가 전부 읽는 단일 소스라, 여기서 줄을
 *    합쳐 저장하면 그날 나간 차시가 DB에서 사라진다. 접는 건 **학부모가 보는 카드**에서만.
 *
 * 🔴 **연속인 것만 접는다 — 건너뛴 차시를 범위 안에 넣으면 학부모에게 거짓말이 된다.**
 *    묶음 조건은 ① 같은 학년 ② **같은 중단원** ③ 커리큘럼상 차시 번호가 연속. 하나라도 어긋나면 거기서
 *    끊고 새 줄로 간다. 1-5-1·1-5-2·1-5-4처럼 가운데가 비면 1-5-1~1-5-4로 **접지 않는다**.
 *
 * 실측(2026-08-05, 진도 있는 보고서 8,000건): 3줄 이상이 1,408건(17.6%) → **477건이 접혀 1,838줄 → 537줄**.
 * 나머지는 아래 안전규칙에 걸려 원문 그대로다(대부분 커리큘럼 밖 문자열·불연속 선택).
 *
 * ⚠️ 커리큘럼에서 못 찾은 줄이 **하나라도** 있으면 원문을 그대로 돌려준다(자유입력 영어 진도·월말평가 등
 *    특수상태([progress-status.ts](./progress-status.ts))·미등록 차시). 반쯤 접힌 결과를 만들지 않는다.
 * ⚠️ 차시명이 커리큘럼 두 곳에 있으면(고등 과목 간 중복 — "접선의 방정식"이 미적분Ⅰ·Ⅱ 양쪽) **모호**로 보고
 *    그 줄이 낀 묶음은 접지 않는다. 엉뚱한 과목 기준으로 "연속"이라 판단하면 안 나간 차시를 범위에 넣게 된다.
 */
import { MATH_CURRICULUM } from "./curriculum";

/** 몇 개부터 접나 — 2줄은 접어도 한 줄만 줄어드는데 차시명을 잃어 손해가 크다. 3차시부터. */
const MIN_RUN = 3;

/** 첫 줄 과목 라벨("수학")을 벗길 때 시도할 최대 토큰 수. 라벨은 보통 1토큰, 넉넉히 4. */
const LABEL_MAX_TOKENS = 4;

type LessonLoc = { grade: string; unitIdx: number; unit: string; lessonIdx: number };

/** 차시 문자열 → 위치. 두 곳 이상에 있으면 `null`(모호 — 접기 대상에서 제외). */
const LESSON_LOC: Map<string, LessonLoc | null> = (() => {
  const m = new Map<string, LessonLoc | null>();
  for (const [grade, units] of Object.entries(MATH_CURRICULUM)) {
    units.forEach((u, unitIdx) => {
      u.lessons.forEach((lesson, lessonIdx) => {
        if (m.has(lesson)) m.set(lesson, null);
        else m.set(lesson, { grade, unitIdx, unit: u.unit, lessonIdx });
      });
    });
  }
  return m;
})();

/**
 * 조회용 정규화 — 레거시(edutrix) 임포트분은 줄마다 `"1.이등변삼각형의 성질"`처럼 **순번 접두**가 붙어 있다.
 * [normalizeLegacy](../progress/curriculum-position.ts)가 진도 위치추적에서 쓰는 것과 같은 규약으로 벗긴다
 * (실측: 이 접두 때문에 못 접히던 보고서가 306건 = 1,097줄). 커리큘럼 차시는 `1-5-1`처럼 하이픈이라 안 걸린다.
 */
function lessonKey(line: string): string {
  return line.replace(/^\d+\.\s*/, "").trim();
}

function locOf(line: string): LessonLoc | null {
  return LESSON_LOC.get(lessonKey(line)) ?? null;
}

/** 초등 차시 코드("1-5-1 진분수의 덧셈" → "1-5-1"). 중·고 차시는 코드가 없어 null. */
function codeOf(lesson: string): string | null {
  return /^(\d+-\d+-\d+)(?=\s)/.exec(lesson)?.[1] ?? null;
}

/** 중단원 라벨에서 번호 접두 제거 — "1-5 분수의 덧셈과 뺄셈"→"분수의 덧셈과 뺄셈", "1. 소인수분해"→"소인수분해". */
function unitTitle(unit: string): string {
  return unit.replace(/^\d+-\d+\s+/, "").replace(/^\d+\.\s*/, "").trim() || unit;
}

/**
 * 첫 줄에서 과목 라벨 접두를 벗긴다. 저장값이 `"수학 1-5-1 진분수의 덧셈"`이라 첫 줄만 라벨이 붙어 있다
 * (buildReportFields). 라벨을 붙인 채로는 커리큘럼 조회가 안 되므로 앞에서부터 한 토큰씩 벗겨 본다.
 */
function splitLabel(line: string): { label: string; lesson: string } | null {
  if (locOf(line)) return { label: "", lesson: line };
  const parts = line.split(" ");
  const max = Math.min(LABEL_MAX_TOKENS, parts.length - 1);
  for (let i = 1; i <= max; i++) {
    const lesson = parts.slice(i).join(" ");
    if (locOf(lesson)) return { label: parts.slice(0, i).join(" "), lesson };
  }
  return null;
}

/** 두 위치가 "같은 중단원 안에서 바로 이어지는 차시"인가. */
function isNext(prev: LessonLoc, cur: LessonLoc): boolean {
  return prev.grade === cur.grade && prev.unitIdx === cur.unitIdx && cur.lessonIdx === prev.lessonIdx + 1;
}

/**
 * 진도 저장값 → 학부모 카드 표시 문자열. 접을 게 없으면 **원문 그대로** 돌려준다(공백·개행 보존).
 * 예) `"수학 1-5-1 진분수의 덧셈\n…\n1-6-5 마름모와 사다리꼴의 넓이"`(9줄)
 *   → `"수학 1-5-1~1-5-4 분수의 덧셈과 뺄셈\n1-6-1~1-6-5 다각형의 둘레와 넓이"`(2줄)
 */
export function collapseProgressRanges(progress: string | null | undefined): string {
  const raw = progress ?? "";
  const lines = raw
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (lines.length < MIN_RUN) return raw;

  const head = splitLabel(lines[0]!);
  if (!head) return raw;

  // display = 화면에 그대로 남길 원문(접히지 않은 줄) / key = 커리큘럼 조회·범위 양끝 표기용 정규화값.
  const display = [head.lesson, ...lines.slice(1)];
  const keys = display.map(lessonKey);
  const locs: LessonLoc[] = [];
  for (const lesson of display) {
    const loc = locOf(lesson);
    if (!loc) return raw; // 커리큘럼 밖·모호 — 반쯤 접지 않고 통째로 원문 유지
    locs.push(loc);
  }

  // 연속 구간(같은 학년·같은 중단원·차시 번호 +1)으로 묶는다.
  const groups: number[][] = [];
  display.forEach((_, i) => {
    const last = groups[groups.length - 1];
    const prev = locs[i - 1];
    if (last && prev && isNext(prev, locs[i]!)) last.push(i);
    else groups.push([i]);
  });

  const out: string[] = [];
  for (const g of groups) {
    if (g.length < MIN_RUN) {
      for (const i of g) out.push(display[i]!); // 안 접는 줄은 원문 그대로(순번 접두도 건드리지 않는다)
      continue;
    }
    const first = keys[g[0]!]!;
    const last = keys[g[g.length - 1]!]!;
    const firstCode = codeOf(first);
    const lastCode = codeOf(last);
    // 초등(코드 있음)=코드 범위 + 중단원명 / 중등(코드 없음)=차시명 양끝. 어느 쪽이든 실제로 나간 첫·끝 차시다.
    out.push(
      firstCode && lastCode
        ? `${firstCode}~${lastCode} ${unitTitle(locs[g[0]!]!.unit)}`
        : `${first} ~ ${last}`,
    );
  }
  if (out.length === display.length) return raw; // 접힌 묶음이 없으면 원문 그대로

  return [head.label, out.join("\n")].filter(Boolean).join(" ");
}
