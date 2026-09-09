"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";
/**
 * 액션 결과의 최소 모양 — 결재(`ApprovalActionState`)·연차(`LeaveActionState`)가 둘 다 이 모양을
 * 만족한다. 여기서 특정 기능의 타입을 import하면 그 기능이 필드를 늘릴 때 남의 화면까지 딸려 온다.
 */
export type ActionToastState = { ok?: true; error?: string; notice?: string } | undefined;

/**
 * 서버 액션 결과를 토스트로 흘린다(성공 시 서버가 revalidate하므로 화면은 알아서 갱신된다).
 *
 * 🔴 `onSuccess`는 **새 성공 상태에 한 번만** 부른다 — seen 가드 없이 열림 상태를 만지면 같은 성공
 *    상태가 재마운트마다 다시 닫아 "재오픈 즉시 닫힘"이 된다([[#67]]).
 *
 * 🔑 결재 창(_decide-panel)·댓글·연차 조정이 **같은 훅**을 쓴다 — 각자 복사하면 언젠가 한 곳만
 *    가드를 빠뜨린다(실제로 /me 화면에 사본이 하나 더 있다). 그래서 기능 폴더가 아니라 공용에 둔다.
 */
export function useResultToast(state: ActionToastState, onSuccess?: () => void) {
  const seen = useRef<ActionToastState>(undefined);
  const onSuccessRef = useRef(onSuccess);
  useEffect(() => {
    onSuccessRef.current = onSuccess; // 인라인 함수를 받아도 아래 effect가 재실행되지 않게 ref로
  });
  useEffect(() => {
    if (!state || state === seen.current) return;
    seen.current = state;
    if (state.error) toast.error(state.error);
    else if (state.ok) {
      toast.success(state.notice ?? "처리했습니다");
      onSuccessRef.current?.();
    }
  }, [state]);
}
