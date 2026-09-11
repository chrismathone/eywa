"use client";

/**
 * 원스크린 영어 행의 인재원 하루치 — 화면 메모리 캐시(2026-09-11).
 *
 * 🔑 부르는 때: 카드에서 영어 행을 열 때 · 자동작성 · 다시 채우기 · 저장·발송·글 복사 직전(그림 칸 템플릿 글일 때).
 *    첫 화면에서 전원을 부르지 않는다. 받는 중인 요청은 합친다.
 * 🔴 **신선도** — 받은 지 `JJ_FRESH_MS`가 지나면 다시 받는다. 자동작성·다시 채우기는 **항상 새로**(force) 받는다:
 *    카드를 수업 전에 열어 둔 채 수업 중 본 시험이 '0건'으로 굳어 결과지가 빠졌다(적대 리뷰 2026-09-11).
 * 🔑 상태는 두 벌이다 — 화면(렌더)은 `cache`·`pending`(state), 비동기 경로(일괄 작성·저장 직전 재조립)는 `cacheRef`를
 *    읽는다(렌더 중 ref 읽기 금지 규약, 옆의 reportsRef와 같은 이유). 둘은 받은 순간 **같이** 갱신된다.
 * ⚠️ 실패는 캐시에 남기되 '모름'으로 친다(jj-day `jjKnownSlots`). 🔴 실패도 `JJ_ERROR_FRESH_MS`(1분) 동안은 다시 부르지
 *    않는다 — 인재원이 멈추면 저장·발송마다 화면이 8초, 서버가 또 8초를 기다렸다(적대 재리뷰). '다시 불러오기'(force)는 즉시.
 */
import { useCallback, useRef, useState } from "react";
import { jjDayKey, type JjDayCache, type JjDayState } from "../jj-day";
import { loadEnglishJjDay } from "../server/jj-day-actions";

/** 서버가 답하지 못했을 때(네트워크 등)의 원인 — 화면은 번역된 안내를 쓰고 이것은 툴팁으로만 보인다. */
const UNREACHABLE = "인재원 자료 요청에 실패했습니다";

/** 받아 둔 하루치를 믿는 시간 — 지나면 카드를 다시 열 때·저장 직전에 새로 받는다. */
export const JJ_FRESH_MS = 3 * 60_000;
/** 실패를 믿는 시간 — 그동안은 저장마다 다시 부르지 않는다(모르는 그림 칸은 어차피 중립이라 글이 안 바뀐다). */
export const JJ_ERROR_FRESH_MS = 60_000;
/**
 * 멈춘 동안 자동 호출 대신 돌려주는 상태 — 화면은 번역된 '못 불러옴'과 '다시 불러오기'를 보여 준다.
 * 멈춤은 서버가 **인재원에 닿지 못했다**(`unreachable`)고 답했을 때만 건다 — 걸린 시간으로 판정하면 앞선 서버 액션
 * (AI·저장)을 기다린 시간까지 세어 권한 거절 같은 다른 실패로도 1분을 멈췄다(적대 재리뷰 2026-09-11).
 */
const PAUSED = "인재원 서버가 응답하지 않아 잠시 부르지 않습니다";

/**
 * `force` = 받아 둔 값을 무시하고 새로 받는다(자동작성·다시 채우기·저장 직전). `manual` = 사람이 '다시 불러오기'를
 * 눌렀다 — 멈춤 차단기도 무시한다. 🔴 차단기는 학생마다가 아니라 **화면 전체**다 — 학생마다 1분이면 일괄 저장·발송이
 * 15명 × 8초를 그대로 기다린다(적대 재리뷰 2026-09-11).
 */
export type JjEnsureOpts = { outOfClass?: boolean; force?: boolean; manual?: boolean };

export function useEnglishJj(date: string) {
  const [cache, setCache] = useState<JjDayCache>({});
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set());
  const cacheRef = useRef<JjDayCache>({});
  const stampRef = useRef(new Map<string, number>());
  const inflight = useRef(new Map<string, Promise<JjDayState>>());
  /** 이 시각까지는 자동 호출을 하지 않는다(인재원에 닿지 못한 뒤 1분). */
  const pausedUntilRef = useRef(0);
  /** 마지막으로 받은(ok) 시각 — 그보다 먼저 시작한 요청이 늦게 실패해도 멈춤을 다시 걸지 않는다. */
  const lastOkAtRef = useRef(0);

  const ensure = useCallback(
    (studentId: string, opts?: JjEnsureOpts): Promise<JjDayState> => {
      const key = jjDayKey(studentId, date);
      // 받는 중이면 그걸 기다린다(방금 시작한 요청이라 force여도 충분히 새것이다).
      const running = inflight.current.get(key);
      if (running) return running;
      const have = cacheRef.current[key];
      const window = have?.status === "error" ? JJ_ERROR_FRESH_MS : JJ_FRESH_MS;
      const fresh = Date.now() - (stampRef.current.get(key) ?? 0) < window;
      if (have && fresh && !opts?.force) return Promise.resolve(have);
      if (!opts?.manual && Date.now() < pausedUntilRef.current) {
        // 인재원이 막 멈춘 것으로 보인다 — 받아 둔 값이 신선하거나 force가 아니면 그대로, 아니면 '못 불러옴'(= 모름)으로
        // 둔다(패널에 '다시 불러오기'). 🔴 force인데 옛 값을 돌려주면 수업 전에 받은 '시험 0건'으로 결과지 줄이 빠진다 —
        // '모름'은 그림 칸을 기준 글 그대로 둔다(적대 재리뷰 2026-09-11).
        if (have && (fresh || !opts?.force)) return Promise.resolve(have);
        const paused: JjDayState = { status: "error", message: PAUSED };
        cacheRef.current = { ...cacheRef.current, [key]: paused };
        // 받은 시각을 남기지 않는다 — 남기면 멈춤이 끝난 뒤에도 이 자리가 1분 더 '실패'로 버틴다(적대 재리뷰).
        stampRef.current.delete(key);
        setCache(cacheRef.current);
        return Promise.resolve(paused);
      }
      setPending((prev) => new Set(prev).add(key));
      const job = (async (): Promise<JjDayState> => {
        const startedAt = Date.now();
        let next: JjDayState;
        try {
          next = await loadEnglishJjDay({ studentId, date, outOfClass: opts?.outOfClass });
        } catch {
          next = { status: "error", message: UNREACHABLE };
        }
        // 인재원에 닿지 못했을 때만 멈추고, 한 번이라도 받으면(다시 불러오기 포함) 곧바로 푼다. 마지막 성공보다 **먼저
        // 시작한** 요청이 늦게 실패한 것은 멈춤을 다시 걸지 않는다(회복 중에 늦게 온 시간 초과, 적대 재리뷰).
        if (next.status === "ok") {
          pausedUntilRef.current = 0;
          lastOkAtRef.current = Date.now();
        } else if (next.status === "error" && next.unreachable && startedAt >= lastOkAtRef.current) {
          pausedUntilRef.current = Date.now() + JJ_ERROR_FRESH_MS;
        }
        cacheRef.current = { ...cacheRef.current, [key]: next };
        stampRef.current.set(key, Date.now());
        setCache(cacheRef.current);
        return next;
      })().finally(() => {
        inflight.current.delete(key);
        setPending((prev) => {
          const rest = new Set(prev);
          rest.delete(key);
          return rest;
        });
      });
      inflight.current.set(key, job);
      return job;
    },
    [date],
  );

  return { cache, cacheRef, pending, ensure, date };
}
