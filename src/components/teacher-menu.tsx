"use client";

import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import {
  LayoutGrid,
  Users,
  CalendarCheck,
  CalendarDays,
  BookOpen,
  BookMarked,
  FolderOpen,
  GraduationCap,
  MessageCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { EXTERNAL_NAV } from "@/lib/navigation";
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
const LINKS: { href: string; label: string; icon: LucideIcon; menu: MenuKey }[] = [
  { href: "/onescreen", label: "수업 마감 (원스크린)", icon: LayoutGrid, menu: "teacher_onescreen" },
  { href: "/students", label: "내 학생", icon: Users, menu: "students" },
  { href: "/attendance", label: "출석부", icon: CalendarCheck, menu: "attendance" },
  { href: "/classes", label: "내 수업", icon: BookOpen, menu: "classes" },
  { href: "/timetable", label: "시간표", icon: CalendarDays, menu: "timetable" },
  { href: "/exams", label: "성적관리", icon: GraduationCap, menu: "exams" },
  { href: "/consultations", label: "학생상담", icon: MessageCircle, menu: "consultations" },
  // 교재 요청 — 강사 스코프(본인 담당 학생) 요청 + 진행상태. 사무실은 /billing 교재 면에서 처리.
  { href: "/textbook-requests", label: "교재 요청", icon: BookMarked, menu: "textbook_requests" },
  // 데이터베이스(서식 저장소) — 강사 readonly(빈 양식 다운로드). 테넌트 공용 자료라 스코핑 무관.
  { href: "/documents", label: "데이터베이스", icon: FolderOpen, menu: "documents" },
];

export function TeacherMenu({ permMatrix }: { permMatrix: AccessMatrix }) {
  // 학원 권한 매트릭스에서 강사 접근이 '없음'인 탭은 숨긴다(설정 반영). teacher_onescreen은 항상 통과(locked full).
  const links = LINKS.filter((l) => canAccess("teacher", l.menu, permMatrix));
  // 수업보고서 = 외부 앱(Edutrix). 사이드바와 동일 소스(EXTERNAL_NAV)·동일 링크. cross-origin이라 새 탭(_blank).
  const report = EXTERNAL_NAV.find((e) => e.label === "수업보고서");
  const ReportIcon = report?.icon;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="outline" size="sm" className="gap-1.5 rounded-md" />}
      >
        <LayoutGrid className="size-4" /> 내 메뉴
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="text-text-faint">강사 메뉴</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {links.map(({ href, label, icon: Icon }) => (
          <DropdownMenuItem key={href} render={<Link href={href} className="cursor-pointer" />}>
            <Icon className="size-4" /> {label}
          </DropdownMenuItem>
        ))}
        {report && ReportIcon ? (
          <DropdownMenuItem
            render={<a href={report.href} target="_blank" rel="noopener noreferrer" className="cursor-pointer" />}
          >
            <ReportIcon className="size-4" /> {report.label}
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
