/**
 * 빠른 작업 — 대시보드를 작업 시작점으로. 자주 쓰는 신규 등록 경로를 한 줄로.
 * (모달 대신 해당 신규 화면을 플로팅 창으로 — 반응속도 철학 + 멀티윈도우 일관.)
 */
import { UserPlus, BookPlus, MessageSquarePlus } from "lucide-react";
import { WindowLink } from "@/components/workspace/window-link";

const ACTIONS = [
  { href: "/students/new", title: "학생 등록", label: "학생 등록", icon: UserPlus },
  { href: "/classes", title: "수업 관리", label: "수업 추가", icon: BookPlus },
  { href: "/consultations/new", title: "상담 기록", label: "상담 기록", icon: MessageSquarePlus },
];

export function QuickActions() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="micro mr-1">빠른 작업</span>
      {ACTIONS.map((a) => (
        <WindowLink
          key={a.href}
          href={a.href}
          title={a.title}
          className="border-line bg-card text-foreground hover:bg-bg-soft inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition"
        >
          <a.icon className="size-3.5" />
          {a.label}
        </WindowLink>
      ))}
    </div>
  );
}
