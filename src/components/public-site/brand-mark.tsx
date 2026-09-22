/** AYWA 표식 — 층을 쌓은 등각 상자(하늘 윗면·네이비 옆면·불 켜진 창). 랜딩·로그인이 같이 쓴다. */
export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden="true" focusable="false">
      <polygon points="16,3 29,10 16,17 3,10" fill="#9ccbea" />
      <polygon points="3,10 16,17 16,30 3,23" fill="#153e75" />
      <polygon points="29,10 16,17 16,30 29,23" fill="#2a5a97" />
      <polygon points="19,21.5 23,19.4 23,23.2 19,25.3" fill="#f6c343" />
    </svg>
  );
}
