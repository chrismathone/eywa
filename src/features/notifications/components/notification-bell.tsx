"use client";

import { Fragment, useCallback, useEffect, useId, useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { EyIcon } from "@/components/icons/aywa-icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Archive } from "@/components/icons/aywa-icon-compat";
import {
  archiveNotification,
  deleteAllNotifications,
  deleteNotification,
  markNotificationsRead,
  unarchiveNotification,
} from "@/features/notifications/server/actions";
// 목록 조회(마운트·이동·포커스·60초 폴링)는 서버 액션이 아니라 GET 라우트 — 라우터 작업 큐 경합으로 Next 기본 오류
// 화면이 떴다(gotchas #137). 위 액션들은 **누를 때만** 부르므로 그대로 둔다.
import { fetchMyNotificationsList } from "@/features/notifications/fetch-my-notifications";
import type { NotificationView } from "@/features/notifications/server/queries";
import {
  NOTIFICATION_LIST_LIMIT,
  NOTIFICATION_LIST_MAX,
  type NotificationItem,
} from "@/features/notifications/types";
import {
  mergeAlerted,
  pickAlertTargets,
} from "@/features/notifications/important";
import {
  isTopFrame,
  showDesktopNotification,
} from "@/features/notifications/desktop-notify";
import {
  enableDesktopNotify,
  useNotifyPermission,
} from "@/features/notifications/notify-permission-store";
import { useWindowStore } from "@/components/workspace/window-store";
import { openLinkWindow } from "@/components/workspace/open-menu-window";
import { windowIdForHref } from "@/components/workspace/window-link";
import { adminVideoLedgerHref } from "@/features/notifications/presentation";
import { useIsDesktop } from "@/components/workspace/use-is-desktop";
import { useWorkspaceEnabled } from "@/components/workspace/workspace-enabled";
import { useMenuHub } from "@/components/workspace/menu-hub-store";
import { NotificationRow } from "./notification-row";
import { NotificationAlertDialog } from "./notification-alert-dialog";
import { MobilePushRow } from "./mobile-push-row";
import { BELL_ANCHOR_ATTR, ParentReplyOverlay } from "@/features/classnote-reply/components/parent-reply-overlay";
import { useReplyTargets } from "@/features/classnote-reply/components/use-reply-targets";
import { ParentNotificationRow } from "@/features/classnote-reply/components/parent-notification-row";
import { isParentMessageNotification } from "@/features/classnote-reply/notification-match";
import type { StaffTaskSummary } from "@/features/staff-tasks/kinds";
import { BellTaskRow } from "@/features/staff-tasks/components/bell-task-row";
import { StaffTaskDialog, type StaffTaskDialogTarget } from "@/features/staff-tasks/components/staff-task-dialog";

const POLL_MS = 60_000;

// 이미 강하게 알린(OS 알림·중앙 팝업) 알림 id — 새로고침·다중 탭에서 같은 알림이 반복 팝업되는 것 차단.
// ⚠️ lazy useState 초기화로 읽지 말 것(하이드레이션 불일치) — 반드시 effect에서 ref로 seed.
const ALERTED_KEY = "eywa-notify-alerted";

function loadAlerted(): string[] {
  try {
    const raw = localStorage.getItem(ALERTED_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr)
      ? arr.filter((x): x is string => typeof x === "string")
      : [];
  } catch {
    return []; // 저장소 차단·손상 → 중복 팝업이 최악이라 조용히 빈 목록(기능은 계속)
  }
}

function persistAlerted(addIds: string[]) {
  try {
    localStorage.setItem(
      ALERTED_KEY,
      JSON.stringify(mergeAlerted(loadAlerted(), addIds)),
    );
  } catch {
    /* 저장 실패는 무시(메모리 ref로 이번 세션은 중복 방지됨) */
  }
}

/** 앱 밖으로 나가는 링크인가 — 알림 link는 보통 앱 경로(`/students/1`)지만 ClassNote 글은 절대 URL이다. */
function isExternal(link: string): boolean {
  return /^https?:\/\//i.test(link);
}

export function NotificationBell() {
  const router = useRouter();
  const pathname = usePathname();
  // 알림 클릭 = 앱의 다른 모든 링크와 같은 이동 방식(플로팅 창)이어야 한다 — 아래 openItem 주석 참조.
  const isDesktop = useIsDesktop();
  const workspaceEnabled = useWorkspaceEnabled();
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  // 학부모 글·댓글 답글 창(0317a) — 답글을 쓸 수 있는 알림(알림 id → 메시지 id)은 벨이 열릴 때만 묻는다.
  // 공감 대상이 모호한 옛 댓글은 창을 열 때 서버에서 다시 판정한다.
  const [replyOpen, setReplyOpen] = useState<string | null>(null); // 알림 id — 본문·답글 버튼 모두 같은 창
  const bellId = useId(); // 답글 오버레이가 붙을 **이** 벨 단추(화면에 벨이 둘이어도 연 그 벨 자리에 뜬다)
  const { targets: replyTargets, reactions: replyReactions, counts: replyCounts } = useReplyTargets(items, menuOpen);
  // 답글 오버레이를 닫고 목록으로 돌아올 때 읽던 자리(스크롤)를 되돌린다 — 드롭다운은 닫히며 언마운트돼 위치가 사라진다.
  const listScrollRef = useRef(0);
  const restoreScroll = useCallback((el: HTMLDivElement | null) => {
    if (el && listScrollRef.current) el.scrollTop = listScrollRef.current;
  }, []);
  // 받은함/보관함(0125a) — 보관은 벨에서 치우되 나중에 볼 수 있는 안전판(삭제는 영구).
  const [view, setView] = useState<NotificationView>("active");
  // 전체 삭제 확인 — 영구 삭제라 한 번 더 묻는다(헤더 줄이 확인 줄로 바뀐다). 뷰를 바꾸거나 메뉴를 닫으면 풀린다.
  const [confirmClear, setConfirmClear] = useState(false);
  // 할 일(0377a) — 목록 응답에 실려 온다(읽음·보관 응답엔 없어서 마지막 값을 유지). 창은 벨 밖에 뜬다.
  const [tasks, setTasks] = useState<StaffTaskSummary | null>(null);
  const [taskTarget, setTaskTarget] = useState<StaffTaskDialogTarget | null>(null);
  const viewRef = useRef<NotificationView>("active");
  // 목록 크기 — 배지는 안 읽은 알림 전체를 세는데 목록은 잘려 있다. '더 보기'로 늘린다(F17). 뷰를 바꾸면 20으로.
  const [limit, setLimit] = useState(NOTIFICATION_LIST_LIMIT);
  const [, startTransition] = useTransition();
  // 요청 순번 — 모든 서버 왕복(폴링·읽음처리·모두읽음)이 공유한다. 늦게 도착한 응답이
  // 최신 요청 결과를 덮지 않게(적대리뷰: mark 응답을 느린 폴링이 되돌리던 레이스).
  const reqRef = useRef(0);
  // 강하게 알림(OS 알림 + 화면 중앙 팝업) — 중요 유형만(important.ts). 벨만으론 강사가 지나침(원장 2026-07-15).
  const alertedRef = useRef<Set<string>>(new Set());
  const [popup, setPopup] = useState<{
    item: NotificationItem;
    extra: number;
  } | null>(null);
  // 권한은 브라우저가 들고 있는 외부 상태 → 스토어에서 구독(setState-in-effect·하이드레이션 함정 회피).
  const perm = useNotifyPermission();

  // 이미 알린 id seed — **ref 대입만**(setState 아님 → 캐스케이드 렌더 없음). lazy useState 초기화는 금지
  // (SSR엔 localStorage 없음). 이 effect가 첫 refresh 응답(비동기)보다 먼저 동기 실행되므로,
  // 앱을 켤 때 예전 알림이 무더기로 팝업되는 일은 없다.
  useEffect(() => {
    alertedRef.current = new Set(loadAlerted());
  }, []);

  /**
   * 새로 관측된 **중요** 알림을 확실히 알린다 — OS 알림 + 중앙 팝업. 한 알림당 평생 1회
   * (닫아도 벨엔 안 읽음으로 남음). 여러 건이면 최신 1건만 띄우고 나머지는 "외 N건".
   * ⚠️ 최상위 프레임에서만 — iframe(창) 중복 발사 방어(현 구조상 임베드엔 벨이 없지만 방어로 유지).
   * OS 알림 클릭은 **창 포커스까지만** — 실제 이동은 중앙 팝업의 '바로 가기'가 openItem으로 처리한다
   * (학부모 글은 같은 답글창, 앱 내부 링크는 해당 작업 화면으로 보낸다).
   */
  const maybeAlert = useCallback((list: NotificationItem[]) => {
    if (!isTopFrame()) return;
    const targets = pickAlertTargets(list, alertedRef.current);
    if (targets.length === 0) return;
    const newest = targets[0]!; // 서버가 최신순 반환
    // 관측 즉시 기록 — 다중 탭이 동시에 폴링해도 같은 알림이 두 번 뜨는 창을 최소화.
    const ids = targets.map((t) => t.id);
    ids.forEach((id) => alertedRef.current.add(id));
    persistAlerted(ids);
    showDesktopNotification({
      title: newest.title,
      body: newest.body,
      tag: newest.id,
    });
    setPopup({ item: newest, extra: targets.length - 1 });
  }, []);

  // seq를 발급하고, 응답 도착 시 그 seq가 아직 최신일 때만 반영하는 공용 러너.
  const run = useCallback(
    (fn: () => Promise<{ unread: number; items: NotificationItem[]; tasks?: StaffTaskSummary }>) => {
      const seq = ++reqRef.current;
      startTransition(async () => {
        try {
          const res = await fn();
          if (seq === reqRef.current) {
            setItems(res.items);
            setUnread(res.unread);
            if (res.tasks) setTasks(res.tasks);
            // 읽음처리 응답에도 태우지만 read=true라 대상에서 걸러짐. 보관함 뷰의 목록으로는
            // 팝업을 쏘지 않는다(치워둔 알림이 다시 울리면 보관이 무의미).
            if (viewRef.current === "active") maybeAlert(res.items);
          }
        } catch {
          /* best-effort — 벨 갱신 실패는 조용히 무시 */
        }
      });
    },
    [maybeAlert],
  );

  // view 변경 시 refresh 정체가 바뀌어 아래 effect들이 새 뷰로 다시 당겨온다. ref는 run 내부 가드용.
  useEffect(() => {
    viewRef.current = view;
  }, [view]);
  const refresh = useCallback(
    () => run(() => fetchMyNotificationsList(view, limit)),
    [run, view, limit],
  );

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

  // '모두 읽음' = **보이는 목록의** 안 읽은 알림만(F17) — 목록 밖 알림까지 치우면 보지도 못한 알림이 사라진다.
  const visibleUnreadIds = items.filter((n) => !n.read).map((n) => n.id);
  const hiddenUnread = view === "active" ? Math.max(0, unread - visibleUnreadIds.length) : 0;
  function markAllRead() {
    if (visibleUnreadIds.length === 0) return;
    const ids = new Set(visibleUnreadIds);
    setItems((prev) => prev.map((x) => (ids.has(x.id) ? { ...x, read: true } : x)));
    setUnread((u) => Math.max(0, u - ids.size));
    run(() => markNotificationsRead(visibleUnreadIds, view, limit));
  }

  // 전체 삭제 = **지금 뷰 전체**(목록 밖 포함) 영구 삭제. 다른 뷰(받은 알림 ↔ 보관함)는 그대로 둔다.
  function deleteAll() {
    // 상한 = 보이던 알림 중 가장 최근 것 — 확인 사이 새로 온 알림은 남는다.
    //    ⚠️ 목록 첫 줄이 아니다: 안 읽은 알림이 위로 오므로(원장 2026-10-29) 첫 줄이 가장 최근이 아닐 수 있다.
    const upTo = items.reduce<string | undefined>((max, n) => (!max || n.createdAt > max ? n.createdAt : max), undefined);
    setConfirmClear(false);
    setItems([]);
    if (view === "active") setUnread(0);
    run(() => deleteAllNotifications(view, limit, upTo));
  }

  // 보관/복원/삭제 — 낙관적으로 목록에서 즉시 제거하고 서버 응답(그 뷰의 최신 목록+unread)으로 동기화.
  // run이 seq를 올려 in-flight 폴링이 옛 목록을 되돌리지 못한다(읽음처리와 동일 레이스 방어).
  function removeThen(
    id: string,
    fn: () => Promise<{ unread: number; items: NotificationItem[] }>,
  ) {
    setItems((prev) => prev.filter((x) => x.id !== id));
    run(fn);
  }

  function openItem(n: NotificationItem) {
    setMenuOpen(false);
    if (!n.read) {
      // 낙관적 갱신 후 서버 반영(응답으로 최종 동기화). run이 seq를 올려 in-flight 폴링이 되돌리지 못한다.
      setItems((prev) =>
        prev.map((x) => (x.id === n.id ? { ...x, read: true } : x)),
      );
      setUnread((u) => Math.max(0, u - 1));
      run(() => markNotificationsRead([n.id], view, limit));
    }
    // 목록의 답글 자격 조회 전에도 즉시 창을 연다. 서버가 내 알림 → 원문·첨부·답글 권한을 확인한다.
    if (isParentMessageNotification(n.type)) {
      setReplyOpen(n.id);
      return;
    }
    // 늦은 할 일 요약 → 늦은 할 일 목록(현황 권한이 있을 때 · 없으면 링크 그대로).
    if (n.type === "staff_task_digest" && tasks?.canMonitor) {
      setTaskTarget({ scope: "all", filter: "late" });
      return;
    }
    if (!n.link) return;
    const onWorkspace = isDesktop && workspaceEnabled && isTopFrame();
    // 영상 숙제 알림은 강사 화면 주소로 저장된다 — 창을 쓰는 관리자 화면에서는 관리자용 현황을 창으로 연다
    // (강사 화면 주소는 강사뷰가 아니면 첫 화면으로 돌아가고, 창으로 매핑되지 않아 배경에서만 바뀐다 — #86).
    const link = onWorkspace ? adminVideoLedgerHref(n.link) : n.link;
    // 학부모 알림 외의 외부 링크. 학부모 글의 이동 버튼은 답글창에서 실제 담임에게만 제공한다.
    if (isExternal(link)) {
      window.open(link, "_blank", "noopener,noreferrer");
      return;
    }
    // ⚠️ 앱 내부 경로는 **플로팅 창**으로 연다 — router.push는 창 뒤 배경 프레임만 바꾼다(2026-07-27 원장 제보
    // "알림을 눌렀는데 아무런 출력이 없다"의 진짜 원인). 데스크톱 풀셸은 메뉴가 전부 창이라 화면이 창으로 덮여
    // 있는 게 정상 상태고, 그 밑에서 배경이 바뀌어봐야 **눈에 보이는 변화가 0**이다. WindowLink와 같은 경로·
    // 같은 가드를 쓴다(창 시스템 없는 강사 미니셸·모바일·임베드는 아래 router.push로 자연 폴백).
    // Reveal the dashboard behind work windows before following its section link.
    if (onWorkspace && link.split(/[?#]/)[0] === "/dashboard") {
      useMenuHub.getState().close();
      useWindowStore.getState().showDesktop();
      if (pathname === "/dashboard") {
        const hash = link.split("#")[1];
        if (hash)
          requestAnimationFrame(() =>
            document.getElementById(hash)?.scrollIntoView({ block: "start" }),
          );
      }
    }
    const resolved = onWorkspace ? windowIdForHref(link) : null;
    if (resolved) {
      // 🔴 떠 있는 메뉴 판을 닫는다 — 판(z-44)이 창 캔버스(z-40)를 덮어, 두면 방금 연 창이 판 밑에 깔려
      //    아무 일도 없던 것처럼 보인다(2026-09-11 리뷰). 운영실 링크는 위에서 이미 닫는다.
      useMenuHub.getState().close();
      openLinkWindow({
        id: resolved.id,
        title: resolved.navLabel ?? n.title,
        href: link,
      });
      return;
    }
    router.push(link);
  }

  const badge = unread > 99 ? "99+" : String(unread);

  return (
    <>
      <DropdownMenu
        open={menuOpen}
        onOpenChange={(open) => {
          setMenuOpen(open);
          setConfirmClear(false);
          if (open) {
            listScrollRef.current = 0; // 새로 여는 목록은 맨 위부터(오버레이에서 돌아올 때만 읽던 자리로)
            refresh();
          }
        }}
      >
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              aria-label={unread > 0 ? `알림 ${unread}개` : "알림"}
              {...{ [BELL_ANCHOR_ATTR]: bellId }}
              className={`group relative flex size-9 items-center justify-center rounded-lg border bg-card transition-all duration-200 hover:bg-surface-hi hover:shadow-card-hover active:scale-95 ${
                unread > 0
                  ? "border-danger/30 text-danger"
                  : "border-line text-foreground"
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
                ? "motion-safe:[animation:bell-swing_0.7s_ease-in-out]"
                : "motion-safe:group-hover:[animation:bell-swing_0.7s_ease-in-out]"
            }`}
          />
          {unread > 0 ? (
            <span className="absolute -top-1.5 -right-1.5 flex h-[18px] min-w-[18px]">
              <span className="bg-danger text-white ring-card relative inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-xs font-bold tabular-nums shadow-sm ring-2 [animation:badge-pop_0.35s_ease-out]">
                {badge}
              </span>
            </span>
          ) : null}
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="w-[min(400px,calc(100vw-24px))] p-0"
        >
          {confirmClear ? (
            <div className="bg-danger-soft flex items-center justify-between gap-2 px-3 py-2">
              <span className="text-foreground text-xs leading-snug break-keep">
                {view === "archived" ? "보관함" : "받은 알림"} 전체를 영구 삭제합니다
                {hiddenUnread > 0 ? ` (목록 밖 안 읽은 ${hiddenUnread}건 포함)` : ""}. 되돌릴 수 없습니다.
              </span>
              <span className="flex shrink-0 items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setConfirmClear(false)}
                  className="text-text-dim hover:text-foreground rounded-md px-2 py-1 text-xs transition"
                >
                  취소
                </button>
                <button
                  type="button"
                  onClick={deleteAll}
                  className="bg-danger rounded-md px-2 py-1 text-xs font-bold text-white transition hover:opacity-90"
                >
                  삭제
                </button>
              </span>
            </div>
          ) : (
          <div className="flex items-center justify-between px-3 py-2">
            <DropdownMenuLabel className="p-0">
              {view === "archived" ? "보관함" : "알림"}
            </DropdownMenuLabel>
            <span className="flex items-center gap-2.5">
              {view === "active" && visibleUnreadIds.length > 0 ? (
                <button
                  type="button"
                  onClick={markAllRead}
                  className="text-text-dim hover:text-foreground text-xs transition"
                  title={hiddenUnread > 0 ? "목록에 보이는 알림만 읽음으로 바꿉니다" : undefined}
                >
                  {hiddenUnread > 0 ? "보이는 알림 읽음" : "모두 읽음"}
                </button>
              ) : null}
              {items.length > 0 ? (
                <button
                  type="button"
                  onClick={() => setConfirmClear(true)}
                  className="text-text-dim hover:text-danger text-xs transition"
                >
                  전체 삭제
                </button>
              ) : null}
              {/* 받은함 ↔ 보관함 전환 — 보관은 삭제의 안전판(복원 가능). */}
              <button
                type="button"
                onClick={() => {
                  setLimit(NOTIFICATION_LIST_LIMIT);
                  setConfirmClear(false);
                  setView((v) => (v === "active" ? "archived" : "active"));
                }}
                className="text-text-dim hover:text-foreground inline-flex items-center gap-1 text-xs transition"
              >
                <Archive className="size-3" />
                {view === "archived" ? "받은 알림" : "보관함"}
              </button>
            </span>
          </div>
          )}
          <DropdownMenuSeparator className="my-0" />
          {/* 휴대폰(웹 푸시) 알림 — **셔틀 토글을 켠 계정에만** 뜬다(0188a). 위 컴퓨터 알림과 별개 경로:
            그쪽은 창이 열려 있을 때만이고, 이쪽은 브라우저를 닫아도 잠금화면에 뜬다. */}
          {view === "active" ? <MobilePushRow /> : null}
          {view === "active" && tasks ? <BellTaskRow summary={tasks} onOpen={(target) => { setMenuOpen(false); setTaskTarget(target); }} /> : null}
          {items.length === 0 ? (
            <div className="text-text-dim px-2 py-8 text-center text-xs">
              {view === "archived"
                ? "보관한 알림이 없습니다"
                : "새 알림이 없습니다"}
            </div>
          ) : (
            <div ref={restoreScroll} onScroll={(e) => { listScrollRef.current = e.currentTarget.scrollTop; }} className="scrollbar-thin max-h-[min(480px,60dvh)] overflow-y-auto py-1">
              {items.map((n, index) => {
                // 학부모 글·댓글 알림 중 답글을 쓸 수 있는 줄에는 공감 조작(0319a)을 얹는다 — 공감 기능이 없으면 보통 알림 행 그대로.
                const messageId = replyTargets[n.id];
                const reaction = messageId ? (replyReactions?.[messageId] ?? null) : null;
                const row = {
                  item: n,
                  archived: view === "archived",
                  onOpen: () => openItem(n),
                  replyCount: messageId ? (replyCounts[messageId] ?? 0) : 0,
                  onReply: messageId ? () => openItem(n) : undefined,
                  onArchive: () =>
                    removeThen(n.id, () =>
                      view === "active"
                        ? archiveNotification(n.id, "active", limit)
                        : unarchiveNotification(n.id, "archived", limit),
                    ),
                  onDelete: () => removeThen(n.id, () => deleteNotification(n.id, view, limit)),
                };
                // 안 읽은 알림(위) · 읽은 알림(아래) 사이에 구분선 한 줄 — 어디까지가 새 소식인지 보이게.
                const divider = view === "active" && n.read && index > 0 && !items[index - 1]!.read
                  ? <p className="text-text-faint border-line/70 border-t px-3 pt-2 pb-1 text-xs">읽은 알림</p>
                  : null;
                return (
                  <Fragment key={n.id}>
                    {divider}
                    {reaction ? <ParentNotificationRow reaction={reaction} {...row} /> : <NotificationRow {...row} />}
                  </Fragment>
                );
              })}
              {/* 더 보기(F17) — 목록이 꽉 찼으면 더 있을 수 있다. 목록 밖 안 읽은 알림 수를 함께 밝힌다. */}
              {items.length >= limit && limit < NOTIFICATION_LIST_MAX ? (
                <button
                  type="button"
                  onClick={() =>
                    setLimit((l) => Math.min(NOTIFICATION_LIST_MAX, l + NOTIFICATION_LIST_LIMIT))
                  }
                  className="text-text-dim hover:text-foreground hover:bg-bg-soft w-full px-3 py-2 text-center text-xs transition"
                >
                  더 보기{hiddenUnread > 0 ? ` · 안 읽은 알림 ${hiddenUnread}건 더` : ""}
                </button>
              ) : hiddenUnread > 0 ? (
                <p className="text-text-faint px-3 py-2 text-center text-xs">
                  목록 밖에 안 읽은 알림 {hiddenUnread}건이 더 있습니다
                </p>
              ) : null}
            </div>
          )}
          {/* 컴퓨터(OS) 알림 권한 — 중요 알림을 브라우저 밖에서도 확실히 받게. 권한 요청은 사용자 제스처(클릭)에서만
            가능해 여기 버튼으로 노출한다. granted면 아무것도 안 보임(조용). 목록 아래에 둔다(원장 2026-11-02 *"너무 알림이 정신없음"* — 맨 위 고정 줄이 알림을 밀어냈다). */}
          {view === "active" && perm === "default" ? (
            <button
              type="button"
              onClick={() => void enableDesktopNotify()}
              className="border-line hover:bg-bg-soft flex w-full items-center gap-1.5 border-t px-3 py-2 text-left text-xs transition"
            >
              <EyIcon name="bell" size={13} className="text-primary shrink-0" />
              <span className="text-foreground font-bold">
                컴퓨터 알림 켜기
              </span>
              <span className="text-text-faint truncate">
                — 창 밖에서도 받기
              </span>
            </button>
          ) : view === "active" && perm === "denied" ? (
            <p className="text-text-faint border-line border-t px-3 py-2 text-xs leading-snug break-keep">
              컴퓨터 알림이 차단돼 있습니다 — 주소창의 자물쇠 &gt; 알림에서
              &lsquo;허용&rsquo;으로 바꿔주세요.
            </p>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      {/* 학부모 답글 창 = 벨 목록이 있던 자리에 겹치는 오버레이(드롭다운 밖이라 목록을 닫아도 유지). key = 다른 알림을 열면 새 상태로.
        닫기·Esc = 목록으로 돌아감(메뉴 다시 열기) · 바깥 클릭 = 그냥 닫음. */}
      {replyOpen ? (
        <ParentReplyOverlay
          key={replyOpen}
          notificationId={replyOpen}
          anchorId={bellId}
          onClose={(how) => {
            setReplyOpen(null);
            if (how === "back") {
              setMenuOpen(true);
              refresh();
            }
          }}
        />
      ) : null}
      {taskTarget ? <StaffTaskDialog target={taskTarget} onClose={() => { setTaskTarget(null); refresh(); }} /> : null}
      {/* 중요 알림 화면 중앙 팝업 — 벨 드롭다운을 안 열어도 확실히 보이게(원장 2026-07-15).
        '바로 가기'도 openItem을 태워 같은 답글창으로 이어진다. */}
      <NotificationAlertDialog
        item={popup?.item ?? null}
        extraCount={popup?.extra ?? 0}
        perm={perm}
        onEnableDesktop={() => void enableDesktopNotify()}
        onClose={() => setPopup(null)}
        onOpenItem={openItem}
      />
    </>
  );
}
