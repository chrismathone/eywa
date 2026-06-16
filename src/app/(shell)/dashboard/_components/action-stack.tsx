/**
 * ③ 처리 필요 — 미수·결석위험·AI상담대기·신규 카운트 + 바로가기(count>0만).
 * 상세 리스트는 각 feature 페이지(글랜스+액션 철학). 전부 0이면 긍정 빈 상태.
 */
import { WindowLink } from "@/components/workspace/window-link";
import { EyIcon } from "@/components/icons/eywa-icons";
import type { ActionItem } from "@/features/dashboard/metrics";

const TONE: Record<string, { text: string; border: string; bg: string }> = {
  danger: { text: "text-danger", border: "border-danger/25", bg: "bg-danger-soft" },
  amber: { text: "text-amber", border: "border-amber/25", bg: "bg-amber-soft" },
  gold: { text: "text-gold", border: "border-gold/30", bg: "bg-gold-soft" },
  blue: { text: "text-blue", border: "border-blue/25", bg: "bg-blue-soft" },
};

const SUB: Record<string, string> = {
  unpaid: "수납 관리에서 확인",
  absence: "출결 확인 필요",
  ai: "등록상담 진단 준비됨",
  new: "이번 달 신규 유입",
};

export function ActionStack({ items }: { items: ActionItem[] }) {
  return (
    <section className="bg-card border-line shadow-card flex h-full flex-col overflow-hidden rounded-2xl border px-5 pt-4 pb-5">
      <h2 className="text-foreground mb-3 text-[15px] font-bold">처리 필요</h2>

      {items.length === 0 ? (
        <div className="text-text-dim flex flex-1 flex-col items-center justify-center gap-2 py-10 text-center">
          <span className="bg-primary-soft text-primary flex size-9 items-center justify-center rounded-full">
            <EyIcon name="check" size={18} />
          </span>
          <p className="text-[13px] font-medium">모두 정리됐어요</p>
          <p className="text-text-faint text-[11px]">지금 처리할 항목이 없습니다</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {items.map((item) => {
            const tone = TONE[item.color] ?? TONE.blue;
            return (
              <WindowLink
                key={item.key}
                href={item.href}
                className={`flex items-center gap-3 rounded-lg border ${tone.border} ${tone.bg} px-3 py-2.5 transition hover:brightness-[0.97]`}
              >
                <span
                  className={`num text-[24px] font-extrabold leading-none tracking-tight ${tone.text}`}
                  style={{ minWidth: "28px" }}
                >
                  {item.count}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-foreground text-[13px] font-bold">{item.label}</p>
                  <p className="text-text-dim text-[11px]">{SUB[item.key] ?? "바로가기"}</p>
                </div>
                <EyIcon name="arrowRight" size={14} className={tone.text} />
              </WindowLink>
            );
          })}
        </div>
      )}
    </section>
  );
}
