"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { MeetingProcessingStatus } from "@/features/meetings/server/queries";

/**
 * Subscribes to Realtime row updates for one meeting. When the row changes,
 * the page is re-fetched (router.refresh). This keeps the SSR-rendered page
 * fresh during async transcription + analysis without polling.
 */
export function MeetingStatusWatcher({
  meetingId,
  initialStatus,
}: {
  meetingId: string;
  initialStatus: MeetingProcessingStatus;
}) {
  const router = useRouter();

  useEffect(() => {
    if (initialStatus === "idle" || initialStatus === "completed" || initialStatus === "failed") {
      // Nothing to watch — terminal state.
      return;
    }

    const supabase = createClient();
    const channel = supabase
      .channel(`meeting:${meetingId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "meeting_minutes",
          filter: `id=eq.${meetingId}`,
        },
        () => {
          router.refresh();
        },
      )
      .subscribe();

    // Polling fallback in case Realtime isn't enabled on the project.
    const poll = window.setInterval(() => router.refresh(), 5000);

    return () => {
      window.clearInterval(poll);
      supabase.removeChannel(channel);
    };
  }, [meetingId, initialStatus, router]);

  return null;
}
