/**
 * 학원 설정(/owner) 면 목록 — **단일 소스**.
 *
 * 🔴 원장 지적(2026-08-07): *"자꾸 탭의 세부탭 목록을 하드코딩하는 것 같은데, 세션 기간이 있으면
 *    좌측에도 세션기간이 있어야지."* 지금까지 상단 FaceTabs(`page.tsx`의 FACES)와 왼쪽 사이드바
 *    하부탭(`navigation.ts`의 SUBTABS_BY_MENU)이 **같은 목록을 각각** 들고 있었다. 한쪽만 고치면
 *    사이드바가 stale해지고, 실제로 '상담 양식'은 오래전부터 사이드바에서 빠져 있었다.
 *    → 목록을 여기 한 곳에만 두고 양쪽이 파생해 쓴다. **면을 더하거나 지울 땐 이 배열만 고친다.**
 *
 * ⚠️ 순수 상수 모듈이어야 한다(서버 page.tsx와 클라 사이드바가 같이 import) — `server-only` 금지(#61·#81).
 */

export type OwnerTab =
  | "profile"
  | "operations"
  | "subjects"
  | "billing"
  | "notifications"
  | "consultations"
  | "permissions"
  | "navigation"
  | "popups"
  | "data"
  | "audit"
  | "sheets";

export type OwnerTabDef = {
  key: OwnerTab;
  label: string;
  href: string;
  /** FaceTabs가 group 경계에 세로 구분선을 넣는다(설정 ┃ 관리). */
  group: "설정" | "관리";
};

/**
 * 표시 순서 그대로. 첫 항목(profile)은 기본 면이라 href에 `?tab=`이 없다.
 *
 * 📌 '세션 기간'은 **독립 면이 아니다** — 과목 운영 안에서 과목별로 편집한다(원장 2026-08-07:
 *    *"세션기간을 과목 운영에 넣어"* · *"운영 과목-과목 설정도 하나로 합쳐도 되겠는데"*).
 *    세션은 과목마다 다른 값이라, 과목을 고른 자리에서 바로 칠하는 게 맞다.
 */
export const OWNER_TABS: readonly OwnerTabDef[] = [
  { key: "profile", label: "프로필·브랜드", href: "/owner", group: "설정" },
  { key: "operations", label: "운영 체계", href: "/owner?tab=operations", group: "설정" },
  { key: "subjects", label: "과목 운영", href: "/owner?tab=subjects", group: "설정" },
  { key: "billing", label: "수납·청구", href: "/owner?tab=billing", group: "설정" },
  { key: "notifications", label: "알림·약관", href: "/owner?tab=notifications", group: "설정" },
  { key: "consultations", label: "상담 양식", href: "/owner?tab=consultations", group: "설정" },
  { key: "permissions", label: "역할·권한", href: "/owner?tab=permissions", group: "설정" },
  // 왼쪽 탭 = 사이드바에 **무엇을 보일지·어떤 순서로**(원장 2026-09-09 *"설정에서 탭 하나 추가해서
  // 왼쪽 탭 설정이 있으면 좋겠네"*). 역할·권한 바로 뒤에 두는 건 둘이 같은 물음("누가 무엇을 보나")에
  // 답해서다 — 단 이쪽은 **규칙이 아니라 취향**이고, 권한을 대체하지 않는다(menu-layout.ts 참조).
  { key: "navigation", label: "탭 및 메뉴 구성", href: "/owner?tab=navigation", group: "설정" },
  // 관리 그룹(구 /admin 흡수) — 팝업 공지·데이터 정리(고아+중복 통합)·감사·연동.
  { key: "popups", label: "팝업 공지", href: "/owner?tab=popups", group: "관리" },
  { key: "data", label: "데이터 정리", href: "/owner?tab=data", group: "관리" },
  { key: "audit", label: "감사로그", href: "/owner?tab=audit", group: "관리" },
  { key: "sheets", label: "연동", href: "/owner?tab=sheets", group: "관리" },
] as const;

export const OWNER_TAB_KEYS: readonly OwnerTab[] = OWNER_TABS.map((t) => t.key);

export function ownerTabLabel(key: OwnerTab): string {
  return OWNER_TABS.find((t) => t.key === key)?.label ?? "설정";
}

/** 쿼리스트링 → 면. 모르는 값이면 기본 면. 옛 북마크(dup→data)는 호출부가 먼저 흡수한다. */
export function resolveOwnerTab(raw: string | undefined): OwnerTab {
  return raw && (OWNER_TAB_KEYS as string[]).includes(raw) ? (raw as OwnerTab) : "profile";
}
