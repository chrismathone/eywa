/**
 * 빠른 작업 — '오늘'을 작업 시작점으로. 자주 쓰는 신규 등록 경로를 한 줄로.
 * (모달 대신 해당 신규 화면을 플로팅 창으로 — 반응속도 철학 + 멀티윈도우 일관.)
 */
import { UserPlus, BookPlus, MessageSquarePlus } from "@/components/icons/eywa-icon-compat";
import { WindowLink } from "@/components/workspace/window-link";
import { CONTROL_H, CONTROL_LABEL } from "@/components/ui/control-scale";

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
          // 보더 없는 텍스트 동작(지시서 §10) — 치수는 control-scale 한 벌, 아이콘은 글자 크기(1em).
          className={`${CONTROL_H} ${CONTROL_LABEL} text-primary hover:bg-bg-soft focus-visible:ring-primary/35 inline-flex items-center gap-1 rounded-md px-1.5 font-medium whitespace-nowrap transition focus-visible:ring-2 focus-visible:outline-none`}
        >
          <a.icon className="size-[1em]" />
          {a.label}
        </WindowLink>
      ))}
    </div>
  );
}
