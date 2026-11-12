"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { MENU_LABEL, type MenuKey } from "@/lib/permissions";
import type { LinkedGrant } from "@/features/owner/permission-links";
import { pickJosa } from "@/lib/text/josa";
import { ACCESS_LABEL } from "./permission-ui";

/** 연동된 권한을 함께 열지 묻는 중 — 누른 칸과 함께 열 권한들 · 승인 때 할 일 · 닫은 뒤 초점을 돌려줄 칸. */
export type PendingLinkedGrant = {
  menu: MenuKey;
  /** 누구의 칸인가 — 역할 이름(역할 표) 또는 사람 이름(개인별 권한). */
  who: string;
  grants: LinkedGrant[];
  onConfirm: () => void;
};

/**
 * 묻는 중인 칸 — 서버 값으로 표를 갈아끼우면(`adoptions`) 지난 표의 질문이라 버린다(적대 리뷰: 그사이 '전체'가 된 칸을 '읽기'로 좁혔다).
 * 닫은 직후 잠깐은 칸 누름을 받지 않는다(창 단추를 두 번 누르면 두 번째가 창 뒤 칸을 바꿨다).
 */
export function useLinkedGrantPrompt(adoptions: number) {
  const [state, setState] = useState<{ pending: PendingLinkedGrant; adoptions: number } | null>(null);
  const closedAt = useRef(0);
  const pending = state && state.adoptions === adoptions ? state.pending : null;
  // 닫기는 렌더마다 새로 만들지 않는다 — 창의 effect가 다시 돌며 초점을 '함께 허용'으로 끌어오지 않게(재리뷰).
  const close = useCallback(() => {
    closedAt.current = Date.now();
    setState(null);
  }, []);
  return {
    pending,
    /** 지금 칸 누름을 받지 말아야 하나(묻는 중 · 막 닫음). 이벤트 처리 안에서만 부른다. */
    busy: () => pending !== null || Date.now() - closedAt.current < 400,
    ask: (p: PendingLinkedGrant) => setState({ pending: p, adoptions }),
    close,
  };
}

/**
 * '해당 권한도 함께 허용할까요?'(원장 2026-11-12). 승인 = 둘 다 연다 · 취소·바깥 누름·Esc = **아무것도 바꾸지 않는다**.
 * 열리면 초점을 '함께 허용'으로 옮기고, 닫히면 누른 칸으로 돌려준다(키보드로 창 뒤 칸을 바꾸지 않게).
 */
export function LinkedGrantDialog({ pending, onClose }: { pending: PendingLinkedGrant | null; onClose: () => void }) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);
  const open = pending !== null;
  // 열릴 때 한 번만 — 그때 초점이 있던 요소(누른 칸 · 고르기 칸 · 추가 단추)를 기억해 닫힐 때 돌려준다(역할 표·개인별 권한 공통).
  useEffect(() => {
    if (!open) return;
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    confirmRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeRef.current();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      before?.focus();
    };
  }, [open]);
  if (!pending || typeof document === "undefined") return null;

  const child = MENU_LABEL[pending.menu];
  const names = pending.grants.map((g) => `‘${MENU_LABEL[g.menu]}’`).join("·");
  const now = pending.grants.map((g) => `‘${MENU_LABEL[g.menu]}’ ‘${ACCESS_LABEL[g.from]}’`).join("·");
  const last = pending.grants[pending.grants.length - 1]!;
  const grantText = pending.grants.map((g) => `‘${MENU_LABEL[g.menu]}’ ‘${ACCESS_LABEL[g.access]}’`).join("·");
  const message =
    `‘${child}’${pickJosa(child, "은")} ${names} 권한이 함께 있어야 열립니다. ${pending.who}의 지금 값은 ${now}입니다. ` +
    `${grantText}${pickJosa(ACCESS_LABEL[last.access], "을")} 함께 허용할까요?`;

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 p-4 whitespace-normal sm:items-center" onClick={onClose} role="presentation">
      <div
        className="bg-background border-line w-full max-w-sm rounded-lg border p-5 shadow-lg"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="linked-grant-title"
        aria-describedby="linked-grant-message"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="linked-grant-title" className="text-foreground mb-1.5 text-sm font-bold">연동된 권한</h2>
        <p id="linked-grant-message" className="text-text-dim text-sm leading-relaxed">{message}</p>
        <div className="mt-5 flex items-center justify-end gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            취소(바꾸지 않음)
          </Button>
          <Button
            ref={confirmRef}
            type="button"
            size="sm"
            onClick={() => {
              pending.onConfirm();
              onClose();
            }}
          >
            함께 허용
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
