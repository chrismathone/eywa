"use client";

import { PROGRESS_MODES, PROGRESS_MODE_HINT, asProgressMode } from "../progress-mode";

/**
 * 오늘 수업 성격(복습·문제풀이) 알약 — **커리큘럼 피커 안과 밖이 같은 물건을 쓴다.**
 *
 * 수학은 진도 선택 팝오버 안에, 영어처럼 자유 입력인 과목은 입력칸 **바로 아래**에 붙는다
 * (원장 2026-08-07: *"영어 진도에도 복습·문제풀이 붙여줘"*). 두 자리에 각각 마크업을 두면 라벨·해제
 * 규약·툴팁이 갈라지므로 한 컴포넌트로 모은다.
 *
 * ⚠️ **같은 것을 다시 누르면 해제**(알약의 기본 규약) — 잘못 고른 성격을 되돌릴 유일한 문이다.
 * ⚠️ 값은 `progress-mode.ts`의 닫힌 목록만 오간다(`asProgressMode`로 정규화) — 임의 문자열이
 *    AI 사실 블록의 라벨로 승격되지 않게.
 */
export function ProgressModePills({
  mode,
  onMode,
  disabled,
  ariaLabel,
  compact,
}: {
  mode?: string | null;
  onMode: (mode: string | null) => void;
  /** 잠긴 행(발송 완료·결석) — 성격도 함께 잠근다. */
  disabled?: boolean;
  /** 스크린리더용 묶음 이름(예: "홍길동 영어 오늘 수업 성격"). */
  ariaLabel: string;
  /** 표 모드처럼 폭이 좁은 자리 — 글자·여백을 한 단계 줄인다. */
  compact?: boolean;
}) {
  const active = asProgressMode(mode);
  return (
    <div className="flex flex-wrap items-center gap-1" role="group" aria-label={ariaLabel}>
      {PROGRESS_MODES.map((m) => {
        const on = active === m;
        return (
          <button
            key={m}
            type="button"
            onClick={() => onMode(on ? null : m)}
            aria-pressed={on}
            disabled={disabled}
            title={PROGRESS_MODE_HINT[m]}
            className={`rounded-pill border font-bold transition-colors disabled:opacity-50 ${
              compact ? "px-1.5 py-px text-[10px]" : "px-2.5 py-1 text-[11px]"
            } ${
              on
                ? "border-primary bg-primary-soft text-primary"
                : "border-line text-text-dim hover:border-primary/60 hover:text-primary"
            }`}
          >
            {m}
          </button>
        );
      })}
    </div>
  );
}
