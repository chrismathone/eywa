"use client";

/**
 * 상담 준비 브리프 본문 접기/펼치기 — **기본은 접힌 상태**.
 *
 * 배경: 브리프가 길어 등록상담 상세를 열 때마다 아래 내용(접수 정보·AI 분석·수강 이력)을 통째로
 * 밀어냈다. 상담 직전에만 펼쳐 읽는 준비물이라 기본을 접힘으로 두고, 헤더(제목·헤드라인·생성시각·
 * 인쇄/갱신)와 생성 진행바·실패 안내는 접혀 있어도 항상 보이게 남긴다.
 *
 * 본문은 **서버에서 렌더돼 children으로 넘어온다**(PrepBriefSection은 서버 컴포넌트 유지) —
 * 여기서는 표시 여부만 관리한다. 접기/펼치기 관례는 같은 폴더의 consultation-report-editor,
 * meetings/[id]/ai-report와 동일(버튼 + aria-expanded + ChevronDown 180도 회전).
 */

import { useState } from "react";
import { ChevronDown } from "@/components/icons/eywa-icon-compat";

export function PrepBriefCollapse({
  children,
  label = "브리프",
  muted = false,
}: {
  children: React.ReactNode;
  /** 접기/펼치기 버튼에 쓸 이름 — 상담이 끝난 뒤엔 '지난 브리프'로 바뀐다(제목과 같은 말을 쓴다). */
  label?: string;
  /** 상담이 끝난 뒤(격을 내린 자리) — 브랜드 틴트 테두리를 무채색으로. 카드 배경과 함께 눈을 덜 끈다. */
  muted?: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={`bg-card/60 hover:bg-card text-foreground flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs font-semibold transition ${
          muted ? "border-line" : "border-primary/20"
        }`}
      >
        {open ? `${label} 접기` : `${label} 펼치기`}
        <ChevronDown
          className={`text-text-faint size-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open ? <div className="space-y-4">{children}</div> : null}
    </>
  );
}
