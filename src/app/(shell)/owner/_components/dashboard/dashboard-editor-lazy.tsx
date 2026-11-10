"use client";

import dynamic from "next/dynamic";
import type { DashboardEditorProps } from "./dashboard-editor";

/** 편집기 자리 잡기 — 실제 줄(역할 고르기·동작 줄·캔버스)과 같은 높이(`--control-h`)로 서서 로드 끝에 화면이 튀지 않게. */
function EditorSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-busy="true" aria-label="대시보드 편집기를 여는 중">
      <div className="bg-bg-soft h-(--control-h) w-[min(640px,100%)] animate-pulse rounded-lg" />
      <div className="bg-bg-soft h-5 w-72 animate-pulse rounded-md" />
      <div className="bg-bg-soft h-(--control-h) w-48 animate-pulse rounded-lg" />
      <div className="bg-bg-soft h-[520px] animate-pulse rounded-[10px]" />
    </div>
  );
}

/**
 * 편집기 본체는 이 면을 열 때만 불러온다(B5, `next/dynamic`).
 * SSR도 하지 않는다(창 폭·포인터에 맞춰 그리는 화면이라 서버 HTML이 의미가 없다).
 */
const Impl = dynamic(() => import("./dashboard-editor").then((m) => m.DashboardEditor), { ssr: false, loading: () => <EditorSkeleton /> });

export function DashboardEditorLazy(props: DashboardEditorProps) {
  return <Impl {...props} />;
}
