"use client";

import { useCallback, useEffect, useRef, type RefObject } from "react";
import { toast } from "sonner";
import { serializeForm } from "@/lib/realtime/form-snapshot";
import { publishRecordSaved, subscribeRecordSaved } from "@/lib/realtime/record-channel";
import { useEditPresence } from "@/features/presence/edit-presence";

/**
 * 동시 편집 가드 — 같은 레코드(scope)를 **다른 창/탭에서 저장**하면, 이 폼이 미저장 변경(dirty)을 가진
 * 경우에 한해 경고 토스트를 띄운다(작성 중 내용 분실 주의). scope 없으면 비활성(생성 폼 등 — 서로 무관).
 *
 * - dirty 판정: 마운트 시 FormData 스냅샷(baseline) ↔ 메시지 수신 시 현재 스냅샷 비교(버튼 변경까지 포착).
 * - notifySaved(): **저장 성공 확정 후** 호출 — 다른 창에 알리고 baseline을 재스냅샷(자기 dirty 해제).
 *   publish가 성공 확정 후라, 토스트의 "새로고침"이 commit된 데이터를 읽어 안전하다.
 */
export function useConcurrentEditGuard({
  scope,
  formRef,
}: {
  scope?: string;
  formRef: RefObject<HTMLFormElement | null>;
}) {
  const baseline = useRef<string | null>(null);
  const lastWarnedAt = useRef(0);

  // cross-user "수정중" presence — scope 있으면(edit 모드) 이 폼을 여는 동안 track한다(allowlist는 훅 내부).
  // 같은 브라우저 저장경고(아래 record-channel)와 크로스유저 표시가 공존. 항상 호출, enabled로 제어.
  useEditPresence(scope, !!scope);

  // 마운트(폼 렌더) 후 baseline 스냅샷 — uncontrolled defaultValue/hidden input 초기값 포함.
  useEffect(() => {
    if (!scope || !formRef.current) return;
    baseline.current = serializeForm(formRef.current);
  }, [scope, formRef]);

  // 같은 scope·다른 발신자의 저장 수신 + 현재 dirty면 경고(3초 디바운스).
  useEffect(() => {
    if (!scope) return;
    return subscribeRecordSaved((m) => {
      if (m.scope !== scope) return;
      const form = formRef.current;
      const dirty = !!form && baseline.current !== null && serializeForm(form) !== baseline.current;
      if (!dirty) return;
      const now = Date.now();
      if (now - lastWarnedAt.current < 3000) return;
      lastWarnedAt.current = now;
      toast.warning("이 내용이 다른 창에서 저장되었습니다", {
        description: "작성 중인 변경이 덮어쓰일 수 있어요. 최신 내용은 새로고침하세요.",
        action: { label: "새로고침", onClick: () => location.reload() },
      });
    });
  }, [scope, formRef]);

  const notifySaved = useCallback(() => {
    if (!scope) return;
    publishRecordSaved(scope);
    if (formRef.current) baseline.current = serializeForm(formRef.current);
  }, [scope, formRef]);

  return { notifySaved };
}
