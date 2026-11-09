/**
 * 학원 비서 '제안 → 결과 → 학습' 2단계 — 비서 의견의 확인 지표를 다시 재어 판정한다(순수 모듈 · 크론·화면·시험 공용).
 * 원장 2026-11-06 *"그 해결책이 어떤 결과를 가져왔는지에 대한 결과 피드백까지"*. 설계 = docs/features/academy-assistant.md §7-6.
 *
 * - 재측정 기간 = [기준일 + checkAfterDays − 기간, 기준일 + checkAfterDays). 기준일 = '완료'한 날(원장이 완료를 누르면 그날로 다시 잡는다
 *   — 실행 전 기간을 결과로 판정하지 않게 · 적대 리뷰 2026-11-09) · 아니면 질문일(= 기준값 기간 끝 + 2일). 하루 실패해 다음 날 다시 재도 기간은 그대로.
 * - 🔴 판정은 **저장된 기준값**과 견준다 — 기준값은 기간 끝 뒤 이틀 만에 잰 값이고 재측정 값도 이틀 뒤에 잰다(늦게 들어오는 기록이 같은 만큼).
 *   같은 날 기준 기간을 다시 잰 값은 '기준이 흔들렸나'만 본다 — 문턱 이상 바뀌었으면(늦은 입력이 많았다) 판정 보류.
 *   (다시 잰 기준값과 견주면 한쪽만 늦은 기록이 다 차 '오르면 좋은' 건수는 늘 악화로 기운다 · 적대 리뷰 2026-11-09.)
 * - 문턱 T = max(최소 효과, 2σ×√2) — 비율 3%p · 건수 2건·20% · 금액 1만 원·10% · 그 밖 0.1·5%. σ는 두 비율 차·푸아송 오차,
 *   √2는 한 학생의 칸들이 서로 묶여(독립이 아니다) 오차가 커 보이는 만큼 넉넉히(보수적으로). 표본이 적으면(8 미만 · 건수 합 4 미만) 판정 보류.
 * - 두 기간의 휴원일 수가 다르면 판정 보류(같은 요일 구성이라도 수업 날 수가 다르다).
 * - 판정은 '같은 시기에 함께 일어난 변화'까지만 말한다 — 원인(그 의견 덕분)은 말하지 않는다(화면에 그 안내를 단다).
 */
import { addDays } from "@/lib/date-kst";
import { formatCheckValue, SETTLE_DAYS, type CheckUnit } from "./advice";

export const VERDICTS = ["improved", "flat", "worse", "unknown"] as const;
export type Verdict = (typeof VERDICTS)[number];
/** '변화 없음'이 아니라 '뚜렷한 차이 없음' — 80% → 68%처럼 숫자는 움직였는데 오차 범위 안인 경우가 있다(재리뷰 2026-11-09). */
export const VERDICT_LABEL: Record<Verdict, string> = { improved: "개선", flat: "뚜렷한 차이 없음", worse: "악화", unknown: "판정 보류" };
/** 조회가 이만큼 실패하면(서로 다른 날 · 연결 문제는 세지 않는다) 다시 재지 않는다. */
export const MAX_FAILS = 3;
const MIN_SAMPLE = 8;
const DEFF = Math.SQRT2;

/**
 * 질문일 = 기준값 기간 끝 + 2일. ⚠️ SETTLE_DAYS를 바꾸면 이 계산이 옛 줄과 어긋난다 — 바꿀 때는 옛 줄의 measure_anchor를 채운다.
 */
export function askedOnOf(baselineTo: string): string {
  return addDays(baselineTo, SETTLE_DAYS);
}

/** 재측정 기간 = [기준일 + checkAfterDays − 기간, 기준일 + checkAfterDays). */
export function remeasureWindow(anchor: string, windowDays: number, checkAfterDays: number): { from: string; to: string } {
  const to = addDays(anchor, checkAfterDays);
  return { from: addDays(to, -windowDays), to };
}

/** [from, to) 안의 휴원일 수. */
export function closedDaysIn(holidays: ReadonlySet<string>, from: string, to: string): number {
  let n = 0;
  for (const d of holidays) if (d >= from && d < to) n += 1;
  return n;
}

export type Judgement = { verdict: Verdict; delta: number; threshold: number | null; reason: string | null };

/**
 * 판정 — 저장된 기준값(`base`) → 재측정 값(`now`). 좋아지는 쪽(`better`)으로 문턱 이상 움직였으면 개선, 반대면 악화, 그 사이는 변화 없음.
 * `rebase` = 같은 날 기준 기간을 다시 잰 값(못 쟀으면 null — 안정성 확인만 건너뛴다). `closed` = 두 기간의 휴원일 수.
 */
export function judgeOutcome(i: {
  unit: CheckUnit;
  better: "up" | "down";
  base: number;
  baseSample: number | null;
  now: number;
  nowSample: number | null;
  rebase?: number | null;
  closed?: { base: number; now: number };
}): Judgement {
  const delta = round(i.now - i.base);
  const hold = (reason: string): Judgement => ({ verdict: "unknown", delta, threshold: null, reason });
  if (i.closed && i.closed.base !== i.closed.now) return hold(`휴원일 수가 달라(기준 기간 ${i.closed.base}일 · 재측정 기간 ${i.closed.now}일) 판정하지 않습니다`);
  const nb = i.baseSample ?? 0;
  const nc = i.nowSample ?? 0;
  let threshold: number;
  if (i.unit === "percent") {
    if (nb < MIN_SAMPLE || nc < MIN_SAMPLE) return hold(`표본이 적어(${MIN_SAMPLE} 미만) 판정하지 않습니다`);
    const p = clamp01((i.base * nb + i.now * nc) / (100 * (nb + nc)));
    const sigma = 100 * Math.sqrt(p * (1 - p) * (1 / nb + 1 / nc)) * DEFF;
    threshold = Math.max(3, 2 * sigma);
  } else if (i.unit === "count") {
    if (i.base + i.now < 4) return hold("건수가 적어(합 4 미만) 판정하지 않습니다");
    threshold = Math.max(2, 0.2 * Math.abs(i.base), 2 * DEFF * Math.sqrt(Math.max(0, i.base) + Math.max(0, i.now)));
  } else {
    // 금액·그 밖 숫자 — 몇 건에서 나온 값인지(표본) 모르면 한두 건이 판정을 뒤집는다(환불 30만 원 한 건 → 0원이 '개선').
    if (i.baseSample === null || i.nowSample === null) return hold("표본(건수) 칸이 없어 판정하지 않습니다");
    if (nb < MIN_SAMPLE || nc < MIN_SAMPLE) return hold(`표본(건수)이 적어(${MIN_SAMPLE} 미만) 판정하지 않습니다`);
    threshold = i.unit === "won" ? Math.max(10_000, 0.1 * Math.abs(i.base)) : Math.max(0.1, 0.05 * Math.abs(i.base));
  }
  threshold = round(threshold);
  if (typeof i.rebase === "number" && Math.abs(i.rebase - i.base) >= threshold) {
    return hold(`늦게 들어온 기록으로 기준값이 바뀌어(${formatCheckValue(i.base, i.unit)} → ${formatCheckValue(i.rebase, i.unit)}) 판정하지 않습니다`);
  }
  const signed = i.better === "up" ? delta : -delta;
  const verdict: Verdict = signed >= threshold ? "improved" : signed <= -threshold ? "worse" : "flat";
  return { verdict, delta, threshold, reason: null };
}

const round = (v: number) => Math.round(v * 1000) / 1000;
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
