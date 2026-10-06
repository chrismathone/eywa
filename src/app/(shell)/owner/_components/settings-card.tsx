import type { ReactNode } from "react";
import { EyIcon } from "@/components/icons/aywa-icons";

/**
 * 설정 면의 카드 한 장 — 제목 · 설명 · 내용. 저장 폼([section-form.tsx](./section-form.tsx))과 따로 둔다:
 * 카드는 그림만 그리는 부품이라 저장 액션을 끌어오지 않아야, 카드를 쓰는 구획을 폼 없이도 세우고 확인할 수 있다.
 */
export function SettingsCard({
  title,
  description,
  children,
  span2,
  collapsible,
  summary,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  // 내용이 큰 카드(약관·셔틀 등)는 2열 그리드에서 한 줄 전체를 차지해 빈 열·ragged를 방지.
  span2?: boolean;
  /**
   * 접어 두는 카드 — 줄이 계속 늘어 화면을 밀어내는 목록(강의실 · 공휴일). 처음엔 접혀 있고 제목 줄을 누르면 펼친다
   * (원장 2026-10-06 *"강의실과 공휴일은 접기 넣어줘 스크롤 너무 길어짐"*).
   * 접혀 있어도 안의 입력은 그대로 살아 있다 — 고치다 접어도 값이 남고 저장에 실린다.
   */
  collapsible?: boolean;
  /** 접는 카드의 제목 줄 오른쪽에 적는 한마디(예: `12개`) — 펼치지 않아도 얼마나 들었는지 보인다. */
  summary?: string;
}) {
  const shell = `bg-card shadow-card rounded-2xl p-5 ${span2 ? "xl:col-span-2" : ""}`;
  if (collapsible) {
    return (
      <section data-span-all={span2 ? "" : undefined} className={shell}>
        <details className="group">
          {/* 제목 줄의 자식은 제목 · 오른쪽 한마디 · 설명 셋뿐이다(격자로 놓는다 — 제목을 다른 상자에 넣지 않는다).
              설명은 두 칸을 다 쓴다(오른쪽 한마디 아래를 비워 두면 좁은 창에서 설명이 좁은 기둥으로 접힌다). */}
          <summary className="grid cursor-pointer list-none grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 [&::-webkit-details-marker]:hidden">
            <h3 className="text-foreground text-sm font-bold">{title}</h3>
            <span className="text-text-dim flex items-center gap-1.5 text-xs">
              {summary ? <span className="num">{summary}</span> : null}
              <span className="group-open:hidden">펼치기</span>
              <span className="hidden group-open:inline">접기</span>
              <EyIcon name="chevronDown" size={16} className="transition group-open:rotate-180" />
            </span>
            {description ? <span className="text-text-dim col-span-2 mt-1 block text-xs">{description}</span> : null}
          </summary>
          <div className="mt-4">{children}</div>
        </details>
      </section>
    );
  }
  return (
    <section data-span-all={span2 ? "" : undefined} className={shell}>
      <h3 className="text-foreground text-sm font-bold">{title}</h3>
      {description ? <p className="text-text-dim mt-1 text-xs">{description}</p> : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}
