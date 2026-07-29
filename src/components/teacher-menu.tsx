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
  { href: "/onescreen", label: "수업 마감 (원스크린)", icon: MENU_ICON.teacher_onescreen, menu: "teacher_onescreen" },
  // English Class Sheet — 영어 반별 주간 수업계획서/출석부(scoped: 담당 반만. requireEcsClassAccess 게이트).
  { href: "/ecs", label: "English Class Sheet", icon: MENU_ICON.ecs, menu: "ecs" },
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
  // 데이터베이스(서식 저장소) — 강사 readonly(빈 양식 다운로드). 테넌트 공용 자료라 스코핑 무관.
  { href: "/documents", label: "데이터베이스", icon: MENU_ICON.documents, menu: "documents" },
];

export function TeacherMenu({
  permMatrix,
  canReturnToAdmin = false,
  showEcs = true,
}: {
  permMatrix: AccessMatrix;
  /** 겸직(관리자 계열)이 강사뷰에 있을 때 → 드롭다운 하단에 '관리자뷰로 전환'. 실 강사는 false. */
  canReturnToAdmin?: boolean;
  /**
   * English Class Sheet는 **영어 반을 담당할 때만** 보인다(원장 지시 2026-07-29 "영어강사의 강사뷰에").
   * 권한(ecs=scoped)은 전 강사가 갖고 있어 그것만으론 못 거른다 — 담당 과목은 서버에서만 알 수 있으므로
   * (`effectiveTeacherScope`) 레이아웃이 계산해 내려준다. 모르면 표시(fail-open)가 기본.
   */
  showEcs?: boolean;
}) {
  // 학원 권한 매트릭스에서 강사 접근이 '없음'인 탭은 숨긴다(설정 반영). teacher_onescreen은 항상 통과(locked full).
  // 수업보고서 오버사이트(/lesson-reports)는 teacher=none — 작성은 /onescreen. 옛 Edutrix 외부링크는 제거됨.
  const links = LINKS.filter(
    (l) => canAccess("teacher", l.menu, permMatrix) && (l.menu !== "ecs" || showEcs),
  );
  return (
    <DropdownMenu>
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
