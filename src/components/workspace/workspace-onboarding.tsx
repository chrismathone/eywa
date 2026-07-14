"use client";

import { useSyncExternalStore } from "react";
import { AppWindow, Columns2, Layers, X } from "@/components/icons/eywa-icon-compat";
import { EyIcon } from "@/components/icons/eywa-icons";
import { usePrefs } from "./use-prefs";

// 하이드레이션 게이트 — SSR=false/클라=true (persist 비동기 하이드레이션 미스매치·setState-in-effect 회피, #25 패턴)
const subscribeNoop = () => () => {};
const useHydrated = () => useSyncExternalStore(subscribeNoop, () => true, () => false);

/**
 * 멀티윈도우 워크스페이스 첫 진입 코치마크(1회용, 데스크톱 전용 — WorkspaceCanvas가 데스크톱에서만 마운트).
 * eywa의 결정적 차별점(메뉴=창, 나란히 보기, 동시 작업)을 첫 화면에 각인. 닫으면 prefs.onboarded 영속.
 * 첫 노출 시 사이드바를 펼쳐 메뉴 라벨을 보여줘 발견성도 함께 올린다.
 */
const POINTS: { icon: typeof AppWindow; title: string; desc: string }[] = [
  { icon: AppWindow, title: "메뉴를 클릭하면 창으로 열립니다", desc: "필요한 화면만 창으로 띄워 자유롭게 배치하세요." },
  { icon: Columns2, title: "창을 화면 가장자리로 끌면 나란히 보기", desc: "수납을 보며 학생 정보를 동시에 확인하세요." },
  { icon: Layers, title: "여러 창을 띄워두고 전환", desc: "최소화해도 작업 상태가 그대로 보존됩니다." },
];

export function WorkspaceOnboarding() {
  const onboarded = usePrefs((s) => s.onboarded);
  const setOnboarded = usePrefs((s) => s.setOnboarded);
  const setSidebar = usePrefs((s) => s.setSidebar);
  // persist 하이드레이션 전 SSR=false 미스매치 방지 — 하이드레이션 후에만 렌더.
  const hydrated = useHydrated();

  if (!hydrated || onboarded) return null;

  // 닫을 때 사이드바를 펼쳐 메뉴 라벨을 노출(발견성↑) — 이벤트 핸들러라 effect-setState 규칙 회피.
  const dismiss = () => {
    setSidebar(true);
    setOnboarded(true);
  };

  return (
    <div
      className="bg-ink/30 animate-in fade-in-0 fixed inset-0 z-[60] flex items-center justify-center p-4 backdrop-blur-sm duration-200"
      role="dialog"
      aria-modal="true"
      aria-label="워크스페이스 안내"
      onClick={dismiss}
    >
      <div
        className="bg-card border-line shadow-modal animate-in zoom-in-95 w-full max-w-md rounded-xl border p-6 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="mb-4 flex items-center justify-between">
          <span className="bg-gold-soft text-gold inline-flex items-center gap-1.5 rounded-sm px-2 py-1">
            <EyIcon name="sparkle" size={13} />
            <span className="micro">워크스페이스</span>
          </span>
          <button
            type="button"
            aria-label="닫기"
            onClick={dismiss}
            className="text-text-dim hover:bg-line-strong/30 hover:text-foreground flex size-7 items-center justify-center rounded-[3px] transition"
          >
            <X size={16} strokeWidth={2} />
          </button>
        </header>

        <h2 className="text-foreground text-[19px] font-extrabold tracking-tight">
          여러 화면을 한 번에
        </h2>
        <p className="text-text-dim mt-1.5 text-sm">
          eywa는 메뉴가 <span className="text-foreground font-semibold">창</span>으로 열려, 동시에 보고 일할 수 있어요.
        </p>

        <ul className="mt-5 space-y-3.5">
          {POINTS.map(({ icon: Icon, title, desc }) => (
            <li key={title} className="flex items-start gap-3">
              <span className="bg-primary-soft text-primary mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-sm">
                <Icon size={17} strokeWidth={2} />
              </span>
              <div className="min-w-0">
                <p className="text-foreground text-[13px] font-semibold">{title}</p>
                <p className="text-text-dim mt-0.5 text-xs">{desc}</p>
              </div>
            </li>
          ))}
        </ul>

        <button
          type="button"
          onClick={dismiss}
          className="bg-primary shadow-primary-glow hover:bg-primary/90 mt-6 w-full rounded-md py-2.5 text-sm font-semibold text-white transition"
        >
          시작하기
        </button>
      </div>
    </div>
  );
}
