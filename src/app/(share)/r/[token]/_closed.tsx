/**
 * 취소/일시 오류인 학부모 공개 보고서 링크 화면 — intake `ClosedScreen`(중앙정렬 친화 메시지) 패턴을 /r용으로 복제.
 * 생 404 대신 학부모에게 상황을 설명. noindex는 page metadata가 담당(전체 /r 공통).
 * 만료(보고서일+90일 경과)는 여기 없다 — 2026-10-01부터 공용 '링크 만료' 페이지(`/expired?kind=report`)로 보낸다.
 * 일시 오류는 이리 남는다: 주소(토큰)를 지키고 있어야 학부모가 새로고침으로 다시 열 수 있다.
 */
export function ClosedReportScreen({ reason }: { reason: "revoked" | "unavailable" }) {
  const title = reason === "revoked" ? "열람이 중단된 링크입니다" : "보고서를 잠시 불러올 수 없습니다";
  const message =
    reason === "revoked"
      ? "이 보고서 링크는 더 이상 열람할 수 없습니다. 담당 선생님께 문의해 주세요."
      : "일시적인 문제로 보고서를 열지 못했습니다. 잠시 후 이 링크를 다시 열어 주세요.";
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-3 px-6 text-center">
      <p className="text-foreground text-lg font-bold">{title}</p>
      <p className="text-text-dim text-sm">{message}</p>
    </div>
  );
}
