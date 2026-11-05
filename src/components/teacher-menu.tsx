"use client";

import Link from "next/link";
import { EyIcon, MENU_ICON } from "@/components/icons/aywa-icons";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { MenuKey } from "@/lib/permissions";
// 강사뷰 화면 언어(2026-09-03) — 라벨은 사전에서, 스위치는 이 드롭다운 **하나**(원장 지정 자리).
import { useSheetLang, useSheetT } from "@/features/teacher-view/lang-context";
import { TeacherLangSwitch } from "@/features/teacher-view/lang-switch";
import { type MenuLayout, type MenuGroupLayout } from "@/features/owner/menu-layout";
import { teacherNavigationFor } from "@/lib/teacher-navigation";
import { TeacherNavigationItems } from "./teacher-navigation-items";
import type { ConnectedApp } from "@/features/connected-apps/apps";

/**
 * 강사 미니멀 셸용 '내 메뉴' 드롭다운(B 옵션 — onescreen 허브 + 필요한 깊은 페이지 진입).
 * ⚠️ 여기엔 **강사 스코핑이 적용된 페이지만** 넣는다(teacher-scope.ts). 미스코프 페이지(대시보드 등)는
 * 테넌트 전체가 새므로 노출 금지 — 스코핑하면 그때 추가. (시간표는 getWeeklyScheduleWithStudents(teacherId) 스코핑 완료.)
 * 어떤 탭을 노출할지는 레이아웃이 [teacherMenuKeysFor](@/lib/navigation)로 정해 `menus`로 내려준다 —
 * ① 학원설정의 강사 접근('강사 내 메뉴 표시'를 끄면 그 탭이 숨고 페이지도 막힌다) ∧ ② 보는 사람의 **실제 역할**
 * (겸직 강사뷰·'다른 강사 뷰'에서 누르면 튕기는 항목을 세우지 않는다) ∧ ③ 입구 정책(메뉴에서 뺀 항목은 여기서도 닫는다).
 * teacher_onescreen(수업 마감)은 ROLE_LOCKED + 뷰 기준 게이트라 항상 표시.
 */

export function TeacherMenu({
  menus,
  showEcs = true,
  showMcs = true,
  home = null,
  layout,
  groups,
  connectedApps = [],
}: {
  /**
   * 이 사람의 '내 메뉴'에 세울 메뉴 키 — 레이아웃이 [teacherMenuKeysFor](@/lib/navigation)로 계산해 내린다
   * (강사 행 ∧ 보는 사람의 실제 역할 ∧ 입구 정책). 페이지 게이트와 같은 판정이라 **보이면 열린다**.
   */
  menus: readonly MenuKey[];
  /**
   * English Class Sheet는 **영어 반 담당·부담임일 때만** 보인다(원장 지시 2026-07-29, 부담임 확장 승인).
   * 권한(ecs=scoped)은 전 강사가 갖고 있어 그것만으론 못 거른다 — 담당·부담임 여부는 서버에서만 알 수
   * 있으므로(`effectiveTeacherScope`·`ecsAssistantClassIds`) 레이아웃이 계산해 내려준다. 모르면 표시(fail-open).
   */
  showEcs?: boolean;
  /**
   * Math Class Sheet는 **수학 반 담당일 때만** 보인다(영어와 대칭). 권한(mcs=scoped)은 전 강사가
   * 갖고 있어 그것만으론 못 거른다 — 담당 과목은 서버에서만 안다. 모르면 표시(fail-open).
   * ⚠️ MCS엔 **부담임 갈래가 없다**(수학 슬롯의 `teacher_id`가 전부 null — access.ts 주석) —
   *    그래서 영어처럼 `ecsAssistantClassIds` 같은 폴백을 두지 않는다.
   */
  showMcs?: boolean;
  /**
   * 이 강사의 홈 경로([teacherViewHome](src/lib/auth/teacher-home.ts)) — 그 항목이 **맨 위**로 올라온다.
   * 영어 전담은 `/ecs`, 그 외는 `/onescreen`(원장 지시 2026-08-07 "영어 강사는 ECS 기반 원스크린").
   * ⚠️ 홈이 아닌 쪽을 **숨기지는 않는다** — 영어 강사도 보강·대타로 원스크린이 필요할 수 있고, 안 보이면
   * "쓴 게 안 보임"이 된다. 순서만 바꾼다. 모르면(null) 기존 순서 그대로.
   */
  home?: string | null;
  /**
   * 학원 설정 '탭 및 메뉴 구성 → 강사뷰' — 이름·아이콘·숨김·순서를 적용하고 teacherGroups에 폴더를 담는다.
   * **보기 설정이지 권한이 아니다**(위 `menus`가 먼저 거른다). 홈은 감춰도 남고 늘 맨 위다(`teacherNavigationFor`).
   * 비어 있으면(기본) 코드 순서 + 홈 맨 위 — 이 설정 이전과 같다.
   */
  layout?: MenuLayout;
  groups?: MenuGroupLayout;
  /**
   * 연결 앱(오늘 수학 등) — 레이아웃이 [`getMyConnectedApps`](@/features/connected-apps/server/visible)로 거른 목록
   * (지점 스위치 ∧ 담당 과목 — 영어 선생님에겐 비어 온다). 풀셸 사이드바 '연결 앱'과 같은 **보통 링크(새 탭)**다.
   */
  connectedApps?: readonly ConnectedApp[];
}) {
  // 화면 언어 — provider는 강사 미니셸에만 있다(관리자 풀셸은 한국어 고정, 원장 2026-09-03).
  const t = useSheetT();
  const lang = useSheetLang();
  // 세울 메뉴는 레이아웃이 정해 내려준다(menus). 🔴 여기서 권한 매트릭스로 다시 거르지 말 것 — 강사 행만 보면
  // 겸직·'다른 강사 뷰'에서 누르면 강사 홈으로 튕기는 항목이 되살아난다(2026-09-11 전수검사).
  // 수업보고서 오버사이트(/lesson-reports)는 teacher=none — 작성은 /onescreen. 옛 Edutrix 외부링크는 제거됨.
  const navigation = teacherNavigationFor({ menus, layout, groups, home, showEcs, showMcs, lang });
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        render={<Button variant="outline" size="sm" className="gap-1.5" />}
      >
        <EyIcon name="screen" size={16} strokeWidth={1.8} /> {t("menu.trigger")}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="text-text-faint">{t("menu.heading")}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <TeacherNavigationItems navigation={navigation} />
        {/* 연결 앱 — aywa 밖의 앱이라 메뉴 줄과 구분선으로 떼고, 끝의 바깥 화살표가 "새 탭으로 나간다"를 말한다.
            🔴 `Link`가 아니라 맨 `<a target=_blank>` — 출발 라우트(자동 로그인 표)는 라우트 핸들러라 클라 이동으로 못 간다. */}
        {connectedApps.length > 0 ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-text-faint">{t("menu.connectedApps")}</DropdownMenuLabel>
            {connectedApps.map((a) => (
              <DropdownMenuItem
                key={a.feature}
                render={<a href={a.launchPath} target="_blank" rel="noopener noreferrer" className="cursor-pointer" />}
              >
                <EyIcon name={MENU_ICON[a.permission]} size={16} strokeWidth={1.8} /> {a.label}
                <EyIcon name="externalLink" size={13} strokeWidth={1.8} className="ml-auto size-3.5 opacity-70" />
              </DropdownMenuItem>
            ))}
          </>
        ) : null}
        {/* 내 정보 — 본인 이력서·로그인 정보. 권한 매트릭스와 무관(자기 것만이라 항상 표시). */}
        <DropdownMenuSeparator />
        <DropdownMenuItem render={<Link href="/me" className="cursor-pointer" />}>
          <EyIcon name="user" size={16} strokeWidth={1.8} /> {t("menu.me")}
        </DropdownMenuItem>
        {/* 화면 언어(한국어 / English) — 원장 2026-09-03이 **이 자리**를 지정했다("내 메뉴에서 한영전환").
            🔴 **`DropdownMenuItem`으로 감싸지 않는다** — 메뉴 항목은 "누르면 하나가 실행되고 닫히는 줄"이라
               그 안에 버튼 둘을 넣으면 ① 메뉴 항목과 버튼이 클릭·키보드를 서로 뺏고 ② 스크린리더에 중첩
               인터랙티브(menuitem 안의 button)로 읽힌다. 팝업의 **평범한 자식**으로 두면 항목 의미가 없어
               그 두 문제가 함께 사라진다(닫힘 제어도 필요 없다 — 항목이 아니라 닫히지 않는다).
            ⚠️ 그래서 `closeOnClick`도 안 쓴다. 저장은 이동이 아니라 `router.refresh()`라 메뉴가 열린 채
               라벨이 그 자리에서 바뀐다(누른 결과가 눈앞에서 보인다). */}
        <DropdownMenuSeparator />
        <TeacherLangSwitch />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
