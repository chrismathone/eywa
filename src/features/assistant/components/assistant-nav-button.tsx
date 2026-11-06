"use client";

import { tipProps } from "@/components/hover-tip/tip";
import { EyIcon } from "@/components/icons/aywa-icons";
import { openAssistant } from "./assistant-hotkey";

/**
 * 학원 비서를 여는 작은 버튼 — 원장 풀셸에는 위쪽 바가 없어(2026-07-20 제거) 사이드바 아래 줄 · 폰 위쪽 줄에 둔다.
 * 오버레이·단축키는 레이아웃에 한 번 둔 `<AssistantLauncher trigger={false} />`가 갖고, 이 버튼은 열기 신호만 보낸다.
 * 보일지 말지는 서버가 정한다(원장·슈퍼관리자 · 강사뷰·지점 보기 아님 · 지점 AI 켜짐).
 */
export function AssistantNavButton({ className }: { className?: string }) {
  return (
    <button
      type="button"
      onClick={openAssistant}
      aria-label="학원 비서 열기"
      {...tipProps({ title: "학원 비서", lines: ["Ctrl+J — 어느 화면에서나 열고 닫습니다"] })}
      className={`text-text-dim hover:text-foreground hover:bg-bg-soft flex size-7 items-center justify-center rounded-md transition ${className ?? ""}`}
    >
      <EyIcon name="sparkle" size={16} strokeWidth={1.8} className="text-gold" />
    </button>
  );
}
