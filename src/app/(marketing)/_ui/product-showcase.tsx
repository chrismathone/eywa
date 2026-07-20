import { EyIcon } from "@/components/icons/eywa-icons";
import { CountUp } from "../_motion/count-up";
import { BrowserFrame } from "./browser-frame";

/**
 * ProductShowcase — 실제 앱(운영실)을 eywa 창 프레임에 담은 히어로 쇼케이스.
 * 제품을 크게·깊이 있게·플로팅 카드와 함께. 실제 제품의 창 크롬을 그대로 재현한다.
 */
export function ProductShowcase() {
  return (
    <div className="relative">
      <BrowserFrame title="오늘 · 운영실" url="eywa.app/dashboard">
        {/* 대시보드 본문 */}
        <div className="p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-foreground text-[15px] font-extrabold tracking-tight">김수진 원장님, 안녕하세요</p>
              <p className="text-text-dim text-[11px]">오늘 · 6월 16일 화요일</p>
            </div>
            <span className="bg-primary-soft text-primary flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[10px] font-bold">
              <span className="bg-primary size-1.5 animate-pulse rounded-full motion-reduce:animate-none" />
              실시간
            </span>
          </div>

          {/* KPI 4 */}
          <div className="mt-4 grid grid-cols-4 gap-2.5">
            <Kpi label="재원생" value={248} suffix="명" />
            <Kpi label="출석률" value={94.2} decimals={1} suffix="%" tone="primary" up />
            <Kpi label="수납률" value={87.1} decimals={1} suffix="%" />
            <Kpi label="미납" value={3} suffix="건" tone="amber" />
          </div>

          {/* 차트 + 리스트 */}
          <div className="mt-3 grid grid-cols-[1.4fr_1fr] gap-3">
            <div className="bg-bg-soft rounded-[12px] p-3.5">
              <p className="text-text-faint font-mono text-[9px] font-bold tracking-[0.1em] uppercase">최근 7일 출석</p>
              <div className="mt-3 flex h-16 items-end gap-1.5">
                {[62, 74, 70, 88, 80, 94, 91].map((h, i) => (
                  <span
                    key={i}
                    className={`flex-1 rounded-sm ${i === 5 ? "bg-primary ey-bar-live" : "bg-primary/25"}`}
                    style={{ height: `${h}%` }}
                  />
                ))}
              </div>
            </div>
            <div className="bg-bg-soft rounded-[12px] p-3.5">
              <p className="text-text-faint font-mono text-[9px] font-bold tracking-[0.1em] uppercase">오늘 일정</p>
              <ul className="mt-2.5 space-y-2">
                <Row color="primary" title="중2 수학 A반" meta="16:00 · 301호" />
                <Row color="blue" title="고1 영어 심화" meta="17:30 · 202호" />
                <Row color="rose" title="윤OO 학부모 상담" meta="19:00" />
              </ul>
            </div>
          </div>
        </div>
      </BrowserFrame>

      {/* 플로팅 — 학부모 알림 토스트 (우상단) */}
      <div className="ey-float bg-card border-line absolute -top-5 -right-4 hidden w-[244px] items-center gap-3 rounded-[14px] border p-3 shadow-[0_1px_2px_rgba(29,29,31,0.05),0_20px_44px_-18px_rgba(29,29,31,0.35)] sm:flex">
        <span className="bg-rose-soft text-rose flex size-9 shrink-0 items-center justify-center rounded-[10px]">
          <EyIcon name="messages" size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-foreground truncate text-[12px] font-bold">윤OO 어머니께 등원 알림</p>
          <p className="text-text-dim truncate text-[10px]">카카오톡 전송 완료 · 방금</p>
        </div>
      </div>

      {/* 플로팅 — 출석 체크 (좌하단) */}
      <div className="ey-float-b bg-card border-line absolute -bottom-5 -left-4 hidden items-center gap-2.5 rounded-[14px] border py-2.5 pr-4 pl-3 shadow-[0_1px_2px_rgba(29,29,31,0.05),0_20px_44px_-18px_rgba(29,29,31,0.35)] sm:flex">
        <span className="bg-primary text-primary-foreground flex size-8 shrink-0 items-center justify-center rounded-[9px]">
          <EyIcon name="check" size={16} />
        </span>
        <div>
          <p className="text-foreground text-[12px] font-bold">출석 자동 체크</p>
          <p className="text-text-dim font-mono text-[10px]">강OO · 16:02</p>
        </div>
      </div>
    </div>
  );
}

function Kpi({
  label,
  value,
  decimals,
  suffix,
  tone,
  up,
}: {
  label: string;
  value: number;
  decimals?: number;
  suffix: string;
  tone?: "primary" | "amber";
  up?: boolean;
}) {
  const color = tone === "primary" ? "text-primary" : tone === "amber" ? "text-amber" : "text-foreground";
  return (
    <div className="bg-bg-soft rounded-[12px] px-2.5 py-3">
      <div className="flex items-center gap-1">
        <p className="text-text-faint font-mono text-[8.5px] font-bold tracking-[0.08em] uppercase">{label}</p>
        {up ? <EyIcon name="arrowUp" size={9} strokeWidth={2.8} className="text-primary" /> : null}
      </div>
      <p className={`num mt-1 text-[17px] leading-none font-extrabold tracking-tight ${color}`}>
        <CountUp value={value} decimals={decimals} suffix={suffix} duration={1500} />
      </p>
    </div>
  );
}

function Row({ color, title, meta }: { color: "primary" | "blue" | "rose"; title: string; meta: string }) {
  const dot = color === "primary" ? "bg-primary" : color === "blue" ? "bg-blue" : "bg-rose";
  return (
    <li className="flex items-center gap-2">
      <span className={`size-1.5 shrink-0 rounded-full ${dot}`} />
      <span className="text-foreground flex-1 truncate text-[11px] font-semibold">{title}</span>
      <span className="text-text-faint shrink-0 font-mono text-[10px]">{meta}</span>
    </li>
  );
}
