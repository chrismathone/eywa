import type { TableStatus } from "@/features/inventory/server/queries";

/**
 * 표가 아직 없거나(0242a 미적용) 조회가 실패했을 때의 한글 배너 — MCS 0237a·MP 0239a와 같은 모양.
 * 🔴 원인을 단정하지 않는다: 표 없음과 그냥 실패는 다른 문구다(권한·네트워크 실패를 "SQL 미적용"이라 부르면 거짓말).
 * 편집 잠금은 page.tsx가 `editable`로 정한다 — 여기는 알리기만.
 */
export function NotReadyBanner({ status }: { status: TableStatus }) {
  if (status === "missing-table") {
    return (
      <p className="border-amber bg-amber-soft/40 text-amber rounded-lg border-l-[3px] px-3 py-2 text-xs">
        재고관리 표가 아직 만들어지지 않았습니다 — 마이그레이션 <span className="num">0242a</span>를 적용해 주세요.
        적용 전엔 목록이 비어 있고 편집이 잠깁니다.
      </p>
    );
  }
  if (status === "failed") {
    return (
      <p className="border-danger bg-danger-soft/40 text-danger rounded-lg border-l-[3px] px-3 py-2 text-xs">
        재고 목록을 불러오지 못했습니다. 잠시 뒤 새로고침해 주세요 — 그동안 편집은 잠깁니다.
      </p>
    );
  }
  return null;
}
