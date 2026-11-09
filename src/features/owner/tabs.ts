/**
 * 학원 설정(/owner) 면 목록 — **단일 소스**.
 *
 * 🔴 원장 지적(2026-08-07): *"자꾸 탭의 세부탭 목록을 하드코딩하는 것 같은데, 세션 기간이 있으면
 *    좌측에도 세션기간이 있어야지."* 지금까지 상단 FaceTabs(`page.tsx`의 FACES)와 왼쪽 사이드바
 *    하부탭(`navigation.ts`의 SUBTABS_BY_MENU)이 **같은 목록을 각각** 들고 있었다. 한쪽만 고치면
 *    사이드바가 stale해지고, 실제로 '상담 양식'은 오래전부터 사이드바에서 빠져 있었다.
 *    → 목록을 여기 한 곳에만 두고 양쪽이 파생해 쓴다. **면을 더하거나 지울 땐 이 배열만 고친다.**
 *    (2026-10-06: 설정 메뉴 판의 버튼·범주도 이 배열에서 파생한다 — 면마다의 그림만 `menu-hub.ts`가 붙인다.)
 *
 * ⚠️ 순수 상수 모듈이어야 한다(서버 page.tsx와 클라 사이드바가 같이 import) — `server-only` 금지(#61·#81).
 */

export type OwnerTab =
  | "profile"
  | "operations"
  | "subjects"
  | "makeups"
  | "evaluation"
  | "contribution"
  | "billing"
  | "notifications"
  | "consultations"
  | "permissions"
  | "navigation"
  | "dashboard"
  | "popups"
  | "data"
  | "import"
  | "audit"
  | "sheets";

/** 일반판에만 서는 '기능' 면까지 포함한 면 키. */
export type OwnerFaceKey = OwnerTab | "modules";

/**
 * 면의 **범주** — 설정 메뉴 판(왼쪽 '설정'을 눌렀을 때의 버튼 묶음)이 이 제목으로 면을 묶는다.
 * 🔴 범주는 여기 한 곳에서만 정한다(2026-10-06). 전에는 메뉴 판(`menu-hub.ts`)이 같은 면을 **제 목록으로 따로** 들고 있어서
 *    라벨이 갈리고('대시보드 관리' ↔ '대시보드 구성'), 화면 탭의 묶음(설정 ┃ 관리)과 메뉴 판의 묶음이 서로 달랐다
 *    (팝업 공지가 한쪽에선 '관리', 다른 쪽에선 '청구·안내').
 */
export type OwnerCategory = "학원 정보" | "수업·운영" | "청구·안내" | "권한·화면" | "관리";

export type OwnerFaceDef = {
  key: OwnerFaceKey;
  label: string;
  href: string;
  /** FaceTabs가 group 경계에 세로 구분선을 넣는다(설정 ┃ 관리). */
  group: "설정" | "관리";
  category: OwnerCategory;
  /**
   * 새 학원(일반판)에만 서는 면 — 침산 화면은 이 면이 생기기 전과 같아야 한다(원장 2026-09-22).
   * 사이드바 하부탭·도움말 목차가 쓰는 `OWNER_TABS`에는 들지 않는다.
   */
  genericOnly?: true;
  /**
   * 원장 위에게만 입구를 세우는 면 — 위임 계정엔 눌러도 안내 문구뿐이라 탭·버튼을 세우지 않는다.
   * ⚠️ 입구를 정리하는 표식일 뿐 게이트가 아니다 — 자물쇠는 화면 본문·저장 액션·DB 정책이 각각 건다([[#77]]).
   */
  masterOnly?: true;
};

export type OwnerTabDef = OwnerFaceDef & { key: OwnerTab };

/**
 * 표시 순서 그대로(화면 탭 = 메뉴 판의 범주 안 순서). 첫 항목(profile)은 기본 면이라 href에 `?tab=`이 없다.
 *
 * 📌 '세션 기간'은 **독립 면이 아니다** — 과목 운영 안에서 과목별로 편집한다(원장 2026-08-07:
 *    *"세션기간을 과목 운영에 넣어"* · *"운영 과목-과목 설정도 하나로 합쳐도 되겠는데"*).
 *    세션은 과목마다 다른 값이라, 과목을 고른 자리에서 바로 칠하는 게 맞다.
 */
export const OWNER_FACES: readonly OwnerFaceDef[] = [
  { key: "profile", label: "프로필·브랜드", href: "/owner", group: "설정", category: "학원 정보" },
  { key: "operations", label: "운영 체계", href: "/owner?tab=operations", group: "설정", category: "수업·운영" },
  { key: "subjects", label: "과목 운영", href: "/owner?tab=subjects", group: "설정", category: "수업·운영" },
  // 보강 운영 = 보강관리를 켜고 끄는 운영 모드(원장 2026-10-06 *"수업 운영에 '보강 운영'을 새로 만들어서 넣어줘"*).
  // 전에는 운영 체계 면 맨 아래에 제 저장 버튼을 달고 붙어 있었다 — 운영 설정과 다른 묶음이라 저장 경로가 따로다
  // (운영 모드 전환은 DB가 열린 보강 건을 확인하며 원자적으로 바꾼다). 원장 위만 바꾼다(저장 액션과 같은 선).
  { key: "makeups", label: "보강 운영", href: "/owner?tab=makeups", group: "설정", category: "수업·운영", masterOnly: true },
  // 강사평가 = 직원 포트폴리오의 지표·만점·점수 규칙(원장 2026-10-13 *"설정에서 강사평가 항목을 새로 추가하고 원장이 각종
  // 파라미터 지표를 세부 디테일 수정"*). 직원 평가가 실험실 메뉴인 동안은 실험실을 켠 지점에서만 선다(보강 운영과 같은 결).
  { key: "evaluation", label: "강사평가", href: "/owner?tab=evaluation", group: "설정", category: "수업·운영", masterOnly: true },
  { key: "contribution", label: "원생 충성도", href: "/owner?tab=contribution", group: "설정", category: "수업·운영", masterOnly: true },
  { key: "billing", label: "수납·청구", href: "/owner?tab=billing", group: "설정", category: "청구·안내" },
  { key: "notifications", label: "알림·약관", href: "/owner?tab=notifications", group: "설정", category: "청구·안내" },
  { key: "consultations", label: "상담 양식", href: "/owner?tab=consultations", group: "설정", category: "청구·안내" },
  { key: "permissions", label: "역할·권한", href: "/owner?tab=permissions", group: "설정", category: "권한·화면" },
  // 왼쪽 탭 = 사이드바에 **무엇을 보일지·어떤 순서로**(원장 2026-09-09 *"설정에서 탭 하나 추가해서
  // 왼쪽 탭 설정이 있으면 좋겠네"*). 역할·권한 바로 뒤에 두는 건 둘이 같은 물음("누가 무엇을 보나")에
  // 답해서다 — 단 이쪽은 **규칙이 아니라 취향**이고, 권한을 대체하지 않는다(menu-layout.ts 참조).
  { key: "navigation", label: "탭 및 메뉴 구성", href: "/owner?tab=navigation", group: "설정", category: "권한·화면" },
  // '기능'(모듈 켜기·끄기) — 새 학원(일반판)에만, 원장 위에게만 선다. 무엇이 있나를 정하는 층이라 권한 옆에 둔다.
  { key: "modules", label: "기능", href: "/owner?tab=modules", group: "설정", category: "권한·화면", genericOnly: true, masterOnly: true },
  // 대시보드 관리 = 역할마다 운영실에 **무엇을 어디에 얼마나 크게**(원장 2026-10-01 *"설정에 대시보드 관리 전용 탭을 추가하고
  // 각 역할별로 넣을 항목 커스터마이징"*). 권한처럼 "누가 무엇을 보나"라 원장 위만 편집한다(위임 계정엔 안내 문구 — page.tsx).
  { key: "dashboard", label: "대시보드 관리", href: "/owner?tab=dashboard", group: "설정", category: "권한·화면", masterOnly: true },
  // 관리 그룹(구 /admin 흡수) — 팝업 공지·데이터 정리(고아+중복 통합)·감사·연동.
  { key: "popups", label: "팝업 공지", href: "/owner?tab=popups", group: "관리", category: "관리" },
  { key: "data", label: "데이터 정리", href: "/owner?tab=data", group: "관리", category: "관리" },
  // 엑셀로 한꺼번에 넣기(원장 2026-09-29 *"다른 지점에서 업로드용 엑셀 양식을 다운로드 받고 업로드를 통해 모든 데이터 업로드"*) —
  // 각 탭에 있는 '엑셀로 넣기'를 도입 순서대로 한 화면에 모은 허브. 올리는 기계는 탭과 같다(features/excel-import).
  { key: "import", label: "데이터 가져오기", href: "/owner?tab=import", group: "관리", category: "관리" },
  // 원장 전용(원장 2026-09-09 *"감사로그는 마스터 이상급으러만"*) — DB 정책도 그렇게 좁혔다(0253a).
  { key: "audit", label: "감사로그", href: "/owner?tab=audit", group: "관리", category: "관리", masterOnly: true },
  { key: "sheets", label: "연동", href: "/owner?tab=sheets", group: "관리", category: "관리" },
] as const;

/**
 * 어느 학원에나 서는 면 — 사이드바 하부탭 · 도움말 목차 · 주소 해석(`resolveOwnerTab`)이 쓴다.
 * 일반판 전용 면('기능')은 들지 않는다(넣으면 침산 화면에 버튼이 생긴다).
 */
export const OWNER_TABS: readonly OwnerTabDef[] = OWNER_FACES.filter((f): f is OwnerTabDef => !f.genericOnly);

export const OWNER_TAB_KEYS: readonly OwnerTab[] = OWNER_TABS.map((t) => t.key);

export function ownerTabLabel(key: OwnerFaceKey): string {
  return OWNER_FACES.find((t) => t.key === key)?.label ?? "설정";
}

/** 쿼리스트링 → 면. 모르는 값이면 기본 면. 옛 북마크(dup→data)는 호출부가 먼저 흡수한다. */
export function resolveOwnerTab(raw: string | undefined): OwnerTab {
  return raw && (OWNER_TAB_KEYS as string[]).includes(raw) ? (raw as OwnerTab) : "profile";
}
