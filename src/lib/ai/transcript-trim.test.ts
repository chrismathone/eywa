import { describe, it, expect } from "vitest";
import { trimTrailingNoise, type TrimUtterance } from "./transcript-trim";

// 헬퍼 — 초 단위로 발화 생성(가독성). start/end는 ms로 변환.
function utt(startSec: number, endSec: number, text: string, confidence?: number): TrimUtterance {
  return { speaker: "A", text, start: startSec * 1000, end: endSec * 1000, confidence };
}

// 밀도 있는 "진짜 회의" 발화 블록 — 10초 간격, 각 40자.
function realBlock(fromSec: number, count: number, step = 10): TrimUtterance[] {
  const out: TrimUtterance[] = [];
  for (let i = 0; i < count; i++) {
    const s = fromSec + i * step;
    out.push(utt(s, s + 8, "실제 회의에서 오간 충분히 긴 발화 내용입니다 안건 논의 결정 사항", 0.95));
  }
  return out;
}

describe("trimTrailingNoise — 종료 후 잡음 꼬리 절단(B)", () => {
  it("긴 침묵(90초+) 뒤 저신뢰 잡음 꼬리를 잘라낸다", () => {
    // 진짜 회의 0~200초(20발화) → 300초 침묵 → 잡음 3발화(저신뢰).
    const real = realBlock(0, 20); // 마지막 발화 end ≈ 198초
    const noise = [
      utt(500, 503, "어 그거 뭐 저기", 0.3),
      utt(520, 522, "음 아 네", 0.25),
      utt(560, 561, "그 뭐", 0.2),
    ];
    const r = trimTrailingNoise([...real, ...noise]);
    expect(r.cutAtMs).not.toBeNull();
    expect(r.removed).toHaveLength(3);
    expect(r.kept).toHaveLength(20);
    expect(r.removedDurationSec).toBeGreaterThan(0);
  });

  it("긴 침묵 뒤 희소(발화 밀도 낮음) 꼬리도 잘라낸다 — 신뢰도 없어도", () => {
    const real = realBlock(0, 20);
    // 신뢰도 필드 없음(옛 임포트분 모사) + 300초에 걸쳐 딱 한 마디 = 희소.
    const noise = [utt(500, 800, "수고하셨습니다", undefined)];
    const r = trimTrailingNoise([...real, ...noise]);
    expect(r.cutAtMs).not.toBeNull();
    expect(r.removed).toHaveLength(1);
  });

  it("침묵 gap이 없으면(연속 대화) 자르지 않는다", () => {
    const real = realBlock(0, 20);
    // 바로 이어지는 발화들(gap 짧음) — 저신뢰여도 gap 신호가 없으니 보존(C 프롬프트가 담당).
    const chat = [utt(200, 205, "어 네 수고", 0.3), utt(206, 210, "다음에 봬요", 0.3)];
    const r = trimTrailingNoise([...real, ...chat]);
    expect(r.cutAtMs).toBeNull();
    expect(r.removed).toHaveLength(0);
    expect(r.kept).toHaveLength(22);
  });

  it("앞부분(60% 이전)의 정상 침묵은 경계로 오인하지 않는다", () => {
    // 0~100초 회의 → 100초 침묵(초반) → 260~460초 진짜 회의(밀도 높음).
    const first = realBlock(0, 10); // ~98초
    const second = realBlock(260, 20); // 260~458초, 밀도 높은 진짜 내용
    const r = trimTrailingNoise([...first, ...second]);
    expect(r.cutAtMs).toBeNull(); // gap이 앞부분(<60%)이고 뒤가 진짜 내용 → 안 자름
    expect(r.removed).toHaveLength(0);
  });

  it("후반부 gap이어도 뒤가 밀도 높은 진짜 내용이면 보존한다", () => {
    // 0~200초(20발화) → 90초 침묵 → 290~490초(20발화, 밀도 높고 고신뢰).
    const first = realBlock(0, 20);
    const second = realBlock(290, 20);
    const r = trimTrailingNoise([...first, ...second]);
    // 꼬리 텍스트가 전체의 절반(>20%)이라 maxTailTextRatio에서 걸러짐 → 안 자름.
    expect(r.cutAtMs).toBeNull();
  });

  it("꼬리가 전체 텍스트의 다수면 자르지 않는다(진짜 내용 보호)", () => {
    const real = realBlock(0, 5); // 소량
    const big = realBlock(300, 20); // 침묵 뒤지만 텍스트가 더 많음
    const r = trimTrailingNoise([...real, ...big]);
    expect(r.cutAtMs).toBeNull();
  });

  it("발화 수가 너무 적으면(<4) 판단하지 않는다", () => {
    const r = trimTrailingNoise([utt(0, 5, "짧은 회의", 0.9), utt(400, 402, "잡음", 0.2)]);
    expect(r.cutAtMs).toBeNull();
    expect(r.kept).toHaveLength(2);
  });

  it("빈 배열·정렬 안 된 입력을 안전하게 처리한다", () => {
    expect(trimTrailingNoise([]).cutAtMs).toBeNull();
    // 뒤섞인 순서라도 내부에서 start 기준 정렬 후 판단.
    const real = realBlock(0, 20);
    const noise = [utt(500, 502, "어", 0.2), utt(540, 541, "음", 0.2), utt(560, 561, "네", 0.2)];
    const shuffled = [...noise, ...real].sort(() => 0); // 순서 뒤섞기 시도(안정적이진 않지만 정렬 검증 목적)
    const r = trimTrailingNoise(shuffled);
    expect(r.removed.length).toBe(3);
    expect(r.kept.length).toBe(20);
  });

  it("cutAtMs 이후 구간 길이를 removedDurationSec로 보고한다", () => {
    const real = realBlock(0, 20); // 마지막 end = 198초
    const noise = [utt(500, 503, "어", 0.2), utt(600, 603, "음", 0.2)];
    const r = trimTrailingNoise([...real, ...noise]);
    expect(r.cutAtMs).toBe(198_000);
    // 198초 → 603초 = 405초
    expect(r.removedDurationSec).toBe(405);
  });
});
