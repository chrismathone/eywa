/**
 * JJ실 기간 — 주소에서 온 날짜를 **인재원이 받는 모양으로** 고친다(순수, Vitest로 잠금).
 *
 * 🔴 검사 없이 넘기면 인재원이 400을 돌려주고 화면은 "서버 오류, 잠시 후 다시"라고 말했다(적대 리뷰 2026-09-10:
 *    일반 목록에 1년 넘게 걸어 둔 기간이 JJ실로 따라왔고, 시작 > 끝도 그대로 나갔다).
 * 🔑 날짜 기준이 둘이다(설명서 ①) — 시험 = KST 달력 날짜, 학습 = 학습일(KST 03:00에 날이 바뀐다).
 *    자정~03시엔 달력 '오늘'이 아직 시작 안 한 학습일이라, 학습 쪽 기본 끝날은 `ijwStudyDay()`로 잡는다.
 */
import { addDays, kstToday, diffDays } from "@/lib/date-kst";

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 학습 기간 상한(설명서 4·8번 "최대 1년") — 양 끝을 포함해 센다. */
export const JJ_STUDY_MAX_DAYS = 365;

/** 실제로 있는 날짜의 YYYY-MM-DD인가(`2026-02-30`은 아니다). */
export function isYmd(s: string | null | undefined): s is string {
  if (!s || !YMD_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** 지금의 학습일 — KST 03:00 경계(설명서 ①). 00:00~02:59 KST는 전날이다. */
export function ijwStudyDay(now: Date = new Date()): string {
  return kstToday(new Date(now.getTime() - 3 * 3_600_000));
}

export type JjRange = {
  from: string;
  to: string;
  /** 주소에 기간이 없어 기본값을 썼다 — 날짜 칸에 기본값을 **값으로** 채우지 않는다(일반 목록으로 새지 않게). */
  isDefault: boolean;
  /** 끝날이 오늘(학습일·달력일)보다 뒤라 오늘로 당겼다 — 앞으로의 날짜엔 기록이 없다. */
  endCapped: boolean;
  /** 상한(1년)을 넘어 시작일을 **뒤로** 옮겼다(최근 1년만 남긴다) — 화면이 그 사실을 적는다. */
  clamped: boolean;
  /** 시작일이 앞으로의 날짜라(끝도 없거나 미래) 기본 창으로 돌렸다 — '끝날을 옮겼다'와 다른 사실이다. */
  startFuture?: boolean;
  /** 사람이 적은 시작이 끝보다 뒤라 맞바꿨다 — 화면이 그 사실을 적는다. */
  swapped?: boolean;
};

/**
 * - 형식이 틀리거나 비면 기본값(끝 = today, 시작 = 끝 − (defaultDays − 1)).
 * - 시작 > 끝이면 맞바꾼다.
 * - 🔴 끝이 today보다 뒤면 today로 당긴다 — **상한 계산보다 먼저**(적대 재리뷰 2026-09-10: `2026-01-01~2027-12-31`을
 *   상한부터 자르면 `2027-01-01~2027-12-31`이 되어, 전부 0인 표 위에 "시작일을 당겼습니다"라는 틀린 안내가 떴다).
 *   시작까지 미래면(기간 전체가 미래) 기본 창으로 되돌린다.
 * - maxDays를 넘으면 **끝을 지키고** 시작을 뒤로 옮긴다(최근이 더 중요하다).
 */
export function resolveJjRange(
  input: { from?: string | null; to?: string | null },
  opts: { today: string; defaultDays: number; maxDays?: number },
): JjRange {
  const hasFrom = isYmd(input.from);
  const hasTo = isYmd(input.to);
  // 🔴 시작일이 앞으로의 날짜고 끝이 없거나 끝도 미래면 기록이 없는 기간이다 — 기본 창으로 돌리고 **시작이 옮겨졌다**고
  //    적는다(맞바꾼 뒤 끝을 당기면 "끝날을 오늘로 바꿨습니다"라는 틀린 안내가 떴다, 적대 재리뷰 2026-09-10).
  if (hasFrom && (input.from as string) > opts.today && (!hasTo || (input.to as string) > opts.today)) {
    return {
      from: addDays(opts.today, -(opts.defaultDays - 1)),
      to: opts.today,
      isDefault: false,
      endCapped: false,
      clamped: false,
      startFuture: true,
    };
  }
  let to = hasTo ? (input.to as string) : opts.today;
  let from = hasFrom ? (input.from as string) : addDays(to, -(opts.defaultDays - 1));
  // 여기서 시작 > 끝이면 둘 다 사람이 적은 값이다(미래 시작 + 빈 끝은 위에서 끝났다) — 맞바꾸고 그 사실을 적는다.
  let swapped = false;
  if (from > to) {
    [from, to] = [to, from];
    swapped = true;
  }
  let endCapped = false;
  if (to > opts.today) {
    to = opts.today;
    endCapped = true;
    if (from > to) from = addDays(to, -(opts.defaultDays - 1));
  }
  let clamped = false;
  if (opts.maxDays && diffDays(from, to) + 1 > opts.maxDays) {
    from = addDays(to, -(opts.maxDays - 1));
    clamped = true;
  }
  return { from, to, isDefault: !hasFrom && !hasTo, endCapped, clamped, ...(swapped ? { swapped: true } : {}) };
}

