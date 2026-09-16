"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { subscribeRecordSaved } from "@/lib/realtime/record-channel";

/** 설정 창에서 저장하면 열려 있는 수납 창도 새 후보 목록을 읽는다. 입력 중인 폼 상태는 유지된다. */
export function useBillingSettingsRefresh() {
  const router = useRouter();
  useEffect(() => subscribeRecordSaved((message) => {
    if (message.scope === "tenant-settings:billing") router.refresh();
  }), [router]);
}
