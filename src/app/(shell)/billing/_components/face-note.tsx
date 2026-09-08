import type { ReactNode } from "react";

/**
 * 면 안내문 = **접힌 2차**(디자인 지시서 §4 — 설명 문장은 1차 화면에서 빼고 2차로). 회차 확정·시수 검증·강사 정산의 규칙 설명
 * (청구=N회 키스톤 N1/N2 — "확정한 값만 청구 기준·차이는 자동으로 맞추지 않는다")은 지워선 안 되는 사실이라 `<details>` 뒤로
 * 내린다(운영실 `SecondarySection`과 같은 결, JS 0). 열림 상태는 저장하지 않는다.
 *
 * 🔴 **사실을 바꾸는 경고**(강사 정산의 "배분율은 현재 설정값으로 계산" 등)는 여기 넣지 말고 그대로 보이게 둔다 — 접히면 숫자가
 *    무엇을 뜻하는지 모른 채 읽는다.
 */
export function FaceNote({ children, summary = "안내" }: { children: ReactNode; summary?: string }) {
  return (
    <details className="text-text-dim px-1 text-sm">
      <summary className="hover:text-foreground cursor-pointer font-medium select-none">{summary}</summary>
      <div className="mt-1.5 leading-relaxed">{children}</div>
    </details>
  );
}
