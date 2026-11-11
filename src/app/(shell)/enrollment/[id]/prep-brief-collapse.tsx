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
 *
 * ── `pinned`(수정 화면 · 원장 2026-11-11) ────────────────────────────────────────
 * 펼치면 이 덩어리(펼치기 줄 + 본문 판)가 **스크롤 영역 맨 위에 붙는다**(sticky) — 본문 판은 화면 높이의
 * 40%까지만 쓰고 그 안에서 따로 스크롤되므로, 아래 폼을 내려가며 입력해도 브리프가 계속 보이고 '접기'가
 * 늘 손 닿는 곳에 있다. 접으면 제자리(이름 아래)의 줄 하나로 돌아간다. 펼친 동안은 스크롤 영역의 `scroll-padding-top`을
 * 판 높이로 잡아 초점 이동이 판 밑으로 숨지 않게 한다(아래 효과).
 * ⚠️ sticky가 폼 끝까지 따라가려면 이 덩어리가 **폼과 같은 부모의 직계 자식**이어야 한다(부모 상자 안에서만
 *    붙는다) — 수정 페이지가 머리글 밖·폼 앞에 둔다. 폼(`<form>`) 안에 넣지 말 것: 이름 없는 단추라 초안 자동저장·
 *    미저장 가드에는 안 잡히지만, '다시 작성'이 제 `<form>`이라 폼 안 폼이 된다.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown } from "@/components/icons/aywa-icon-compat";

export function PrepBriefCollapse({
  children,
  label = "브리프",
  muted = false,
  pinned,
}: {
  children: ReactNode;
  /** 접기/펼치기 버튼에 쓸 이름 — 상담이 끝난 뒤엔 '지난 브리프'로 바뀐다(제목과 같은 말을 쓴다). */
  label?: string;
  /** 상담이 끝난 뒤(격을 내린 자리) — 브랜드 틴트 테두리를 무채색으로. 카드 배경과 함께 눈을 덜 끈다. */
  muted?: boolean;
  /**
   * 수정 화면의 붙는 판(위 머리 주석). `tone` = 본문 판 테두리·배경(상세 카드와 같은 값) ·
   * `notice` = 접혀 있어도 줄 바로 아래 보일 진행바·실패 안내.
   */
  pinned?: { tone: string; notice: ReactNode };
}) {
  const [open, setOpen] = useState(false);
  const isPinned = !!pinned;
  const pinRef = useRef<HTMLDivElement>(null);

  // 붙은 판 밑으로 **초점이 숨지 않게** — Shift+Tab으로 위 칸에 가면 브라우저가 그 칸을 스크롤 영역 맨 위로 올리는데,
  // 거기가 바로 이 판 밑이었다(실측: 위로 가는 칸 10개 전부 가려짐). 펼친 동안만 스크롤 영역의 `scroll-padding-top`을
  // 판 높이만큼 잡아 두면 초점 이동·scrollIntoView가 판 아래에서 멈춘다. 접거나 떠나면 원래 값으로 돌린다.
  useEffect(() => {
    const pin = pinRef.current;
    const scroller = pin?.closest("main");
    if (!isPinned || !open || !pin || !scroller) return;
    const before = scroller.style.scrollPaddingTop;
    const apply = () => {
      const padTop = Number.parseFloat(getComputedStyle(scroller).paddingTop) || 0;
      scroller.style.scrollPaddingTop = `${Math.ceil(padTop + pin.offsetHeight + 8)}px`;
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(pin);
    return () => {
      ro.disconnect();
      scroller.style.scrollPaddingTop = before;
    };
  }, [isPinned, open]);

  const toggle = (
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
  );

  if (!pinned) {
    return (
      <>
        {toggle}
        {open ? <div className="space-y-4">{children}</div> : null}
      </>
    );
  }

  // 바탕을 불투명하게 칠해야 붙은 판 밑으로 지나가는 폼 글자가 비치지 않는다(저장 바와 같은 바탕색).
  // sticky `top-0`은 스크롤 영역(셸 <main>)의 **윗 패딩 안쪽**에 붙어서, 그 패딩(최대 pt-5 = 20px) 틈으로 폼 글자가
  // 지나간다 → 위로 같은 높이의 띠(`before:`)를 칠해 막는다. 위쪽 넘침이라 스크롤 길이는 안 늘어난다(아래 저장 바의
  // `after:` 함정과 다르다 — form-action-bar.tsx). 띠는 펼쳤을 때만, 접힌 줄 위(머리글과의 간격)는 건드리지 않는다.
  // 위아래 여백은 접혔을 때도 같은 값 — 펼치는 순간 줄이 몇 px 밀리지 않게.
  return (
    <div
      ref={pinRef}
      className={`space-y-2 py-1 ${
        open
          ? "bg-bg-canvas before:bg-bg-canvas sticky top-0 z-10 before:absolute before:inset-x-0 before:bottom-full before:h-5"
          : ""
      }`}
    >
      {toggle}
      {pinned.notice}
      {open ? (
        <div
          className={`max-h-[40vh] space-y-4 overflow-y-auto overscroll-contain rounded-2xl border p-4 ${pinned.tone}`}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}
