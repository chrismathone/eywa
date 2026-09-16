import type { TextbookTableStatus } from "@/features/textbooks/types";

/**
 * 0266a 미적용/조회 실패 안내 — 재고관리·MCS·MP와 같은 모양.
 * 🔴 **원인을 단정하지 않는다**: 표 없음과 그냥 실패는 다른 문구다(권한·네트워크 실패를 "SQL 미적용"이라
 *    부르면 거짓말이고, 그 반대면 "새로고침"이라는 못 고칠 안내를 시킨다).
 * 편집 잠금은 page.tsx가 `editable`로 정한다 — 여기는 알리기만.
 */
export function NotReadyBanner({ status }: { status: TextbookTableStatus }) {
  if (status === "missing-table") {
    return (
      <p className="border-amber bg-amber-soft/40 text-amber rounded-lg border-l-[3px] px-3 py-2 text-xs">
        교재목록 표가 아직 만들어지지 않았습니다 — 마이그레이션 <span className="num">0266a</span>를 적용해 주세요.
        적용 전엔 목록이 비어 있고 편집이 잠깁니다. <b>영어 강사 시트는 그대로 동작합니다</b>(교재 제안만 비어 있습니다).
      </p>
    );
  }
  if (status === "failed") {
    return (
      <p className="border-danger bg-danger-soft/40 text-danger rounded-lg border-l-[3px] px-3 py-2 text-xs">
        교재목록을 불러오지 못했습니다. 잠시 뒤 새로고침해 주세요 — 그동안 편집은 잠깁니다.
      </p>
    );
  }
  return null;
}
