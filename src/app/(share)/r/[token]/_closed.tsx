/**
 * 만료/취소/일시 오류인 학부모 공개 보고서 링크 화면 — intake `ClosedScreen`(중앙정렬 친화 메시지) 패턴을 /r용으로 복제.
 * 생 404 대신 학부모에게 상황을 설명. noindex는 page metadata가 담당(전체 /r 공통).
 */
export function ClosedReportScreen({ reason }: { reason: "expired" | "revoked" | "unavailable" }) {
  const title =
    reason === "expired"
      ? "만료된 링크입니다"
      : reason === "revoked"
        ? "열람이 중단된 링크입니다"
        : "보고서를 잠시 불러올 수 없습니다";
  const message =
    reason === "expired"
      ? "이 보고서 링크는 유효 기간(90일)이 지나 더 이상 열람할 수 없습니다. 담당 선생님께 문의해 주세요."
      : reason === "revoked"
        ? "이 보고서 링크는 더 이상 열람할 수 없습니다. 담당 선생님께 문의해 주세요."
        : "일시적인 문제로 보고서를 열지 못했습니다. 잠시 후 이 링크를 다시 열어 주세요.";
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-3 px-6 text-center">
      <p className="text-foreground text-lg font-bold">{title}</p>
      <p className="text-text-dim text-sm">{message}</p>
    </div>
  );
}
