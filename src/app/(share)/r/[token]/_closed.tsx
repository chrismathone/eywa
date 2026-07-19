/**
 * 만료/취소된 학부모 공개 보고서 링크 화면 — intake `ClosedScreen`(중앙정렬 친화 메시지) 패턴을 /r용으로 복제.
 * 생 404 대신 학부모에게 상황을 설명. noindex는 page metadata가 담당(전체 /r 공통).
 */
export function ClosedReportScreen({ reason }: { reason: "expired" | "revoked" }) {
  const title = reason === "expired" ? "만료된 링크입니다" : "열람이 중단된 링크입니다";
  const message =
    reason === "expired"
      ? "이 보고서 링크는 유효 기간(90일)이 지나 더 이상 열람할 수 없습니다. 담당 선생님께 문의해 주세요."
      : "이 보고서 링크는 더 이상 열람할 수 없습니다. 담당 선생님께 문의해 주세요.";
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-3 px-6 text-center">
      <p className="text-foreground text-lg font-bold">{title}</p>
      <p className="text-text-dim text-sm">{message}</p>
    </div>
  );
}
