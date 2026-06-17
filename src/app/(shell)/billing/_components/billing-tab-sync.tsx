"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useEmbed } from "@/components/workspace/embed-context";
import { withEmbed } from "@/components/workspace/embed-context";

/**
 * 외부 책갈피(부모 프레임)가 보낸 탭 전환 메시지를 받아 client-side로 면을 바꾼다(리로드 없음).
 * 임베드(창) 상태에서만 동작 — 배경 풀페이지에선 in-page BillingTabs가 직접 링크로 전환한다.
 * embed=1을 유지(withEmbed)해야 하위가 크롬리스 분기에 머문다.
 */
export function BillingTabSync() {
  const router = useRouter();
  const embed = useEmbed();

  useEffect(() => {
    if (!embed) return;
    function onMessage(e: MessageEvent) {
      if (e.origin !== window.location.origin) return;
      const data = e.data as { type?: string; tab?: string } | null;
      if (!data || data.type !== "eywa:billing-tab") return;
      const tab = data.tab;
      const path = tab === "textbooks" || tab === "expenses" ? `/billing?tab=${tab}` : "/billing";
      router.replace(withEmbed(path));
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [embed, router]);

  return null;
}
