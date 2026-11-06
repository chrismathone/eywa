"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { tipProps } from "@/components/hover-tip/tip";
import { EyIcon } from "@/components/icons/aywa-icons";
import { Button } from "@/components/ui/button";
import { DEFAULT_ASSISTANT_LEVEL, type AssistantLevel } from "@/features/assistant/levels";
import { isHelpHotkey } from "@/features/help/overlay-hotkey";
import { kstToday } from "@/lib/date-kst";
import { isPaletteHotkey } from "@/lib/palette-hotkey";
import { ASSISTANT_OPEN_EVENT, ASSISTANT_TOGGLE_MESSAGE, assistantHotkeyLabel, isAssistantHotkey } from "./assistant-hotkey";
import { useAssistant } from "./use-assistant";

/** 판은 처음 열 때 싣는다 — 런처는 원장 화면마다 레이아웃에 붙어 있어, 판 코드(보고서·표·차트 틀)를 페이지마다 실을 이유가 없다. */
const AssistantOverlay = dynamic(() => import("./assistant-overlay").then((m) => m.AssistantOverlay), { ssr: false });

const noopSubscribe = () => () => {};
/** 단축키 글자 — 서버 렌더는 `Ctrl+J`, 맥이면 하이드레이션 뒤 `⌘J`. */
function useHotkeyLabel(): string {
  return useSyncExternalStore(
    noopSubscribe,
    () => assistantHotkeyLabel(typeof navigator === "undefined" ? undefined : navigator.platform),
    () => assistantHotkeyLabel(undefined),
  );
}

/**
 * **학원 비서 런처** — 위쪽 바의 '✦ 비서' 버튼 + 어디서나 여는 오버레이(원장 2026-11-06 *"어디서나 오버레이로 열 수 있게 다른 화면 위에"*).
 *
 * - 셸 레이아웃에 **한 번만** 둔다(두 벌이면 단축키가 두 번 토글돼 열리자마자 닫힌다). 레이아웃은 화면을 옮겨도 남으므로
 *   열림·지금 대화·받던 답·입력 중인 글·추론 강도가 이 컴포넌트에 살아 있다.
 * - 처음 열 때 지난 대화(`GET /api/assistant/threads`)를 읽고, 그 뒤로는 열 때마다 조용히 새로 고친다.
 * - 단축키 Ctrl/⌘+J(열기·닫기) — 창(iframe) 안에서는 `AssistantHotkeyForward`가 넘겨 준다. 다른 곳의 버튼은
 *   `window.dispatchEvent(new Event(ASSISTANT_OPEN_EVENT))`로 연다(사이드바·모바일 메뉴 등 — 런처는 하나로 둔 채).
 * - 판이 열린 채 검색 팰릿(Ctrl/⌘+K)을 부르면 판을 닫고 팰릿에 자리를 준다(팰릿은 z-50이라 판 뒤에 깔린다). F1(화면 도움말)은
 *   판이 열린 동안 막는다 — 바탕 화면의 버튼 설명이 판 위에 겹친다.
 *
 * @param trigger 버튼을 그릴지(기본 true). false면 오버레이·단축키·열기 신호만.
 * @param className 버튼에 덧붙일 클래스(자리 맞춤용 — 크기·라운드는 공용 Button 그대로 둘 것).
 */
export function AssistantLauncher({ trigger = true, className }: { trigger?: boolean; className?: string } = {}) {
  const [open, setOpen] = useState(false);
  const [everOpened, setEverOpened] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [listOpen, setListOpen] = useState(true);
  const [level, setLevel] = useState<AssistantLevel>(DEFAULT_ASSISTANT_LEVEL);
  const [draft, setDraft] = useState("");
  const [today, setToday] = useState("");
  const assistant = useAssistant({ open });
  const { loadThreads } = assistant;
  const hotkeyLabel = useHotkeyLabel();
  const triggerRef = useRef<HTMLButtonElement>(null);
  /** 다음 닫힘에서 초점을 돌려주지 않는다(검색 팰릿으로 넘어갈 때 — 팰릿 입력의 초점을 빼앗지 않게). */
  const skipFocusRef = useRef(false);

  const openedRef = useRef(false);

  const openOverlay = useCallback(() => {
    setToday(kstToday());
    if (!openedRef.current) {
      // 처음 열 때만 판을 붙이고 목록 펼침을 화면 폭으로 정한다(넓으면 펼침 · 좁으면 접힘). 그 뒤는 사람이 정한 대로.
      openedRef.current = true;
      setEverOpened(true);
      setListOpen(window.matchMedia("(min-width: 1024px)").matches);
    }
    setOpen(true);
    void loadThreads();
  }, [loadThreads]);

  const toggle = useCallback(() => {
    if (open) setOpen(false);
    else openOverlay();
  }, [open, openOverlay]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isAssistantHotkey(e)) {
        e.preventDefault();
        if (!e.repeat) toggle();
        return;
      }
      if (!open) return;
      if (isPaletteHotkey(e)) {
        skipFocusRef.current = true;
        setOpen(false);
        return; // 팰릿이 같은 키를 받아 열린다.
      }
      if (isHelpHotkey(e)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      if ((e.data as { type?: unknown } | null)?.type === ASSISTANT_TOGGLE_MESSAGE) toggle();
    };
    // 캡처 단계 — 판 안의 입력·다른 화면 단축키보다 먼저 본다.
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("message", onMessage);
    window.addEventListener(ASSISTANT_OPEN_EVENT, openOverlay);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("message", onMessage);
      window.removeEventListener(ASSISTANT_OPEN_EVENT, openOverlay);
    };
  }, [open, toggle, openOverlay]);

  const finalFocus = useCallback(() => {
    if (skipFocusRef.current) {
      skipFocusRef.current = false;
      return false;
    }
    return triggerRef.current ?? true;
  }, []);

  const streaming = !!assistant.state.inflight;

  return (
    <>
      {trigger ? (
        <Button
          ref={triggerRef}
          type="button"
          variant="ghost"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-keyshortcuts="Control+J Meta+J"
          data-usage-chrome=""
          onClick={toggle}
          {...tipProps({ title: "학원 비서", lines: [`${hotkeyLabel} — 어느 화면에서나 열고 닫습니다`, streaming ? "지금 답을 만드는 중입니다." : null] })}
          className={className}
        >
          <EyIcon name="sparkle" className="text-gold" />
          비서
          {streaming ? (
            <span className="bg-gold size-1.5 animate-pulse rounded-full motion-reduce:animate-none" role="img" aria-label="답을 만드는 중" />
          ) : null}
        </Button>
      ) : null}
      {everOpened ? (
        <AssistantOverlay
          open={open}
          onOpenChange={setOpen}
          keepMounted
          finalFocus={finalFocus}
          assistant={assistant}
          level={level}
          onLevelChange={setLevel}
          draft={draft}
          onDraftChange={setDraft}
          expanded={expanded}
          onExpandedChange={setExpanded}
          listOpen={listOpen}
          onListOpenChange={setListOpen}
          today={today}
          hotkeyLabel={hotkeyLabel}
        />
      ) : null}
    </>
  );
}
