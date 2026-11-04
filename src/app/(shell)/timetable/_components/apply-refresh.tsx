"use client";
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getTimetableLabApplyRevision } from '@/features/timetable-lab/server/apply-actions';

/** 연습본 적용·예약·취소 뒤 열린 시간표도 갱신한다. 입력이 있는 화면은 건드리지 않는다. */
export function TimetableApplyRefresh({ tenantId }: { tenantId: string }) {
  const router = useRouter();
  useEffect(() => {
    let stopped = false, running = false, previous: string | null | undefined;
    const inspect = async () => {
      if (running || document.hidden || (window.frameElement instanceof HTMLElement && !window.frameElement.getClientRects().length)) return;
      running = true;
      try {
        const revision = await getTimetableLabApplyRevision();
        if (stopped || revision === undefined) return;
        if (previous !== undefined && previous !== revision) router.refresh();
        previous = revision;
      } finally { running = false; }
    };
    void inspect();
    const timer = window.setInterval(() => { void inspect(); }, 30000);
    const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('eywa-timetable-applied') : null;
    if (channel) channel.onmessage = event => { if (event.data?.tenantId === tenantId) router.refresh(); };
    window.addEventListener('focus', inspect);
    return () => { stopped = true; window.clearInterval(timer); window.removeEventListener('focus', inspect); channel?.close(); };
  }, [router, tenantId]);
  return null;
}
