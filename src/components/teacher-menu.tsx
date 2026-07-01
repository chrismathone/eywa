"use client";

import Link from "next/link";
import {
  LayoutGrid,
  Users,
  CalendarCheck,
  CalendarDays,
  BookOpen,
  BookMarked,
  GraduationCap,
  MessageCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * 강사 미니멀 셸용 '내 메뉴' 드롭다운(B 옵션 — onescreen 허브 + 필요한 깊은 페이지 진입).
 * ⚠️ 여기엔 **강사 스코핑이 적용된 페이지만** 넣는다(teacher-scope.ts). 미스코프 페이지(대시보드 등)는
 * 테넌트 전체가 새므로 노출 금지 — 스코핑하면 그때 추가. (시간표는 getWeeklyScheduleWithStudents(teacherId) 스코핑 완료.)
 */
const LINKS = [
  { href: "/onescreen", label: "수업 마감 (원스크린)", icon: LayoutGrid },
  { href: "/students", label: "내 학생", icon: Users },
  { href: "/attendance", label: "출석부", icon: CalendarCheck },
  { href: "/classes", label: "내 수업", icon: BookOpen },
  { href: "/timetable", label: "시간표", icon: CalendarDays },
  { href: "/exams", label: "성적관리", icon: GraduationCap },
  { href: "/consultations", label: "학생상담", icon: MessageCircle },
  // 교재 요청 — 강사 스코프(본인 담당 학생) 요청 + 진행상태. 사무실은 /billing 교재 면에서 처리.
  { href: "/textbook-requests", label: "교재 요청", icon: BookMarked },
] as const;

export function TeacherMenu() {
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
        {LINKS.map(({ href, label, icon: Icon }) => (
          <DropdownMenuItem key={href} render={<Link href={href} className="cursor-pointer" />}>
            <Icon className="size-4" /> {label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
