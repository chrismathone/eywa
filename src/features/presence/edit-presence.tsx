"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { createClient } from "@/lib/supabase/client";
import { createDemandTracker } from "./connection-demand";
import { buildOthersByScope, isPresenceScope, type Editor, type RawPresenceState } from "./presence-state";

/**
 * 마지막 소비처가 사라진 뒤 채널을 유지하는 시간. 폼의 편집 토글(`useEditPresence(scope, editing)`)이
 * 껐다 켤 때마다 WS 핸드셰이크가 다시 도는 걸 막는다.
 */
const PRESENCE_LINGER_MS = 10_000;

/**
 * cross-user "수정중" presence — 테넌트 단일 채널 `edit-presence:${tenantId}`.
 * 편집 폼/UI가 `useEditPresence(scope)`로 자기 scope를 track, 목록/폼이 `useEditingOthers(scope)`로 읽는다.
 * ephemeral(연결 끊기면 자동 해제) · soft 표시(하드 잠금 아님) · 기존 same-browser 저장경고와 공존.
 * ⚠️ 배포 전 결정: v1은 public 채널. 강한 테넌트 격리는 { config:{ private:true } } + realtime.messages RLS.
 */

type PresenceUser = { id: string; displayName: string; tenantId: string };

type PresenceStore = {
  get: (scope: string) => Editor[];
  subscribe: (scope: string, cb: () => void) => () => void;
  startEditing: (scope: string) => void;
  stopEditing: (scope: string) => void;
};

const EMPTY: Editor[] = [];
const Ctx = createContext<PresenceStore | null>(null);

function sameEditors(a: Editor[], b: Editor[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i]!.userId !== b[i]!.userId || a[i]!.userName !== b[i]!.userName) return false;
  }
  return true;
}

export function EditPresenceProvider({
  user,
  trackDisabled = false,
  children,
}: {
  user: PresenceUser;
  /**
   * true면 **내 track을 전면 차단**(다른 사람 presence 읽기는 유지 — 구독만으로는 presence state에 안 실린다).
   * '다른 강사 뷰'(열람 전용)에서 켠다: 원스크린 "다른 창/기기 동시 열림" 경고가 `onescreen:{teacherId}:{date}`
   * 축이라, 여기서 track하면 **열람 대상 강사의 화면에 열람자가 그대로 뜬다**(원장 2026-08-19: 강사가 모르게).
   * 서버가 요청마다 계산해 내려주고 뷰 전환은 풀 문서 네비라 세션 중 안 바뀐다(useState 초기 캡처 안전).
   */
  trackDisabled?: boolean;
  children: ReactNode;
}) {
  // 비어있지 않은 scope만 보관, 변경 없으면 참조 유지 → useSyncExternalStore 안정.
  const snapshots = useRef(new Map<string, Editor[]>());
  const listeners = useRef(new Map<string, Set<() => void>>());
  // refcount — 같은 문서에서 두 컴포넌트가 같은 scope를 track할 수 있음(회의 제목 + AI 보고서 동시).
  const myScopes = useRef(new Map<string, number>());
  const channelRef = useRef<ReturnType<ReturnType<typeof createClient>["channel"]> | null>(null);

  // 채널 **지연 연결**(2026-07-29 성능 감사) — 소비처가 하나라도 있을 때만 WS를 연다. 창=iframe이라
  // 예전엔 창 개수만큼 WebSocket이 늘었고, presence를 안 쓰는 화면(시간표·출석부·수납…)도 예외가
  // 아니었다. 참조수 관리는 순수 모듈 [connection-demand](./connection-demand.ts)가 담당(Vitest).
  const [needChannel, setNeedChannel] = useState(false);
  const [demand] = useState(() =>
    createDemandTracker({ onChange: setNeedChannel, lingerMs: PRESENCE_LINGER_MS }),
  );
  useEffect(() => () => demand.dispose(), [demand]);

  // store는 mount 1회 생성(lazy useState). 메서드는 안정 ref 객체 + 세션 불변 user를 클로저로 잡아,
  // .current를 이벤트/효과 시점에만 읽는다(렌더 중 ref 접근 없음).
  const [store] = useState<PresenceStore>(() => {
    const retrack = () => {
      const ch = channelRef.current;
      if (!ch) return;
      const scopes = [...myScopes.current.keys()];
      if (scopes.length) void ch.track({ editingScopes: scopes, userId: user.id, userName: user.displayName });
      else void ch.untrack();
    };
    return {
      get: (scope) => snapshots.current.get(scope) ?? EMPTY,
      subscribe: (scope, cb) => {
        let set = listeners.current.get(scope);
        if (!set) {
          set = new Set();
          listeners.current.set(scope, set);
        }
        set.add(cb);
        // 읽기만 하는 소비처(useEditingOthers)도 채널이 있어야 값이 온다 — 수요로 센다.
        demand.retain();
        return () => {
          set!.delete(cb);
          if (!set!.size) listeners.current.delete(scope);
          demand.release();
        };
      },
      startEditing: (scope) => {
        if (trackDisabled) return; // 열람 전용 — myScopes가 항상 비어 track이 한 번도 안 나간다(위 prop 주석)
        myScopes.current.set(scope, (myScopes.current.get(scope) ?? 0) + 1);
        // retain이 채널을 열고, 열린 뒤 subscribe 콜백이 myScopes를 통째로 track한다(아래 효과).
        demand.retain();
        retrack();
      },
      stopEditing: (scope) => {
        if (trackDisabled) return; // startEditing과 짝 — retain/release 짝수 유지
        const n = (myScopes.current.get(scope) ?? 0) - 1;
        if (n <= 0) myScopes.current.delete(scope);
        else myScopes.current.set(scope, n);
        retrack();
        demand.release();
      },
    };
  });

  useEffect(() => {
    // 소비처가 없으면 아예 연결하지 않는다 — presence를 안 쓰는 창은 WS 0개.
    if (!needChannel) return;
    // presence key는 이 채널 구독 생명주기 동안 고정. 탭/기기마다 nonce가 달라 같은 계정 다른 탭도 구분된다.
    const myKey = `${user.id}:${Math.random().toString(36).slice(2)}`;
    // ref.current를 effect 진입 시점에 로컬로 고정 — cleanup이 다른 Map을 보게 되는 함정 차단
    // (react-hooks/exhaustive-deps 경고의 실제 사유). 이 두 Map은 프로바이더 수명 내내 같은 인스턴스다.
    const snaps = snapshots.current;
    const subs = listeners.current;
    const supabase = createClient();
    const ch = supabase.channel(`edit-presence:${user.tenantId}`, {
      config: { presence: { key: myKey } },
    });
    channelRef.current = ch;

    const rebuild = () => {
      const next = buildOthersByScope(ch.presenceState() as unknown as RawPresenceState, myKey);
      const cur = snaps;
      const scopes = new Set<string>([...cur.keys(), ...next.keys()]);
      const changed: string[] = [];
      for (const scope of scopes) {
        const a = cur.get(scope) ?? EMPTY;
        const b = next.get(scope) ?? EMPTY;
        if (sameEditors(a, b)) continue;
        if (b.length) cur.set(scope, b);
        else cur.delete(scope);
        changed.push(scope);
      }
      for (const scope of changed) subs.get(scope)?.forEach((cb) => cb());
    };

    ch.on("presence", { event: "sync" }, rebuild);
    ch.subscribe((status) => {
      if (status !== "SUBSCRIBED") return;
      const scopes = [...myScopes.current.keys()];
      if (scopes.length) void ch.track({ editingScopes: scopes, userId: user.id, userName: user.displayName });
    });

    return () => {
      void ch.untrack();
      supabase.removeChannel(ch);
      channelRef.current = null;
      // 채널이 닫히면 이전 스냅샷은 더 이상 사실이 아니다 — 남겨두면 "수정중"이 유령으로 굳는다.
      const stale = [...snaps.keys()];
      snaps.clear();
      for (const scope of stale) subs.get(scope)?.forEach((cb) => cb());
    };
  }, [needChannel, user.id, user.displayName, user.tenantId]);

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

/** 이 scope를 편집 중인 "다른" 사람들(내 탭 제외). 프로바이더 밖이면 빈 배열(no-op). */
export function useEditingOthers(scope: string): Editor[] {
  const store = useContext(Ctx);
  const subscribe = useCallback(
    (cb: () => void) => (store ? store.subscribe(scope, cb) : () => {}),
    [store, scope],
  );
  const getSnapshot = useCallback(() => (store ? store.get(scope) : EMPTY), [store, scope]);
  return useSyncExternalStore(subscribe, getSnapshot, () => EMPTY);
}

/**
 * 편집 중 presence track(refcount). **항상 호출**하되 `enabled`(+scope allowlist)로 제어 —
 * 조건부 hook 호출 금지. 마운트=track, 언마운트=untrack(refcount 0이면).
 */
export function useEditPresence(scope: string | undefined, enabled: boolean): void {
  const store = useContext(Ctx);
  const active = enabled && !!scope && isPresenceScope(scope);
  useEffect(() => {
    if (!store || !active || !scope) return;
    store.startEditing(scope);
    return () => store.stopEditing(scope);
  }, [store, active, scope]);
}
