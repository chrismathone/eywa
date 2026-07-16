/**
 * 빠른 작업 — '오늘'을 작업 시작점으로. 자주 쓰는 신규 등록 경로를 한 줄로.
 * (모달 대신 해당 신규 화면을 플로팅 창으로 — 반응속도 철학 + 멀티윈도우 일관.)
 */
import { UserPlus, BookPlus, MessageSquarePlus } from "@/components/icons/eywa-icon-compat";
import { WindowLink } from "@/components/workspace/window-link";

const ACTIONS = [
  { key: "student", href: "/students/new", title: "학생 등록", label: "학생 등록", icon: UserPlus },
  { key: "class", href: "/classes/new", title: "새 반 만들기", label: "수업 추가", icon: BookPlus },
  { key: "consultation", href: "/consultations/new", title: "상담 기록", label: "상담 기록", icon: MessageSquarePlus },
] as const;

export type QuickActionKey = (typeof ACTIONS)[number]["key"];

export function QuickActions({ allowed }: { allowed: readonly QuickActionKey[] }) {
  const allowedSet = new Set(allowed);
  const actions = ACTIONS.filter((action) => allowedSet.has(action.key));
  if (actions.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="micro mr-1">빠른 작업</span>
      {actions.map((a) => (
        <WindowLink
          key={a.href}
          href={a.href}
          title={a.title}
          className="border-line bg-card text-foreground hover:bg-bg-soft focus-visible:ring-primary/35 inline-flex min-h-11 items-center gap-1.5 rounded-md border px-3 py-2 text-xs font-medium transition focus-visible:ring-2 focus-visible:outline-none"
        >
          <a.icon className="size-3.5" />
          {a.label}
        </WindowLink>
      ))}
    </div>
  );
}
