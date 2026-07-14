"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { EyIcon } from "@/components/icons/eywa-icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { fetchMyNotifications, markNotificationsRead } from "@/features/notifications/server/actions";
import { NOTIFICATION_ICON, type NotificationItem } from "@/features/notifications/types";

const POLL_MS = 60_000;

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(diff)) return "";
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "방금";
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  const d = Math.floor(h / 24);
  return d < 7 ? `${d}일 전` : new Date(iso).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" });
}

export function NotificationBell() {
  const router = useRouter();
  const pathname = usePathname();
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [, startTransition] = useTransition();
  // 요청 순번 — 모든 서버 왕복(폴링·읽음처리·모두읽음)이 공유한다. 늦게 도착한 응답이
  // 최신 요청 결과를 덮지 않게(적대리뷰: mark 응답을 느린 폴링이 되돌리던 레이스).
  const reqRef = useRef(0);

  // seq를 발급하고, 응답 도착 시 그 seq가 아직 최신일 때만 반영하는 공용 러너.
  const run = useCallback(
    (fn: () => Promise<{ unread: number; items: NotificationItem[] }>) => {
      const seq = ++reqRef.current;
      startTransition(async () => {
        try {
          const res = await fn();
          if (seq === reqRef.current) {
            setItems(res.items);
            setUnread(res.unread);
          }
        } catch {
          /* best-effort — 벨 갱신 실패는 조용히 무시 */
        }
      });
    },
    [],
  );

  const refresh = useCallback(() => run(fetchMyNotifications), [run]);

  // 마운트 + 경로 변경(네비마다 신선) + 60초 폴링 + 창 포커스/가시성 복귀
  // (플로팅 창 안 작업 후 top-frame으로 돌아오면 즉시 갱신 — 60초 지연 완화, 적대리뷰).
  useEffect(() => {
    refresh();
  }, [refresh, pathname]);
  useEffect(() => {
    const t = setInterval(refresh, POLL_MS);
    const onFocus = () => refresh();
    const onVis = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(t);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [refresh]);

  function markAllRead() {
    run(() => markNotificationsRead());
  }

  function openItem(n: NotificationItem) {
    if (!n.read) {
      // 낙관적 갱신 후 서버 반영(응답으로 최종 동기화). run이 seq를 올려 in-flight 폴링이 되돌리지 못한다.
      setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
      setUnread((u) => Math.max(0, u - 1));
      run(() => markNotificationsRead([n.id]));
    }
    if (n.link) router.push(n.link);
  }

  const badge = unread > 99 ? "99+" : String(unread);

  return (
    <DropdownMenu onOpenChange={(open) => open && refresh()}>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-label={unread > 0 ? `알림 ${unread}개` : "알림"}
            className={`group relative flex size-9 items-center justify-center rounded-[4px] border bg-card transition-all duration-200 hover:bg-surface-hi hover:shadow-card-hover active:scale-95 ${
              unread > 0 ? "border-danger/30 text-danger" : "border-line text-foreground"
            }`}
          />
        }
      >
        {/* 벨 아이콘 — 안 읽음이면 은은히 "딸랑"(울린 뒤 쉼), 없으면 hover 시 1회 스윙(매단 것처럼 top 기준). */}
        <EyIcon
          name="bell"
          size={15}
          className={`origin-top transition-transform ${
            unread > 0
              ? "[animation:bell-swing_2.6s_ease-in-out_infinite]"
              : "group-hover:[animation:bell-swing_0.7s_ease-in-out]"
          }`}
        />
        {unread > 0 ? (
          <span className="absolute -top-1.5 -right-1.5 flex h-[18px] min-w-[18px]">
            {/* 뒤에서 번지는 ping 링 — 살아있는 "새 알림" 인디케이터 */}
            <span
              className="bg-danger absolute inline-flex h-full w-full animate-ping rounded-full opacity-50"
              aria-hidden
            />
            <span className="bg-danger text-danger-foreground ring-card relative inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-bold tabular-nums shadow-sm ring-2 [animation:badge-pop_0.35s_ease-out]">
              {badge}
            </span>
          </span>
        ) : null}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between px-3 py-2">
          <DropdownMenuLabel className="p-0">알림</DropdownMenuLabel>
          {unread > 0 ? (
            <button
              type="button"
              onClick={markAllRead}
              className="text-text-dim hover:text-foreground text-[11px] transition"
            >
              모두 읽음
            </button>
          ) : null}
        </div>
        <DropdownMenuSeparator className="my-0" />
        {items.length === 0 ? (
          <div className="text-text-dim px-2 py-8 text-center text-xs">새 알림이 없습니다</div>
        ) : (
          <div className="scrollbar-thin max-h-[360px] overflow-y-auto py-1">
            {items.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => openItem(n)}
                className={`hover:bg-bg-soft flex w-full items-start gap-2.5 px-3 py-2 text-left transition ${
                  n.read ? "" : "bg-primary-soft/40"
                }`}
              >
                <span className="text-text-dim mt-0.5 flex size-5 shrink-0 items-center justify-center">
                  <EyIcon name={NOTIFICATION_ICON[n.type] ?? "bell"} size={15} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="text-foreground truncate text-[12px] font-semibold">{n.title}</span>
                    {!n.read ? <span className="bg-primary size-1.5 shrink-0 rounded-full" /> : null}
                    <span className="text-text-faint ml-auto shrink-0 text-[10px]">
                      {relTime(n.createdAt)}
                    </span>
                  </span>
                  {n.body ? (
                    <span className="text-text-dim mt-0.5 block text-[11px] leading-snug">{n.body}</span>
                  ) : null}
                </span>
              </button>
            ))}
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
