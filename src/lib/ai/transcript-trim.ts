// 전사 꼬리 잡음 절단(B) — 순수 함수(서버/클라 공용, Vitest). AssemblyAI가 준 발화별 타임스탬프·신뢰도로
// "회의 종료 후 녹음을 못 끄고 섞인 뒷부분 잡음"을 감지해 잘라낸다. 보수적으로 — 애매하면 안 자른다(진짜 내용 보호).
//
// 신호(모두 충족해야 자름): ① 긴 침묵 gap(기본 90초+) 뒤에 ② 그 꼬리 텍스트가 전체의 소수(기본 20% 미만)이고
// ③ 잡음스럽다(평균 신뢰도 낮거나 발화 밀도 희소). 텍스트 비율(②)이 진짜 내용을 보호하는 핵심 가드 —
// 꼬리가 전체 발화의 20%를 넘으면 절대 자르지 않으므로, 앞·중간의 정상 침묵을 경계로 오인할 수 없다.
// 화자 라벨/타임스탬프가 없으면(옛 통짜 전사) 트림 불가 → 원본 유지(프롬프트 지침 C가 방어).

/** 전사 발화 1개. start/end는 ms(AssemblyAI utterance). confidence(0~1)는 옛 임포트분엔 없을 수 있음. */
export type TrimUtterance = {
  speaker: string;
  text: string;
  start: number;
  end: number;
  confidence?: number;
};

export type TrimResult = {
  /** 분석·표시에 쓸 앞부분(진짜 회의). 안 자르면 입력 전체. */
  kept: TrimUtterance[];
  /** 잘라낸 꼬리(종료 후 잡음). 안 자르면 빈 배열. */
  removed: TrimUtterance[];
  /** 잘라낸 구간 길이(초) — 실제 회의 종료(cutAtMs)부터 마지막 잡음 발화 끝까지. 표시용. */
  removedDurationSec: number;
  /** 자른 지점(kept 마지막 발화의 end, ms). 안 자르면 null. */
  cutAtMs: number | null;
};

export type TrimOptions = {
  /** 이 이상 침묵이 있어야 경계 후보(초). 기본 90. */
  minGapSec?: number;
  /** 꼬리 텍스트가 전체의 이 비율 미만일 때만 자름(진짜 내용 보호). 기본 0.2. */
  maxTailTextRatio?: number;
  /** 꼬리 평균 신뢰도가 이 미만이면 잡음 신호. 기본 0.55. */
  lowConfidence?: number;
  /** 꼬리 발화 밀도가 분당 이 글자수 미만이면 희소(잡음 신호). 기본 100. */
  sparseCharsPerMin?: number;
  /** 발화가 이 미만이면 판단하지 않음(너무 짧아 신뢰 불가). 기본 4. */
  minUtterances?: number;
};

const DEFAULTS: Required<TrimOptions> = {
  minGapSec: 90,
  maxTailTextRatio: 0.2,
  lowConfidence: 0.55,
  sparseCharsPerMin: 100,
  minUtterances: 4,
};

const charCount = (s: string) => s.replace(/\s/g, "").length;

/**
 * 뒷부분 잡음 꼬리를 감지해 잘라낸다. 안전을 위해 가장 이른(=꼬리를 최대로 자르는) '적격' gap에서 절단하되,
 * 위 4신호를 모두 통과하는 gap만 적격 — 하나라도 애매하면 안 자르고 원본을 그대로 반환한다.
 */
export function trimTrailingNoise(
  utterances: TrimUtterance[],
  options: TrimOptions = {},
): TrimResult {
  const cfg = { ...DEFAULTS, ...options };
  const none: TrimResult = { kept: utterances, removed: [], removedDurationSec: 0, cutAtMs: null };

  if (!Array.isArray(utterances) || utterances.length < cfg.minUtterances) return none;

  // 방어적 정렬(입력은 보통 정렬돼 있지만 보장 안 함).
  const u = [...utterances].sort((a, b) => a.start - b.start);
  const spanStart = u[0].start;
  const spanEnd = u[u.length - 1].end;
  const span = spanEnd - spanStart;
  if (span <= 0) return none;

  const totalChars = u.reduce((sum, x) => sum + charCount(x.text), 0);
  if (totalChars === 0) return none;

  const minGapMs = cfg.minGapSec * 1000;

  for (let i = 0; i < u.length - 1; i++) {
    const gap = u[i + 1].start - u[i].end;
    if (gap < minGapMs) continue;

    const tail = u.slice(i + 1);
    const tailChars = tail.reduce((sum, x) => sum + charCount(x.text), 0);
    // 꼬리가 전체의 소수일 때만 자름 — 진짜 내용이 상당량 남아 있으면 절대 자르지 않는다.
    // (앞·중간의 정상 침묵은 그 뒤 내용이 전체의 다수라 여기서 걸러진다. 시간위치 가드 불필요.)
    if (tailChars / totalChars > cfg.maxTailTextRatio) continue;

    // 잡음 신호: 평균 신뢰도가 낮거나(잘못 인식된 소음) 발화 밀도가 희소(긴 시간에 몇 마디뿐).
    const withConf = tail.filter((x) => typeof x.confidence === "number");
    const avgConf =
      withConf.length > 0 ? withConf.reduce((s, x) => s + (x.confidence ?? 0), 0) / withConf.length : null;
    const tailSpanSec = Math.max((tail[tail.length - 1].end - tail[0].start) / 1000, 0);
    const charsPerMin = tailSpanSec > 0 ? tailChars / (tailSpanSec / 60) : Number.POSITIVE_INFINITY;

    const lowConf = avgConf !== null && avgConf < cfg.lowConfidence;
    const sparse = charsPerMin < cfg.sparseCharsPerMin;
    if (!lowConf && !sparse) continue; // 후반부 gap이어도 뒤가 밀도 높은 진짜 내용이면 보존.

    const kept = u.slice(0, i + 1);
    const cutAtMs = kept[kept.length - 1].end;
    const removedDurationSec = Math.max(Math.round((spanEnd - cutAtMs) / 1000), 0);
    return { kept, removed: tail, removedDurationSec, cutAtMs };
  }

  return none;
}
