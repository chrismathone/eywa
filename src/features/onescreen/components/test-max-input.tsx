"use client";

import { useState } from "react";

/**
 * 테스트 문항수(/N) 입력 — **빈칸 편집을 허용**하는 숫자칸.
 *
 * ⚠️ 왜 별도 컴포넌트인가(2026-07-24 원장 제보): 예전엔 `value={String(max)}` 컨트롤드 + `if (n>0) onCommit(n)`
 * 이라, 분모를 지우려고 숫자를 **빈칸으로 만들면** parseInt("")=NaN → 커밋 안 됨 → 컨트롤드 value가 옛 값으로
 * **스냅백**해 "1이 안 지워진다 / 전체개수가 안 바뀐다"가 됐다(1→100 교체가 지우고-다시치기로는 불가).
 * → **로컬 텍스트 상태**로 중간(빈칸·"10")을 그대로 두고, 유효값(>0)일 때만 부모에 커밋한다.
 *    blur 시 빈칸/무효면 마지막 유효값으로 복원(무효값이 저장에 남지 않게).
 *
 * ⚠️ prop `max`가 밖에서 바뀌면(승계 복원·점수/개수 모드 전환 등) 텍스트를 **렌더 중 조정**으로 동기화한다 —
 *    useEffect로 setState하면 React 19 `set-state-in-effect`(#25)에 걸린다. 이건 공식 "파생 상태 재설정" 패턴.
 */
export function TestMaxInput({
  max,
  onCommit,
  ariaLabel,
  className,
}: {
  max: number;
  onCommit: (v: number) => void;
  ariaLabel: string;
  className?: string;
}) {
  const [text, setText] = useState(String(max));
  const [seenMax, setSeenMax] = useState(max);
  if (max !== seenMax) {
    // 외부에서 max가 바뀜(clamp 아님 — 여기 input은 max만 만진다) → 표시 텍스트 동기화(렌더 중 조정, effect 아님).
    setSeenMax(max);
    setText(String(max));
  }
  return (
    <input
      inputMode="numeric"
      value={text}
      aria-label={ariaLabel}
      title="문항수(만점)"
      onChange={(e) => {
        const raw = e.target.value.replace(/[^0-9]/g, "");
        setText(raw); // 빈칸·중간 상태를 그대로 허용(스냅백 없음)
        const n = parseInt(raw, 10);
        if (!Number.isNaN(n) && n > 0) onCommit(n);
      }}
      onBlur={() => {
        // 빈칸/0으로 떠나면 마지막 유효값 복원 — 무효 문항수가 저장에 남지 않게.
        const n = parseInt(text, 10);
        if (Number.isNaN(n) || n <= 0) setText(String(max));
      }}
      className={className}
    />
  );
}
