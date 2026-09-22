"use client";

import { useEffect, useRef } from "react";
import { QUEUE_POLL_MS } from "@/features/report-admin/classnote-queue";
import { getClassnoteStatuses } from "../server/status-actions";
import type { ClassnoteStatusRow } from "../classnote-status";

/** 아무 변화 없이 이 시간이 지나면 감시를 멈춘다 — 화면을 켜둔 채 밤새 조회하지 않기 위해. */
const MAX_IDLE_MS = 10 * 60_000;

/**
 * 발송·회수 대기 또는 처리 중인 학생의 ClassNote 상태를 다시 읽어 완료·실패를 화면에 반영한다.
 * 주기는 관리자 발송 큐 카드와 같은 `QUEUE_POLL_MS`다.
 *
 * - 대기 중인 학생이 없으면(빈 목록) **아예 안 돈다**. 다 끝나면 목록이 비어 저절로 멈춘다.
 * - 백그라운드 탭은 건너뛰고, 돌아오면 즉시 1회. **안 보던 시간은 '무변화' 시간으로 세지 않는다**
 *   (가려 둔 20분 때문에 돌아오자마자 감시가 죽어 있으면, 정작 발송이 끝났는지 확인을 못 한다).
 * - 상태가 실제로 달라졌을 때만 콜백을 부른다 — 같은 값으로 리렌더를 유발하지 않게.
 */
export function useClassnoteStatusSync(
  date: string,
  pendingStudentIds: string[],
  onRows: (rows: ClassnoteStatusRow[]) => void,
) {
  // 콜백은 매 렌더 새로 만들어지므로 ref로 미러(이펙트가 매번 재시작하면 주기가 초기화된다).
  // ⚠️ ref 쓰기는 render 중이 아니라 effect에서(react-hooks/refs) — 이 파일 밖 onescreen-client와 같은 규칙.
  const cbRef = useRef(onRows);
  useEffect(() => {
    cbRef.current = onRows;
  });

  // 배열은 매 렌더 새 참조라 그대로 deps에 넣으면 이펙트가 계속 재시작한다 → 안정 문자열 키로.
  const key = [...pendingStudentIds].sort().join(",");

  useEffect(() => {
    if (!key) return;
    const ids = key.split(",");
    let cancelled = false;
    let inFlight = false;
    let timer = 0;
    let quietSince = Date.now();
    let hiddenAt = 0;
    let lastSignature = "";

    const tick = async () => {
      if (inFlight || document.visibilityState === "hidden") return;
      if (Date.now() - quietSince > MAX_IDLE_MS) {
        window.clearInterval(timer);
        return;
      }
      inFlight = true;
      const rows = await getClassnoteStatuses(date, ids).catch(() => null);
      inFlight = false;
      if (cancelled || !rows) return; // 실패는 조용히 다음 주기에 재시도(배지는 직전 값 유지)
      const signature = rows
        .map((r) => `${r.studentId}:${r.subject}:${r.status}`)
        .sort()
        .join("|");
      if (signature === lastSignature) return;
      lastSignature = signature;
      quietSince = Date.now();
      cbRef.current(rows);
    };

    const onVisible = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
        return;
      }
      if (hiddenAt) {
        quietSince += Date.now() - hiddenAt; // 안 보던 시간만큼 시계를 뒤로 민다
        hiddenAt = 0;
      }
      void tick();
    };

    timer = window.setInterval(() => void tick(), QUEUE_POLL_MS);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [key, date]);
}
