"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { EyIcon } from "@/components/icons/eywa-icons";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Archive, RotateCcw, Trash2 } from "@/components/icons/eywa-icon-compat";
import {
  archiveNotification,
  deleteNotification,
  fetchMyNotifications,
  markNotificationsRead,
  unarchiveNotification,
} from "@/features/notifications/server/actions";
import type { NotificationView } from "@/features/notifications/server/queries";
import { NOTIFICATION_ICON, type NotificationItem } from "@/features/notifications/types";
import { mergeAlerted, pickAlertTargets } from "@/features/notifications/important";
import { isTopFrame, showDesktopNotification } from "@/features/notifications/desktop-notify";
import { enableDesktopNotify, useNotifyPermission } from "@/features/notifications/notify-permission-store";
import { useWindowStore } from "@/components/workspace/window-store";
import { windowIdForHref } from "@/components/workspace/window-link";
import { useIsDesktop } from "@/components/workspace/use-is-desktop";
import { useWorkspaceEnabled } from "@/components/workspace/workspace-enabled";
import { NotificationAlertDialog } from "./notification-alert-dialog";
import { MobilePushRow } from "./mobile-push-row";

const POLL_MS = 60_000;

// 이미 강하게 알린(OS 알림·중앙 팝업) 알림 id — 새로고침·다중 탭에서 같은 알림이 반복 팝업되는 것 차단.
// ⚠️ lazy useState 초기화로 읽지 말 것(하이드레이션 불일치) — 반드시 effect에서 ref로 seed.
const ALERTED_KEY = "eywa-notify-alerted";

function loadAlerted(): string[] {
  try {
    const raw = localStorage.getItem(ALERTED_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return []; // 저장소 차단·손상 → 중복 팝업이 최악이라 조용히 빈 목록(기능은 계속)
  }
}

function persistAlerted(addIds: string[]) {
  try {
    localStorage.setItem(ALERTED_KEY, JSON.stringify(mergeAlerted(loadAlerted(), addIds)));
  } catch {
    /* 저장 실패는 무시(메모리 ref로 이번 세션은 중복 방지됨) */
  }
}

/** 앱 밖으로 나가는 링크인가 — 알림 link는 보통 앱 경로(`/students/1`)지만 ClassNote 글은 절대 URL이다. */
function isExternal(link: string): boolean {
  return /^https?:\/\//i.test(link);
}

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
  // 알림 클릭 = 앱의 다른 모든 링크와 같은 이동 방식(플로팅 창)이어야 한다 — 아래 openItem 주석 참조.
  const isDesktop = useIsDesktop();
  const workspaceEnabled = useWorkspaceEnabled();
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [pendingLink, setPendingLink] = useState<string | null>(null); // 확인 대기 중인 외부 링크
  // 받은함/보관함(0125a) — 보관은 벨에서 치우되 나중에 볼 수 있는 안전판(삭제는 영구).
  const [view, setView] = useState<NotificationView>("active");
  const viewRef = useRef<NotificationView>("active");
  const [, startTransition] = useTransition();
  // 요청 순번 — 모든 서버 왕복(폴링·읽음처리·모두읽음)이 공유한다. 늦게 도착한 응답이
  // 최신 요청 결과를 덮지 않게(적대리뷰: mark 응답을 느린 폴링이 되돌리던 레이스).
  const reqRef = useRef(0);
  // 강하게 알림(OS 알림 + 화면 중앙 팝업) — 중요 유형만(important.ts). 벨만으론 강사가 지나침(원장 2026-07-15).
  const alertedRef = useRef<Set<string>>(new Set());
  const [popup, setPopup] = useState<{ item: NotificationItem; extra: number } | null>(null);
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
   * (외부 링크 확인창·새 탭 로직을 한 곳에만 두려고. router.push는 절대 URL에 안 먹는다).
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
    showDesktopNotification({ title: newest.title, body: newest.body, tag: newest.id });
    setPopup({ item: newest, extra: targets.length - 1 });
  }, []);

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
  const refresh = useCallback(() => run(() => fetchMyNotifications(view)), [run, view]);

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

  // 보관/복원/삭제 — 낙관적으로 목록에서 즉시 제거하고 서버 응답(그 뷰의 최신 목록+unread)으로 동기화.
  // run이 seq를 올려 in-flight 폴링이 옛 목록을 되돌리지 못한다(읽음처리와 동일 레이스 방어).
  function removeThen(id: string, fn: () => Promise<{ unread: number; items: NotificationItem[] }>) {
    setItems((prev) => prev.filter((x) => x.id !== id));
    run(fn);
  }

  function openItem(n: NotificationItem) {
    if (!n.read) {
      // 낙관적 갱신 후 서버 반영(응답으로 최종 동기화). run이 seq를 올려 in-flight 폴링이 되돌리지 못한다.
      setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
      setUnread((u) => Math.max(0, u - 1));
      run(() => markNotificationsRead([n.id]));
    }
    if (!n.link) return;
    // 외부 링크(ClassNote 학부모 글 등)는 eywa를 벗어나므로 먼저 확인받는다 — router.push는 앱 내부 경로 전용이라
    // 절대 URL을 넘기면 동작하지 않는다. 확인 후 새 탭으로 열어 작업 중이던 eywa 화면을 잃지 않게 한다.
    if (isExternal(n.link)) {
      setPendingLink(n.link);
      return;
    }
    // ⚠️ 앱 내부 경로는 **플로팅 창**으로 연다 — router.push는 창 뒤 배경 프레임만 바꾼다(2026-07-27 원장 제보
    // "알림을 눌렀는데 아무런 출력이 없다"의 진짜 원인). 데스크톱 풀셸은 메뉴가 전부 창이라 화면이 창으로 덮여
    // 있는 게 정상 상태고, 그 밑에서 배경이 바뀌어봐야 **눈에 보이는 변화가 0**이다. WindowLink와 같은 경로·
    // 같은 가드를 쓴다(창 시스템 없는 강사 미니셸·모바일·임베드는 아래 router.push로 자연 폴백).
    const onWorkspace = isDesktop && workspaceEnabled && isTopFrame();
    // ⚠️ 운영실도 이제 **다른 메뉴와 같은 창**이다(원장 2026-09-07) — 특례가 사라졌다.
    //    해시(`/dashboard#daily-briefing`)는 창 주소에 그대로 실려 그 자리로 스크롤된다
    //    (`withEmbed`가 해시를 분리해 붙인다 — 안 그러면 embed가 프래그먼트로 들어가 창 안에 풀 셸이 뜬다).
    const resolved = onWorkspace ? windowIdForHref(n.link) : null;
    if (resolved) {
      useWindowStore
        .getState()
        .open("route", { id: resolved.id, title: resolved.navLabel ?? n.title, href: n.link });
      return;
    }
    router.push(n.link);
  }

  const badge = unread > 99 ? "99+" : String(unread);

  return (
    <>
    <DropdownMenu onOpenChange={(open) => open && refresh()}>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-label={unread > 0 ? `알림 ${unread}개` : "알림"}
            className={`group relative flex size-9 items-center justify-center rounded-lg border bg-card transition-all duration-200 hover:bg-surface-hi hover:shadow-card-hover active:scale-95 ${
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
            <span className="bg-danger text-white ring-card relative inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-xs font-bold tabular-nums shadow-sm ring-2 [animation:badge-pop_0.35s_ease-out]">
              {badge}
            </span>
          </span>
        ) : null}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between px-3 py-2">
          <DropdownMenuLabel className="p-0">{view === "archived" ? "보관함" : "알림"}</DropdownMenuLabel>
          <span className="flex items-center gap-2.5">
            {view === "active" && unread > 0 ? (
              <button
                type="button"
                onClick={markAllRead}
                className="text-text-dim hover:text-foreground text-xs transition"
              >
                모두 읽음
              </button>
            ) : null}
            {/* 받은함 ↔ 보관함 전환 — 보관은 삭제의 안전판(복원 가능). */}
            <button
              type="button"
              onClick={() => setView((v) => (v === "active" ? "archived" : "active"))}
              className="text-text-dim hover:text-foreground inline-flex items-center gap-1 text-xs transition"
            >
              <Archive className="size-3" />
              {view === "archived" ? "받은 알림" : "보관함"}
            </button>
          </span>
        </div>
        <DropdownMenuSeparator className="my-0" />
        {/* 컴퓨터(OS) 알림 권한 — 중요 알림을 브라우저 밖에서도 확실히 받게. 권한 요청은 사용자 제스처(클릭)에서만
            가능해 여기 버튼으로 노출한다. granted면 아무것도 안 보임(조용). */}
        {view === "active" && perm === "default" ? (
          <button
            type="button"
            onClick={() => void enableDesktopNotify()}
            className="border-line hover:bg-bg-soft flex w-full items-center gap-1.5 border-b px-3 py-2 text-left text-xs transition"
          >
            <EyIcon name="bell" size={13} className="text-primary shrink-0" />
            <span className="text-foreground font-bold">컴퓨터 알림 켜기</span>
            <span className="text-text-faint truncate">— 창 밖에서도 받기</span>
          </button>
        ) : view === "active" && perm === "denied" ? (
          <p className="text-text-faint border-line border-b px-3 py-2 text-xs leading-snug break-keep">
            컴퓨터 알림이 차단돼 있습니다 — 주소창의 자물쇠 &gt; 알림에서 &lsquo;허용&rsquo;으로 바꿔주세요.
          </p>
        ) : null}
        {/* 휴대폰(웹 푸시) 알림 — **셔틀 토글을 켠 계정에만** 뜬다(0188a). 위 컴퓨터 알림과 별개 경로:
            그쪽은 창이 열려 있을 때만이고, 이쪽은 브라우저를 닫아도 잠금화면에 뜬다. */}
        {view === "active" ? <MobilePushRow /> : null}
        {items.length === 0 ? (
          <div className="text-text-dim px-2 py-8 text-center text-xs">
            {view === "archived" ? "보관한 알림이 없습니다" : "새 알림이 없습니다"}
          </div>
        ) : (
          <div className="scrollbar-thin max-h-[360px] overflow-y-auto py-1">
            {items.map((n) => (
              // 행 전체=열기 클릭 영역이지만 내부에 보관/삭제 **실제 버튼**이 들어가 중첩 button이
              // 불가(HTML) → div+role. 항목 액션은 hover(또는 키보드 포커스)에서만 노출.
              <div
                key={n.id}
                role="button"
                tabIndex={0}
                onClick={() => openItem(n)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    openItem(n);
                  }
                }}
                className={`group/item hover:bg-bg-soft flex w-full cursor-pointer items-start gap-2.5 px-3 py-2 text-left transition ${
                  n.read ? "" : "bg-primary-soft/40"
                }`}
              >
                <span className="text-text-dim mt-0.5 flex size-5 shrink-0 items-center justify-center">
                  <EyIcon name={NOTIFICATION_ICON[n.type] ?? "bell"} size={15} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="text-foreground truncate text-xs font-bold">{n.title}</span>
                    {!n.read ? <span className="bg-primary size-1.5 shrink-0 rounded-full" /> : null}
                    <span className="text-text-faint ml-auto shrink-0 text-xs">
                      {relTime(n.createdAt)}
                    </span>
                    {/* 항목 액션 — 받은함: 보관·삭제 / 보관함: 복원·삭제. 클릭이 행 열기로 번지지 않게 정지. */}
                    <span className="hidden shrink-0 items-center gap-0.5 group-focus-within/item:flex group-hover/item:flex">
                      {view === "active" ? (
                        <button
                          type="button"
                          title="보관 — 목록에서 치우고 보관함에 보관"
                          aria-label="보관"
                          onClick={(e) => {
                            e.stopPropagation();
                            removeThen(n.id, () => archiveNotification(n.id, "active"));
                          }}
                          className="text-text-dim hover:text-foreground hover:bg-line/60 flex size-5 items-center justify-center rounded-full transition"
                        >
                          <Archive className="size-3" />
                        </button>
                      ) : (
                        <button
                          type="button"
                          title="받은 알림으로 복원"
                          aria-label="복원"
                          onClick={(e) => {
                            e.stopPropagation();
                            removeThen(n.id, () => unarchiveNotification(n.id, "archived"));
                          }}
                          className="text-text-dim hover:text-foreground hover:bg-line/60 flex size-5 items-center justify-center rounded-full transition"
                        >
                          <RotateCcw className="size-3" />
                        </button>
                      )}
                      <button
                        type="button"
                        title="삭제 — 되돌릴 수 없음(치우기만 하려면 보관)"
                        aria-label="삭제"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeThen(n.id, () => deleteNotification(n.id, view));
                        }}
                        className="text-text-dim hover:text-danger hover:bg-danger-soft flex size-5 items-center justify-center rounded-full transition"
                      >
                        <Trash2 className="size-3" />
                      </button>
                    </span>
                  </span>
                  {n.body ? (
                    <span className="text-text-dim mt-0.5 block text-xs leading-snug">{n.body}</span>
                  ) : null}
                </span>
              </div>
            ))}
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
    {/* 드롭다운 **밖**에 둔다 — 안에 두면 메뉴가 닫힐 때 같이 언마운트돼 확인창이 뜨자마자 사라진다. */}
    <ConfirmDialog
      open={pendingLink !== null}
      title="ClassNote로 이동"
      message="해당 글로 이동하시겠습니까? ClassNote가 새 탭에서 열립니다."
      confirmLabel="이동"
      onConfirm={() => {
        const url = pendingLink;
        setPendingLink(null);
        // noopener/noreferrer — 새 탭이 window.opener로 eywa 세션 창을 건드리지 못하게(탭내빙 방지).
        if (url) window.open(url, "_blank", "noopener,noreferrer");
      }}
      onCancel={() => setPendingLink(null)}
    />
    {/* 중요 알림 화면 중앙 팝업 — 벨 드롭다운을 안 열어도 확실히 보이게(원장 2026-07-15).
        '바로 가기'는 openItem을 태워 외부 링크(ClassNote 글)면 위 ConfirmDialog로 이어진다. */}
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
