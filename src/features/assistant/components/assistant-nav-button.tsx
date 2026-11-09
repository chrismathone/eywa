"use client";

import { useSyncExternalStore } from "react";
import { tipProps } from "@/components/hover-tip/tip";
import { AssistantBadge } from "./assistant-badge";
import { assistantBusyServerSnapshot, assistantBusySnapshot, openAssistant, subscribeAssistantBusy } from "./assistant-hotkey";

/**
 * 학원 비서를 여는 작은 버튼 — 원장 풀셸에는 위쪽 바가 없어(2026-07-20 제거) 사이드바 아래 줄 · 폰 위쪽 줄에 둔다.
 * 오버레이·단축키는 레이아웃에 한 번 둔 `<AssistantLauncher trigger={false} />`가 갖고, 이 버튼은 열기 신호만 보낸다.
 * 보일지 말지는 서버가 정한다(원장·슈퍼관리자 · 강사뷰·지점 보기 아님 · 지점 AI 켜짐).
 * 표식 = 금색 원 + 흰 별 · 답을 만드는 질문이 있으면 도는 테두리(런처가 알려 주는 수 · `AssistantBadge`).
 */
export function AssistantNavButton({ className }: { className?: string }) {
  const busy = useSyncExternalStore(subscribeAssistantBusy, assistantBusySnapshot, assistantBusyServerSnapshot);
  return (
    <button
      type="button"
      onClick={openAssistant}
      aria-label={busy > 0 ? `학원 비서 열기 — 답을 ${busy}개 만드는 중` : "학원 비서 열기"}
      {...tipProps({ title: "학원 비서", lines: ["Ctrl+J — 어느 화면에서나 열고 닫습니다", busy > 0 ? `지금 답을 ${busy}개 만드는 중입니다.` : null] })}
      className={`hover:bg-bg-soft flex size-8 items-center justify-center rounded-md transition ${className ?? ""}`}
    >
      <AssistantBadge busy={busy > 0} size={22} />
    </button>
  );
}
