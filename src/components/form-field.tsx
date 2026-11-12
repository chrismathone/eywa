/**
 * 대화상자 폼의 '라벨 + 입력 + (오류)' 한 칸 — 수납·문서 대화상자가 같은 모양을 6벌로 들고 있던 것을 하나로(수정 계획 P2-H).
 * 서버·클라 어디서나 쓴다(상태 없음).
 */
export function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <span className="text-foreground block text-sm font-medium">{label}</span>
      {children}
      {error ? <p className="text-danger text-xs">{error}</p> : null}
    </div>
  );
}
