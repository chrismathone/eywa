import type { ReactNode } from "react";
import { PageMaximizeButton } from "./page-maximize-button";

/** 제목 행을 접는 화면의 첫 조작 행. 최대화 중에도 탭·필터와 복원 버튼이 같은 행에 남는다. */
export function PageMaximizeToolbar({ children }: { children: ReactNode }) {
  return (
    <div data-maximize-toolbar="" className="flex min-w-0 shrink-0 items-start gap-2">
      <div className="min-w-0 flex-1">{children}</div>
      <div data-maximize-toolbar-toggle="" className="hidden shrink-0 items-center pt-1">
        <PageMaximizeButton />
      </div>
    </div>
  );
}
