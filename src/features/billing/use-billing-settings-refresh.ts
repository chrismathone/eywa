"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { subscribeRecordSaved } from "@/lib/realtime/record-channel";

/**
 * 다른 창의 설정·회차 저장을 반영한다. 저장한 창은 행 응답으로 갱신해 중복 조회하지 않는다.
 * `tenant-settings:operations` = 휴일 — 회차 확정의 예정 시수·수강료 계산기가 휴일을 뺀다(2026-09-17).
 * 수강·시간표 변경은 그 화면들이 `notifyTermPlansChanged()`로 `billing:session-terms`를 쏜다.
 */
export function useBillingSettingsRefresh() {
  const router = useRouter();
  useEffect(() => subscribeRecordSaved((message) => {
    if (message.scope === "tenant-settings:billing" || message.scope === "tenant-settings:operations" || message.scope === "billing:session-terms") router.refresh();
  }), [router]);
}
