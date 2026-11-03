"use client";

import { Component, useState, type ReactNode } from "react";
import { App } from "@/features/timetable-lab/editor/app";
import { emptyDraft } from "@/features/timetable-lab/editor/model";
import { DraftStore } from "@/features/timetable-lab/editor/store";
import type { LabAppearance } from "@/features/timetable-lab/types";
import { ApplyControls, PendingApplies } from '@/features/timetable-lab/editor/apply-controls';
import { usePrefs } from '@/components/workspace/use-prefs';
import { UI_FONT_SIZE_ZOOM } from '@/lib/ui-prefs/font-size';

/**
 * 화면을 그리다 오류가 나도 **연습본은 잃지 않게** 한다 — 연습본 저장소는 이 울타리 밖(EditorImpl)에 있어서,
 * 화면만 다시 열면 하던 편집이 그대로 돌아온다. 울타리가 없으면 오류가 페이지 전체로 번져 저장소까지 사라진다.
 */
class EditorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" className="flex h-full flex-col items-center justify-center gap-3 bg-white p-6 text-center">
        <p className="text-base font-semibold">편집기 화면을 그리다 문제가 생겼습니다.</p>
        <p className="text-muted-foreground text-sm">편집하던 연습본은 그대로 있습니다. 화면을 다시 연 뒤 ‘연습본 저장’으로 먼저 보관해 주세요.</p>
        <button
          type="button"
          className="bg-primary text-primary-foreground rounded-lg px-4 py-2 text-sm font-semibold"
          onClick={() => this.setState({ failed: false })}
        >
          편집기 다시 열기
        </button>
      </div>
    );
  }
}

/** 편집기 본체 — 이 파일은 브라우저에서만, 화면이 열릴 때 따로 내려받는다(editor-host의 next/dynamic). */
export function EditorImpl({ appearance, onDirtyChange }: { appearance: LabAppearance; onDirtyChange: (dirty: boolean) => void }) {
  // 연습본은 이 화면(창)이 떠 있는 동안만 산다. 남기려면 '연습본 저장'으로 서버에 보관한다.
  // 빈 연습본도 학원설정의 교시를 싣고 시작한다(운영시간 판정이 그 교시를 따른다).
  const [store] = useState(() => new DraftStore({ ...emptyDraft(), appearance }));
  const fontSize = usePrefs(state => state.timetableFontSize);
  return (
    <EditorBoundary>
      <App store={store} fontScale={UI_FONT_SIZE_ZOOM[fontSize]} onDirtyChange={onDirtyChange} applyControls={saved => <ApplyControls store={store} saved={saved} />} pendingApplies={load => <PendingApplies load={load} />} />
    </EditorBoundary>
  );
}
