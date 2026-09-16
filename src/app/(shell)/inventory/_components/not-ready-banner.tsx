import type { TableStatus } from "@/features/inventory/server/queries";

/**
 * 표가 아직 없거나(0242a·0247a 미적용) 조회가 실패했을 때의 한글 배너 — MCS 0237a·MP 0239a와 같은 모양.
 * 🔴 원인을 단정하지 않는다: 표 없음과 그냥 실패는 다른 문구다(권한·네트워크 실패를 "SQL 미적용"이라 부르면 거짓말).
 * 🔑 **어느 마이그레이션인지도 갈라 적는다** — 0242a(자산 표)가 없는 것과 0247a(분류 표)가 없는 것은
 *    잠기는 범위가 다르다(전자는 화면 전체, 후자는 엑셀의 새 분류 자동 추가만).
 * 편집 잠금은 page.tsx가 `editable`로 정한다 — 여기는 알리기만.
 */
export function NotReadyBanner({ status, categoryStatus }: { status: TableStatus; categoryStatus?: TableStatus }) {
  if (status === "missing-table") {
    return (
      <p className="bg-amber-soft/40 text-amber rounded-lg px-3 py-2 text-xs">
        재고관리 표가 아직 만들어지지 않았습니다 — 마이그레이션 <span className="num">0242a</span>를 적용해 주세요.
        적용 전엔 목록이 비어 있고 편집이 잠깁니다.
      </p>
    );
  }
  if (status === "failed") {
    return (
      <p className="bg-danger-soft/40 text-danger rounded-lg px-3 py-2 text-xs">
        재고 목록을 불러오지 못했습니다. 잠시 뒤 새로고침해 주세요 — 그동안 편집은 잠깁니다.
      </p>
    );
  }
  if (categoryStatus === "missing-table") {
    return (
      <p className="bg-amber-soft/40 text-amber rounded-lg px-3 py-2 text-xs">
        자산 분류 표가 아직 만들어지지 않았습니다 — 마이그레이션 <span className="num">0247a</span>를 적용해 주세요.
        그동안 분류는 기본 7종으로 보이고, 엑셀에 없는 분류를 적어도 <b>새 분류가 만들어지지 않습니다</b>(나머지 기능은 그대로).
      </p>
    );
  }
  if (categoryStatus === "failed") {
    return (
      <p className="bg-danger-soft/40 text-danger rounded-lg px-3 py-2 text-xs">
        자산 분류를 불러오지 못했습니다 — 기본 7종으로 보이고 있고, 엑셀의 새 분류 추가는 잠깁니다.
      </p>
    );
  }
  return null;
}
