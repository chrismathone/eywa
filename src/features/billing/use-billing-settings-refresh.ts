"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { subscribeRecordSaved } from "@/lib/realtime/record-channel";

/** 다른 창의 설정·회차 저장을 반영한다. 저장한 창은 행 응답으로 갱신해 중복 조회하지 않는다. */
export function useBillingSettingsRefresh() {
  const router = useRouter();
  useEffect(() => subscribeRecordSaved((message) => {
    if (message.scope === "tenant-settings:billing" || message.scope === "billing:session-terms") router.refresh();
  }), [router]);
}
