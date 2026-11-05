/**
 * **영역 점수** — 영어 Monthly Test의 듣기·읽기·말하기·쓰기(원장 2026-11-04 *"Monthly Test … 듣기 읽기 말하기 쓰기 총합
 * 이렇게 들어가게 총합은 자동 SUM"*). 순수 모듈(Vitest) — 화면과 서버가 같은 규칙을 쓴다.
 *
 * 🔑 칸의 점수(`student_grades.score`)는 **네 영역의 합**이고, 영역 값은 `area_scores` jsonb(s2_0023)에 함께 둔다.
 *    그래서 추이·평균·학생 상세는 손대지 않아도 총합으로 그대로 돈다.
 * 🔑 만점(`max_score`)은 **총합 만점** = 영역 만점 × 4. 영역 만점은 거기서 도출한다(따로 저장하지 않는다).
 * ⚠️ 다른 경로(엑셀·통합 원장 행 수정)는 총합만 고친다 — 그러면 영역 값이 총합과 어긋나므로 **합이 맞을 때만**
 *    영역을 보여 준다(`areasMatch`). 어긋난 영역 값은 지우지 않는다(다음 영역 입력이 덮는다).
 */

export const AREA_KEYS = ["listening", "reading", "speaking", "writing"] as const;
export type AreaKey = (typeof AREA_KEYS)[number];
export type AreaScores = Partial<Record<AreaKey, number>>;

export const AREA_LABEL: Record<AreaKey, string> = {
  listening: "듣기",
  reading: "읽기",
  speaking: "말하기",
  writing: "쓰기",
};

/** 영역으로 나눠 적는 시험인가 — 영어 월말 시험(Monthly Test) 하나. */
export function slotHasAreas(subject: string, slot: string): boolean {
  return subject === "english" && slot === "monthly";
}

/** 총합 만점 → 영역 만점. */
export function areaMaxOf(totalMax: number): number {
  return totalMax / AREA_KEYS.length;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** 적힌 영역의 합(2자리 반올림). 하나도 없으면 null — 빈 칸과 0점은 다른 사실이다. */
export function sumAreas(areas: AreaScores | null | undefined): number | null {
  if (!areas) return null;
  const vals = AREA_KEYS.map((k) => areas[k]).filter((v): v is number => typeof v === "number");
  return vals.length ? round2(vals.reduce((s, v) => s + v, 0)) : null;
}

/** DB·요청의 값을 영역 점수로. 모르는 키·숫자가 아닌 값은 버린다. 비면 null. */
export function parseAreas(raw: unknown): AreaScores | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const src = raw as Record<string, unknown>;
  const out: AreaScores = {};
  for (const k of AREA_KEYS) {
    const v = src[k];
    const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
    if (Number.isFinite(n)) out[k] = round2(n);
  }
  return Object.keys(out).length ? out : null;
}

/** 영역 값을 검사한다 — 0 이상 영역 만점 이하. 틀리면 사람이 읽는 사유. */
export function areaError(areas: AreaScores | null, totalMax: number): string | null {
  if (!areas) return null;
  const max = areaMaxOf(totalMax);
  for (const k of AREA_KEYS) {
    const v = areas[k];
    if (v === undefined) continue;
    if (v < 0) return `${AREA_LABEL[k]} 점수는 0점 이상이어야 합니다`;
    if (v > max) return `${AREA_LABEL[k]} 점수는 영역 만점(${max})을 넘을 수 없습니다`;
  }
  return null;
}

/** 두 영역 점수가 같은가(키·값 모두). */
export function sameAreas(a: AreaScores | null | undefined, b: AreaScores | null | undefined): boolean {
  return AREA_KEYS.every((k) => (a?.[k] ?? null) === (b?.[k] ?? null));
}

/** 저장된 영역 값이 지금 총합과 맞는가 — 다른 경로가 총합만 고쳤으면 false(영역을 보여 주지 않는다). */
export function areasMatch(score: number | null, areas: AreaScores | null | undefined): boolean {
  const sum = sumAreas(areas);
  return sum != null && score != null && sum === round2(score);
}
