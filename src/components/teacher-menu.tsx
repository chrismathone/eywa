"use client";

import Link from "next/link";
import { EyIcon, MENU_ICON, type EywaIconName } from "@/components/icons/eywa-icons";
import { Button } from "@/components/ui/button";
import { switchToAdminView } from "@/features/shell/view-actions";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { canAccess, type AccessMatrix, type MenuKey } from "@/lib/permissions";

/**
 * 강사 미니멀 셸용 '내 메뉴' 드롭다운(B 옵션 — onescreen 허브 + 필요한 깊은 페이지 진입).
 * ⚠️ 여기엔 **강사 스코핑이 적용된 페이지만** 넣는다(teacher-scope.ts). 미스코프 페이지(대시보드 등)는
 * 테넌트 전체가 새므로 노출 금지 — 스코핑하면 그때 추가. (시간표는 getWeeklyScheduleWithStudents(teacherId) 스코핑 완료.)
 * 어떤 탭을 노출할지는 **학원설정(역할·권한)의 강사 접근 매트릭스**를 따른다 — 학원이 '강사 내 메뉴 표시'를
 * 끄면(teacher 접근=없음) 그 탭이 숨겨지고 페이지 접근도 차단된다(canWriteTenant/requireAccess 게이트와 일관).
 * teacher_onescreen(수업 마감)은 ROLE_LOCKED라 항상 표시.
 */
const LINKS: { href: string; label: string; icon: EywaIconName; menu: MenuKey }[] = [
  // 출결 모드(2026-08-20) — 내 반 오늘 출결만 터치 몇 번으로. 원장 지시: 원스크린 상단 바에만 두니
  //   *"완전 안보인다"* → 강사의 주 진입로인 이 드롭다운에도 올린다(홈 바로 아래).
  //   ⚠️ 권한 키는 출석부와 같은 `attendance` — 새 메뉴 키를 만들면 auth_menu_access DEFAULTS 누락으로 잠긴다.
  { href: "/attendance/quick", label: "출결 모드", icon: MENU_ICON.attendance, menu: "attendance" },
  { href: "/onescreen", label: "수업 마감 (원스크린)", icon: MENU_ICON.teacher_onescreen, menu: "teacher_onescreen" },
  // English Class Sheet — 영어 반별 주간 수업계획서/출석부(scoped: 담당 반만. requireEcsClassAccess 게이트).
  { href: "/ecs", label: "영어 강사 시트", icon: MENU_ICON.ecs, menu: "ecs" },
  // Math Class Sheet — 수학 반별 월간 진도표(scoped: 담당 반만. requireMcsClassAccess 게이트).
  // 🔴 이 줄이 없어서 **수학만 맡은 강사 9명에게는 MCS로 가는 길이 아예 없었다**(폰엔 사이드바가 없고
  //    이 드롭다운이 강사의 유일한 진입로다). 노출 조건은 영어와 대칭(`showMcs`).
  { href: "/mcs", label: "수학 강사 시트", icon: MENU_ICON.mcs, menu: "mcs" },
  { href: "/students", label: "내 학생", icon: MENU_ICON.students, menu: "students" },
  { href: "/attendance", label: "출석부", icon: MENU_ICON.attendance, menu: "attendance" },
  { href: "/classes", label: "내 수업", icon: MENU_ICON.classes, menu: "classes" },
  { href: "/timetable", label: "시간표", icon: MENU_ICON.timetable, menu: "timetable" },
  { href: "/exams", label: "성적관리", icon: MENU_ICON.exams, menu: "exams" },
  { href: "/consultations", label: "학생상담", icon: MENU_ICON.consultations, menu: "consultations" },
  // 교재 요청 — 강사 스코프(본인 담당 학생) 요청 + 진행상태. 사무실은 /billing 교재 면에서 처리.
  { href: "/textbook-requests", label: "교재 요청", icon: MENU_ICON.textbook_requests, menu: "textbook_requests" },
  // 지출결의서 — 강사가 본인 지출을 작성·제출 + 결재 진행상태 조회. 사무실은 /billing 지출 면에서 결재.
  { href: "/expense-requests", label: "지출결의서", icon: MENU_ICON.expense_requests, menu: "expense_requests" },
  // 캘린더 — 학원 공용 일정(강사 readonly 기본). 테넌트 공용 정보라 스코핑 무관.
  { href: "/calendar", label: "캘린더", icon: MENU_ICON.calendar, menu: "calendar" },
  // 전자결재 — 기본 teacher=none이라 파일럿 개인 예외 계정(테스터)에만 보인다. 문서 스코프는
  // 결재선·RLS가 정하므로(본인 관련 문서만) 미스코프 누수 없음.
  { href: "/approvals", label: "전자결재", icon: MENU_ICON.approvals, menu: "approvals" },
  // 수업 평가 — 강사는 **자기 평가 전용**(본인 평가지의 본인 채점만 보이고 쓸 수 있다, 원장 2026-08-19).
  // 기본 teacher=none이라 학원설정에서 연 학원에서만 보인다.
  { href: "/class-review", label: "수업 평가", icon: MENU_ICON.class_review, menu: "class_review" },
  // 데이터베이스(서식 저장소) — 강사 readonly(빈 양식 다운로드). 테넌트 공용 자료라 스코핑 무관.
  { href: "/documents", label: "데이터베이스", icon: MENU_ICON.documents, menu: "documents" },
];

export function TeacherMenu({
  permMatrix,
  canReturnToAdmin = false,
  showEcs = true,
  showMcs = true,
  home = null,
}: {
  permMatrix: AccessMatrix;
  /** 겸직(관리자 계열)이 강사뷰에 있을 때 → 드롭다운 하단에 '관리자뷰로 전환'. 실 강사는 false. */
  canReturnToAdmin?: boolean;
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
}) {
  // 학원 권한 매트릭스에서 강사 접근이 '없음'인 탭은 숨긴다(설정 반영). teacher_onescreen은 항상 통과(locked full).
  // 수업보고서 오버사이트(/lesson-reports)는 teacher=none — 작성은 /onescreen. 옛 Edutrix 외부링크는 제거됨.
  const visible = LINKS.filter(
    (l) =>
      canAccess("teacher", l.menu, permMatrix) &&
      (l.menu !== "ecs" || showEcs) &&
      (l.menu !== "mcs" || showMcs),
  );
  // 홈을 첫 줄로. 나머지는 원래 순서를 그대로 보존한다(가장 위 한 줄만 바뀌는 최소 변화).
  const links = home ? [...visible.filter((l) => l.href === home), ...visible.filter((l) => l.href !== home)] : visible;
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        render={<Button variant="outline" size="sm" className="gap-1.5" />}
      >
        <EyIcon name="screen" size={16} strokeWidth={1.8} /> 내 메뉴
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="text-text-faint">강사 메뉴</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {links.map(({ href, label, icon }) => (
          <DropdownMenuItem key={href} render={<Link href={href} className="cursor-pointer" />}>
            <EyIcon name={icon} size={16} strokeWidth={1.8} /> {label}
          </DropdownMenuItem>
        ))}
        {/* 내 정보 — 본인 이력서·로그인 정보. 권한 매트릭스와 무관(자기 것만이라 항상 표시). */}
        <DropdownMenuSeparator />
        <DropdownMenuItem render={<Link href="/me" className="cursor-pointer" />}>
          <EyIcon name="user" size={16} strokeWidth={1.8} /> 내 정보
        </DropdownMenuItem>
        {/* 겸직(관리자 계열)만 — 맨 하단 구분선 아래 '관리자뷰로 전환'(쿠키만 지우고 관리자 홈 복귀, 권한 불변).
            액션이 착지경로를 반환 → window.location으로 확정 네비게이션(드롭다운 안에선 서버액션 redirect의
            클라 네비게이션이 유실되기 때문). closeOnClick=false로 액션 완료 전 메뉴가 닫히는 것을 방지. */}
        {canReturnToAdmin ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              closeOnClick={false}
              className="cursor-pointer"
              onClick={async () => {
                const dest = await switchToAdminView();
                window.location.assign(dest);
              }}
            >
              <EyIcon name="building" size={16} strokeWidth={1.8} /> 관리자뷰로 전환
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
