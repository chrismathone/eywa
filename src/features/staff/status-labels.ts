// 직원 상태·시스템 역할의 한글 라벨과 배지 색 — **단일 소스**(순수, 서버/클라 공용).
// UI에 raw enum(active·counselor 등) 노출 금지(반복 지적) + 같은 뜻이 화면마다 다른 색이 되지 않게.
//
// 종전엔 목록(`staff/_components/staff-table.tsx`)과 상세(`staff/[id]/page.tsx`)가 각자 같은 맵을
// 들고 있었다. 값이 우연히 일치했을 뿐 한쪽만 고치면 조용히 갈라지는 구조라 여기로 합쳤다.
import type { PillColor } from "@/components/atoms/pill";
import { type SemanticTone, toneColor } from "@/lib/design/semantic-color";
import { ROLE_LABEL } from "@/lib/auth/role-hierarchy";
import type { SystemRole } from "@/lib/permissions";

export const STAFF_STATUS_LABEL: Record<string, string> = {
  active: "재직",
  inactive: "퇴사",
  pending: "대기",
};

/**
 * 상태 → 의미(tone). 색은 [`semantic-color.ts`](src/lib/design/semantic-color.ts)가 정한다.
 * ⚠️ `active`(재직)는 v4에서 brand(네이비) → positive(그린): "정상 운영 중"은 앱 전역이 그린이고
 *    (학생 '재원'과 같은 뜻), 네이비는 뜻이 아니라 브랜드/현재 위치 자리라 상태에 쓰지 않는다.
 */
export const STAFF_STATUS_TONE: Record<string, SemanticTone> = {
  active: "positive",
  inactive: "inert",
  pending: "caution",
};

/** 상태 배지 한 벌(라벨+색). 직원 상태를 그리는 모든 화면은 이걸 쓴다. */
export function staffStatusMeta(
  status: string | null | undefined
): { label: string; color: PillColor; tone: SemanticTone } | null {
  if (!status) return null;
  const tone = STAFF_STATUS_TONE[status] ?? "inert";
  return { label: STAFF_STATUS_LABEL[status] ?? status, color: toneColor(tone), tone };
}

/**
 * 시스템 역할 **색**. 라벨은 [`ROLE_LABEL`](src/lib/auth/role-hierarchy.ts)이 이미 단일 소스라
 * 여기서 다시 적지 않는다(적으면 "원장/owner" 같은 표기가 두 곳에서 갈린다).
 * ⚠️ 역할 색은 **의미(tone)가 아니라 신원**이라 캐논 대상이 아니다 — 상태색(초록=정상 등)과 뜻이
 *    겹치지 않도록 일부러 positive 그린을 비워 둔다. 역할이 초록이면 "정상"으로 오독된다.
 */
const ROLE_PILL: Record<string, PillColor> = {
  master: "danger",
  admin: "blue",
  manager: "blue",
  teacher: "primary",
  counselor: "rose",
  accountant: "purple",
  viewer: "neutral",
  parttime: "neutral",
  student: "neutral",
};

/** 역할 배지 한 벌(라벨+색). 미지의 코드는 raw 라벨 + neutral(그대로 노출하되 색은 안 준다). */
export function roleMeta(role: string | null | undefined): { label: string; color: PillColor } {
  if (!role) return { label: "—", color: "neutral" };
  const label = ROLE_LABEL[role as SystemRole] ?? role;
  return { label, color: ROLE_PILL[role] ?? "neutral" };
}
