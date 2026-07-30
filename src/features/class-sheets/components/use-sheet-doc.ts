"use client";

// ECS 문서 인스턴스 훅 — 저널 생명주기(계획 v2.2 §F).
// · instanceId = **마운트마다** crypto.randomUUID (sessionStorage 금지 — same-origin 플로팅 iframe·복제 탭 공유).
// · 산 인스턴스 증명 = Web Lock(`ecs-journal:{instanceId}`) 보유 + BroadcastChannel ping 응답(폴백).
// · 마운트 시 같은 (tenant,user,class,week)의 죽은 저널을 찾아 복구 후보로 노출(claim은 호출부 flush 경로).
import { useEffect, useMemo, useState } from "react";
import {
  claimJournal,
  createIdbJournalStorage,
  EcsPatchJournal,
  ECS_JOURNAL_LOCK_PREFIX,
  isInstanceAliveViaWebLocks,
  listRecoverableJournals,
  type JournalMutation,
  type JournalRecord,
} from "../lib/patch-journal";

const PING_CHANNEL = "ecs-journal-ping";
const PING_TIMEOUT_MS = 400;

export function useSheetDoc(identity: {
  tenantId: string;
  userId: string;
  classId: string;
  week: string;
}): {
  journal: EcsPatchJournal | null;
  recoverable: JournalRecord | null;
  claimRecoverable: () => Promise<JournalMutation[]>;
  dismissRecoverable: () => void;
} {
  const instanceId = useMemo(() => crypto.randomUUID(), []);
  const storage = useMemo(
    () => (typeof indexedDB === "undefined" ? null : createIdbJournalStorage()),
    [],
  );
  const journal = useMemo(
    () => (storage ? new EcsPatchJournal(storage, { ...identity, instanceId }) : null),
    // identity 필드는 페이지 key(classId:week) 재마운트로만 바뀜 — 개별 필드 의존 명시
    [storage, identity.tenantId, identity.userId, identity.classId, identity.week, instanceId], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const [recoverable, setRecoverable] = useState<JournalRecord | null>(null);

  // 산 인스턴스 증명 — Web Lock 보유(해제는 언마운트) + BroadcastChannel ping 응답
  useEffect(() => {
    let release: (() => void) | null = null;
    if (typeof navigator !== "undefined" && navigator.locks?.request) {
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      void navigator.locks
        .request(`${ECS_JOURNAL_LOCK_PREFIX}${instanceId}`, () => held)
        .catch(() => {});
    }
    const bc = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(PING_CHANNEL);
    if (bc) {
      bc.onmessage = (e) => {
        const msg = e.data as { type?: string; instanceId?: string };
        if (msg?.type === "ping" && msg.instanceId === instanceId) {
          bc.postMessage({ type: "alive", instanceId });
        }
      };
    }
    return () => {
      release?.();
      bc?.close();
    };
  }, [instanceId]);

  // 죽은 저널 탐색(마운트 1회) — Web Locks 우선, 미지원 환경은 ping 폴백
  useEffect(() => {
    if (!storage) return;
    let alive = true;
    const isAlive = async (otherId: string): Promise<boolean> => {
      const viaLocks = await isInstanceAliveViaWebLocks(otherId);
      if (viaLocks !== null) return viaLocks;
      if (typeof BroadcastChannel === "undefined") return false;
      return new Promise<boolean>((resolve) => {
        const bc = new BroadcastChannel(PING_CHANNEL);
        const timer = setTimeout(() => {
          bc.close();
          resolve(false);
        }, PING_TIMEOUT_MS);
        bc.onmessage = (e) => {
          const msg = e.data as { type?: string; instanceId?: string };
          if (msg?.type === "alive" && msg.instanceId === otherId) {
            clearTimeout(timer);
            bc.close();
            resolve(true);
          }
        };
        bc.postMessage({ type: "ping", instanceId: otherId });
      });
    };
    void listRecoverableJournals(storage, { ...identity, instanceId }, isAlive).then((records) => {
      if (alive && records.length > 0) setRecoverable(records[0]);
    });
    return () => {
      alive = false;
    };
  }, [storage, identity.tenantId, identity.userId, identity.classId, identity.week, instanceId]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    journal,
    recoverable,
    claimRecoverable: async () => {
      if (!storage || !recoverable) return [];
      const muts = await claimJournal(storage, recoverable);
      setRecoverable(null);
      return muts;
    },
    dismissRecoverable: () => setRecoverable(null),
  };
}
