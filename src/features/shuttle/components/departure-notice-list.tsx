"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { TONE_SOFT, type SemanticTone } from "@/lib/design/semantic-color";
import { noticeAckId, parentNoticeText, type ParentNotice } from "../departure-notices";
import { ackParentNotice } from "../server/parent-departure-actions";

const NOTICE_TONE = { depart: "info", board: "positive", missed: "critical", dropoff: "positive" } as const satisfies Record<ParentNotice["kind"], SemanticTone>;

const NOTICE_ICON: Record<ParentNotice["kind"], string> = { depart: "🚌", board: "🧒", missed: "⚠️", dropoff: "🏠" };

/** 푸시 대신 이 간격으로 다시 읽는다 — 셔틀 선생님이 [출발]·[전송]을 누르면 이 안에 줄이 생긴다. */
const POLL_MS = 15_000;

/**
 * 학부모 화면 위쪽 **셔틀 알림** 줄(0354a·0354b, 진짜 앱 푸시의 가정판) — 한 줄 = 알림 하나 + [확인].
 * 차량 출발은 정보(파랑), 우리 아이 탑승·하차는 정상(초록), 미탑승은 위험(빨강) — 의미색 캐논.
 *
 * 🔑 [확인]을 누르면 그 줄은 바로 접고(낙관적), 서버에 확인 표식을 남긴 뒤 화면을 다시 읽는다.
 * ⚠️ 진짜 푸시가 없으니 화면이 보이는 동안만 `POLL_MS`마다 다시 읽는다(탭이 숨겨지면 쉰다).
 *    알림이 없어도 돌아야 한다 — 새 알림은 알림이 없을 때 생긴다.
 */
export function DepartureNoticeList({ notices }: { notices: ParentNotice[] }) {
  const router = useRouter();
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [router]);

  const idOf = (n: ParentNotice) => noticeAckId(n.runId, n.noticeKey);
  const shown = notices.filter((n) => !hidden.has(idOf(n)));
  if (shown.length === 0 && !error) return null;

  const ack = (n: ParentNotice) => {
    const id = idOf(n);
    setError(null);
    setHidden((prev) => new Set(prev).add(id));
    startTransition(async () => {
      const res = await ackParentNotice(n.runId, n.noticeKey);
      if ("error" in res) {
        setError(res.error);
        setHidden((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        return;
      }
      router.refresh();
    });
  };

  return (
    <section aria-label="알림" aria-live="polite" className="flex flex-col gap-1.5">
      {shown.map((n) => (
        <div
          key={idOf(n)}
          role="status"
          className={`flex items-center gap-2 rounded-xl px-3 py-2 ${TONE_SOFT[NOTICE_TONE[n.kind]]}`}
        >
          <span aria-hidden className="shrink-0 text-base leading-none">{NOTICE_ICON[n.kind]}</span>
          <p className="min-w-0 flex-1 text-sm font-bold break-keep">
            {parentNoticeText(n)}
            {n.time ? <span className="ml-1 text-xs font-medium opacity-80">{n.time}</span> : null}
            {/* 둘째 줄 — 탑승·미탑승은 정류장, 하차는 차 이름(정류장은 이미 문장에 있다). */}
            {n.kind === "dropoff" ? (
              <span className="block text-xs font-medium opacity-80">{[n.vehicleName, n.runName].filter(Boolean).join(" ")}</span>
            ) : n.kind !== "depart" && n.stopName ? (
              <span className="block text-xs font-medium opacity-80">{n.stopName}</span>
            ) : null}
          </p>
          <button
            type="button"
            onClick={() => ack(n)}
            disabled={pending}
            className="bg-card text-foreground h-8 shrink-0 rounded-lg px-3 text-xs font-bold shadow-[var(--shadow-card)] disabled:opacity-50"
          >
            확인
          </button>
        </div>
      ))}
      {error ? <p className="text-danger text-xs font-bold">{error}</p> : null}
    </section>
  );
}
