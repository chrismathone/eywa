"use client";

import { useCallback, useEffect, useRef, type RefObject } from "react";
import { serializeForm } from "@/lib/realtime/form-snapshot";
import { windowDirtyMessage } from "./window-bridge";

/**
 * 미저장 변경 가드 — 이 폼에 작성 중(dirty) 변경이 있으면, 폼이 든 플로팅 창의 닫기(X)·Esc가
 * "정말 닫을까요?" 확인을 거치게 한다.
 *
 * 전달 방식 = **iframe→부모 postMessage**(record-channel/EmbedFocusSignal와 동일 브리지). winId를
 * 경로로 추측하지 않고, 부모(workspace-canvas)가 `event.source`(=이 iframe의 contentWindow)를
 * iframeRegistry와 대조해 정확한 창을 찾는다 → **드릴인(상세→수정 같은 창)·새 창 모두 정확**.
 * 창(iframe)이 아니면(전체화면·미니셸) window.parent===window라 postMessage를 보내지 않는다(무해).
 *
 * - dirty 판정: 마운트 baseline(serializeForm) ↔ 입력 이벤트마다 현재 스냅샷. 전이 시에만 전송.
 * - iframe 자체 이탈(새로고침 등)도 beforeunload로 막는다.
 * - 저장 성공 후 markSaved()로 baseline 재스냅샷 + dirty 해제(닫아도 확인 안 뜨게).
 *
 * 생성/수정 모두 사용(scope 불필요) — 작성 중 새 내용도 보호. enabled=false면 완전 비활성.
 */
export function useUnsavedGuard({
  formRef,
  enabled = true,
}: {
  formRef: RefObject<HTMLFormElement | null>;
  enabled?: boolean;
}): { markSaved: () => void } {
  const baseline = useRef<string | null>(null);
  const dirtyRef = useRef(false);

  const send = useCallback((dirty: boolean) => {
    if (typeof window === "undefined" || window.parent === window) return; // 창(iframe) 안에서만
    try {
      window.parent.postMessage(windowDirtyMessage(dirty), window.location.origin);
    } catch {
      /* cross-origin 등 — 무시 */
    }
  }, []);

  useEffect(() => {
    const form = formRef.current;
    if (!enabled || !form) return;
    baseline.current = serializeForm(form);
    dirtyRef.current = false;

    const publish = (dirty: boolean) => {
      if (dirty === dirtyRef.current) return; // 전이 시에만
      dirtyRef.current = dirty;
      send(dirty);
    };
    const recompute = () =>
      publish(baseline.current !== null && serializeForm(form) !== baseline.current);

    // ⚠️ 컨트롤드 입력(값을 hidden input에 미러하는 폼 — 학원설정 section-form·등록상담 과목점수)은 React 커밋이
    // 네이티브 input 리스너보다 **늦다**. 리스너에서 즉시 serializeForm하면 stale 값을 읽어 dirty를 놓친다.
    // → 다음 매크로태스크(setTimeout 0)로 미뤄 React 커밋 후 비교(uncontrolled 폼도 무해, ~0ms 지연은 무영향).
    let scheduled: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      if (scheduled !== null) return;
      scheduled = setTimeout(() => {
        scheduled = null;
        recompute();
      }, 0);
    };

    form.addEventListener("input", schedule);
    form.addEventListener("change", schedule);

    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);

    return () => {
      if (scheduled !== null) clearTimeout(scheduled);
      form.removeEventListener("input", schedule);
      form.removeEventListener("change", schedule);
      window.removeEventListener("beforeunload", onBeforeUnload);
      // 언마운트(창 닫힘/드릴백/네비) 시 확실히 해제 — 부모가 stale dirty로 다음을 잘못 잠그는 것 방지.
      if (dirtyRef.current) send(false);
    };
  }, [enabled, formRef, send]);

  const markSaved = useCallback(() => {
    const form = formRef.current;
    if (form) baseline.current = serializeForm(form);
    if (dirtyRef.current) {
      dirtyRef.current = false;
      send(false);
    }
  }, [formRef, send]);

  return { markSaved };
}
