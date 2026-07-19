import {
  BookOpen,
  CalendarDays,
  ClipboardCheck,
  FileText,
  HelpCircle,
  LayoutDashboard,
  type LucideIcon,
  MessageSquare,
  Minus,
  Square,
  UserMinus,
  Users,
  Wallet,
  X,
} from "@/components/icons/eywa-icon-compat";
import { EyIcon } from "@/components/icons/eywa-icons";
import type { CSSProperties, ReactNode } from "react";

/**
 * MockWorkspace — 우리만의 차별점: 메뉴가 Windows식 플로팅 창으로 떠서 스냅·타일되는 워크스페이스.
 * 레일 아이콘·로고·활성 스타일은 실제 앱(app-sidebar.tsx / navigation.ts)과 동일하게 통일.
 * 창은 cascade ↔ 1+2 타일 레이아웃을 자동재생으로 오간다(landing.css 키프레임).
 */
const RAIL_GROUPS: { Icon: LucideIcon; active?: boolean; dot?: boolean }[][] = [
  [{ Icon: LayoutDashboard, active: true }],
  [{ Icon: CalendarDays, dot: true }, { Icon: ClipboardCheck, dot: true }, { Icon: BookOpen }],
  [{ Icon: Users }, { Icon: MessageSquare }, { Icon: UserMinus }],
  [{ Icon: Wallet }, { Icon: FileText }],
  [{ Icon: HelpCircle }],
];

export function MockWorkspace() {
  return (
    <div className="border-line-strong bg-bg-soft relative overflow-hidden rounded-[18px] border shadow-[0_1px_2px_rgba(11,16,13,0.05),0_50px_110px_-44px_rgba(11,16,13,0.45)]">
      <div className="flex" style={{ height: "clamp(360px, 44vw, 470px)" }}>
        {/* 좌측 아이콘 레일 — 실제 앱과 동일 */}
        <div className="border-line bg-sidebar flex w-[52px] shrink-0 flex-col items-center overflow-hidden border-r">
          <div className="border-line flex h-11 w-full shrink-0 items-center justify-center border-b">
            <span className="bg-ink flex size-7 items-center justify-center rounded-[6px]">
              <EyIcon name="building" size={16} strokeWidth={1.8} className="text-white" />
            </span>
          </div>
          <div className="flex flex-col items-center gap-1 py-2.5">
            {RAIL_GROUPS.map((group, gi) => (
              <div key={gi} className="flex flex-col items-center gap-1">
                {gi > 0 ? <span className="bg-line my-1 h-px w-6" /> : null}
                {group.map(({ Icon, active, dot }, i) => (
                  <span
                    key={i}
                    className={`relative flex size-8 items-center justify-center rounded-[8px] ${
                      active
                        ? "bg-primary text-primary-foreground shadow-[0_6px_14px_rgba(14,124,70,0.32)]"
                        : "text-text-dim"
                    }`}
                  >
                    <Icon size={16} strokeWidth={1.85} />
                    {dot ? <span className="bg-primary absolute bottom-0.5 left-1/2 size-1 -translate-x-1/2 rounded-full" /> : null}
                  </span>
                ))}
              </div>
            ))}
          </div>
        </div>

        {/* 캔버스 */}
        <div className="relative flex-1">
          <div className="border-line bg-card/60 flex h-9 items-center gap-2 border-b px-4 backdrop-blur-sm">
            <span className="text-text-faint font-mono text-[10px] tracking-[0.1em] uppercase">인재원수학 · 워크스페이스</span>
          </div>

          {/* 캔버스 무대 (헤더 아래) */}
          <div className="absolute inset-x-0 top-9 bottom-0">
            {/* 스냅 타일 고스트 — 타일 구간에만 점등 */}
            <span
              className="ey-ws-ghost border-primary/40 bg-primary/5 absolute rounded-[10px] border-2 border-dashed"
              style={{ right: "4%", top: "6%", bottom: "7%", width: "43%" }}
              aria-hidden="true"
            />

            {/* 창 3개 — 자동 재배치 */}
            <Win title="출석부 · 중2 A반" anim="ey-wsc" style={{ left: "50%", top: "22%", width: "40%", height: "40%", zIndex: 12 }}>
              <MiniAttendance />
            </Win>
            <Win title="시간표 · 통합뷰" anim="ey-wsb" style={{ left: "30%", top: "36%", width: "42%", height: "44%", zIndex: 10 }}>
              <MiniTimetable />
            </Win>
            <Win title="오늘" focused anim="ey-wsa" style={{ left: "6%", top: "14%", width: "46%", height: "62%", zIndex: 20 }}>
              <MiniDashboard />
            </Win>

            {/* 커서 — 창을 끌어 타일로 옮기는 흉내 */}
            <svg className="ey-ws-cursor pointer-events-none" width="18" height="22" viewBox="0 0 18 22" style={{ zIndex: 30 }} aria-hidden="true">
              <path d="M2 1.5l13.5 8.2-5.7 1.4L7 20.5 2 1.5z" fill="var(--primary)" stroke="#fff" strokeWidth="1.3" strokeLinejoin="round" />
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
}

function Win({ title, focused, anim, style, children }: { title: string; focused?: boolean; anim: string; style: CSSProperties; children: ReactNode }) {
  return (
    <div
      className={`ey-ws-win ${anim} bg-card flex flex-col overflow-hidden rounded-[12px] border ${
        focused
          ? "border-primary/35 ring-primary/15 shadow-[0_30px_70px_-24px_rgba(11,16,13,0.5)] ring-2"
          : "border-line shadow-[0_16px_40px_-20px_rgba(11,16,13,0.35)]"
      }`}
      style={style}
    >
      <div className="bg-bg-soft border-line flex h-7 shrink-0 items-center gap-2 border-b pr-1 pl-2.5">
        <span className="text-foreground truncate text-[10.5px] font-semibold">{title}</span>
        <span className="flex-1" />
        <span className="text-text-faint flex items-center gap-0.5">
          <Minus size={11} />
          <Square size={9} />
          <X size={11} />
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden p-2.5">{children}</div>
    </div>
  );
}

function MiniDashboard() {
  return (
    <div>
      <div className="grid grid-cols-3 gap-1.5">
        {[["재원생", "248"], ["출석", "94.2%"], ["수납", "87.1%"]].map(([l, v], i) => (
          <div key={l} className="bg-bg-soft rounded-[8px] px-2 py-1.5">
            <p className="text-text-faint font-mono text-[7px] uppercase">{l}</p>
            <p className={`mt-0.5 text-[13px] leading-none font-extrabold ${i === 1 ? "text-primary" : "text-foreground"}`}>{v}</p>
          </div>
        ))}
      </div>
      <div className="mt-2 flex h-16 items-end gap-1">
        {[58, 70, 64, 84, 78, 92, 88].map((h, i) => (
          <span key={i} className={`flex-1 rounded-sm ${i === 5 ? "bg-primary ey-bar-live" : "bg-primary/25"}`} style={{ height: `${h}%` }} />
        ))}
      </div>
    </div>
  );
}

function MiniTimetable() {
  const blocks: Record<string, string> = { "0-0": "primary", "1-1": "rose", "2-0": "blue", "0-2": "purple", "2-2": "primary" };
  const tone: Record<string, string> = { primary: "bg-primary-soft", rose: "bg-rose-soft", blue: "bg-blue-soft", purple: "bg-purple-soft" };
  return (
    <div className="grid h-full grid-cols-3 grid-rows-3 gap-1">
      {Array.from({ length: 9 }).map((_, i) => {
        const key = `${i % 3}-${Math.floor(i / 3)}`;
        const c = blocks[key];
        return <span key={i} className={`rounded-[4px] ${c ? tone[c] : "bg-bg-soft"}`} />;
      })}
    </div>
  );
}

function MiniAttendance() {
  const cells = [1, 1, 2, 1, 1, 1, 1, 1, 1, 3, 1, 1, 1, 1, 1, 2, 1, 1];
  const color: Record<number, string> = { 1: "bg-primary/80", 2: "bg-amber", 3: "bg-danger" };
  return (
    <div className="grid grid-cols-6 gap-1">
      {cells.map((c, i) => (
        <span key={i} className={`aspect-square rounded-[2px] ${color[c]}`} />
      ))}
    </div>
  );
}
