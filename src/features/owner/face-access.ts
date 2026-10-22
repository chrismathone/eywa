import { canAccess, type AccessMatrix, type MenuKey, type SystemRole } from "@/lib/permissions";
import { OWNER_TAB_MENU } from "@/lib/settings-role-catalog";
import { OWNER_FACES, type OwnerFaceDef, type OwnerFaceKey } from "./tabs";

/**
 * 학원 설정 면의 **입구 판정** — 순수 함수(Vitest). 화면 탭 · 설정 메뉴 판과 같은 조건이다.
 *
 * 설정은 면마다 권한이 따로다(프로필 · 운영 · 수납 … — `settings-role-catalog.ts`). 그래서 "설정을 일부만 맡은 사람"이
 * 있다: 운영 설정만 위임받았는데 왼쪽 '설정'을 누르면 기본 면(프로필)으로 가고, 그 면의 권한이 없으니 **운영실로 튕겼다**
 * (맡은 면이 있는데도 설정에 못 들어간다). 요청한 면을 열 수 없으면 열 수 있는 첫 면으로 보낸다.
 * ⚠️ 여기는 "어느 면으로 보낼까"만 정한다 — 접근을 허락하는 곳이 아니다. 도착한 면은 제 가드(`requireAccess`)를 다시 지난다.
 */

/** 면의 접근 권한 키 — 설정별 권한이 있는 면은 그 키, 나머지(역할·권한 · 데이터 정리 · 감사로그 · 기능 등)는 학원 설정(owner). */
export function ownerFaceMenu(key: OwnerFaceKey): MenuKey {
  if (key === "contribution") return "student_contribution";
  return key in OWNER_TAB_MENU ? OWNER_TAB_MENU[key as keyof typeof OWNER_TAB_MENU] : "owner";
}

export type OwnerFaceGate = {
  systemRole: SystemRole;
  /** 이 사람의 **최종** 권한 표(역할별 설정 + 개인별 예외 + 꺼진 기능 반영 — `getUserPermMatrix`). */
  matrix: AccessMatrix;
  /** 원장 위인가 — 감사로그 · 대시보드 관리 · 기능 면의 입구 조건. */
  isMasterLevel: boolean;
  /** 새 학원(일반판)인가 — '기능' 면의 입구 조건. */
  isGeneric: boolean;
};

/** 이 사람에게 그 면의 **입구가 서는가** — 권한 + 원장 위 전용 + 일반판 전용. */
export function canOpenOwnerFace(key: OwnerFaceKey, gate: OwnerFaceGate): boolean {
  const face = OWNER_FACES.find((f) => f.key === key);
  if (!face) return false;
  if (face.genericOnly && !gate.isGeneric) return false;
  if (face.masterOnly && !gate.isMasterLevel) return false;
  return canAccess(gate.systemRole, ownerFaceMenu(key), gate.matrix);
}

/**
 * 그 면의 **본문이 이 사람에게 안내뿐인가** — 역할·권한 면의 편집 폼은 역할이 원장일 때만 선다(그 밖의 계정엔 "원장만 바꿀 수
 * 있습니다" 안내). 탭은 서지만(왜 못 바꾸는지 적혀 있다), 대신 보낼 면으로는 쓸 수 있는 면을 먼저 고른다.
 */
function isNoticeOnlyFace(key: OwnerFaceKey, gate: OwnerFaceGate): boolean {
  return key === "permissions" && gate.systemRole !== "master";
}

/**
 * 요청한 면의 **권한이 없을 때** 대신 보낼 면 — 입구가 서는 첫 면(목록 순서). 보낼 곳이 없으면 null(기존 가드가 처리한다).
 *  · 요청한 면의 권한이 있으면 null — 보내지 않는다(원장 위 전용 면에 위임 계정이 오면 그 면이 직접 안내한다).
 *  · 요청한 면 자신은 후보가 아니다(제 주소로 되돌리지 않는다).
 *  · 본문이 안내뿐인 면(역할·권한 — 원장이 아닐 때)은 **쓸 수 있는 면이 하나도 없을 때만** 고른다.
 */
export function fallbackOwnerFace(requested: OwnerFaceKey, gate: OwnerFaceGate): OwnerFaceDef | null {
  if (canAccess(gate.systemRole, ownerFaceMenu(requested), gate.matrix)) return null;
  const candidates = OWNER_FACES.filter((f) => f.key !== requested && canOpenOwnerFace(f.key, gate));
  return candidates.find((f) => !isNoticeOnlyFace(f.key, gate)) ?? candidates[0] ?? null;
}

/** 면의 주소 — 창(embed) 안에서 보낼 때는 `embed=1`을 싣는다(빼면 창 안에 전체 화면 틀이 뜬다 — gotchas #133). */
export function ownerFaceHref(face: Pick<OwnerFaceDef, "href">, embed: boolean): string {
  if (!embed) return face.href;
  return `${face.href}${face.href.includes("?") ? "&" : "?"}embed=1`;
}
