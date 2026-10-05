"use client";

import { toast } from "sonner";
import { EmbedAnchor } from "@/components/embed-link";
import { makeupEffectNotice } from "../makeup-effect-notice";

/** A single follow-up notice also covers bulk saves without losing the recovery link. */
export function notifyMakeupEffect(value: unknown) {
  const message = makeupEffectNotice(value);
  if (!message) return;
  toast.message(message, {
    id: `onescreen-makeup-effect:${(value as { state?: string; queued?: boolean }).state === "unknown" || (value as { queued?: boolean }).queued !== true ? "unknown" : "pending"}`,
    duration: 15000,
    description: <EmbedAnchor href="/makeups/reconciliation" className="underline">대사·복구 열기</EmbedAnchor>,
  });
}
