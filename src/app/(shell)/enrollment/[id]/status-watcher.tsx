"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { ConsultationProcessingStatus } from "@/features/enrollment/server/queries";

export function ConsultationStatusWatcher({
  consultationId,
  initialStatus,
}: {
  consultationId: string;
  initialStatus: ConsultationProcessingStatus;
}) {
  const router = useRouter();

  useEffect(() => {
    if (initialStatus === "idle" || initialStatus === "completed" || initialStatus === "failed") {
      return;
    }

    const supabase = createClient();
    const channel = supabase
      .channel(`consultation:${consultationId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "enrollment_consultations",
          filter: `id=eq.${consultationId}`,
        },
        () => router.refresh(),
      )
      .subscribe();

    const poll = window.setInterval(() => router.refresh(), 5000);

    return () => {
      window.clearInterval(poll);
      supabase.removeChannel(channel);
    };
  }, [consultationId, initialStatus, router]);

  return null;
}
