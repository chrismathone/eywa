import "server-only";
import { foldedReason } from "@/lib/folded-read";
import { AsyncLocalStorage } from "node:async_hooks";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TenantSettings } from "@/features/owner/settings-types";
import { createClient } from "@/lib/supabase/server";

/**
 * **로그인 없이 출석부를 조립하는 실행 문맥** — 밤 집계(강사평가 '매출 대비 급여')가 출석부 합계 행의 청구액·실급여를
 * 화면과 **같은 함수**로 내기 위한 길(원장 2026-10-13 *"출석부 하단에 합계 있을텐데"* · *"청구액 그대로"*).
 *
 * 🔑 화면 경로는 이 문맥이 없어 한 글자도 달라지지 않는다 — 출석부 조립 사슬의 바닥 함수들(로그인 클라이언트·강사 보기·
 *    학원 설정·권한 확인·담임 이력)만 `attendanceReadContext()`를 보고, 문맥이 있으면 아래 값을 쓴다.
 *    `"use server"` 액션이 아니라 **서버 코드만 들어갈 수 있는** 실행 문맥이라(반 보드 자동 동기화와 같은 방식) 사용자가 꾸며 넣을 수 없다.
 * 🔴 `db`는 관리(service_role) 클라이언트다 — RLS를 우회하므로 **반·학생 id로 좁히지 않는 조회는 반드시 `scopeTenant`**
 *    (#104). id로 좁히는 조회는 그 id가 이 지점 것이라 그대로 둔다.
 * 🔴 요청 캐시(React `cache`)를 쓰는 함수는 캐시 키에 지점을 넣는다(`readContextKey`) — 밤 집계가 한 요청에서
 *    여러 지점을 돌 때 앞 지점의 반 목록을 다음 지점이 받지 않게.
 * ⚠️ 학원 설정은 못 읽으면 문맥을 만들지 않는다(기본값으로 접힌 설정으로 금액을 내지 않는다 — 출석부 조립의 ⑥과 같은 결).
 */
export type AttendanceReadContext = {
  tenantId: string;
  db: SupabaseClient;
  settings: TenantSettings;
  /**
   * 한 실행 안의 메모 — 🔴 React `cache`는 화면 렌더 밖(밤 집계 route·서버 액션·after)에선 **아무것도 기억하지 않는다**.
   * 그대로 두면 반마다 부르는 출석부 표가 반 목록·교시 배선·담임 이력을 매번 처음부터 읽는다(강사 × 반 수만큼 — 적대적 리뷰 2026-10-13).
   * 문맥 하나 = 지점 하나라 지점을 넘나들지 않는다. `runWithAttendanceReadContext`가 비어 있으면 새로 만든다.
   */
  memo?: Map<string, Promise<unknown>>;
};

const store = new AsyncLocalStorage<AttendanceReadContext>();

export function runWithAttendanceReadContext<T>(ctx: AttendanceReadContext, fn: () => Promise<T>): Promise<T> {
  return store.run({ ...ctx, memo: ctx.memo ?? new Map() }, fn);
}

/** 접힌 표식(`markFolded`)이 붙은 결과 — 조회가 일부 실패해 빈 값으로 접은 것이다. */
const notFolded = (value: unknown) => !(value && typeof value === "object" && foldedReason(value));

/**
 * 문맥 안에서는 같은 열쇠를 한 번만 읽는다(동시에 기다리던 호출은 결과·실패를 함께 받는다). 문맥이 없으면(화면) 그냥 부른다 — 화면은 React `cache`가 맡는다.
 * `keep` — 이 결과를 기억해도 되는가(기본 = 접힌 결과가 아님). 담임 이력처럼 접힘을 제 칸(`incomplete`)으로 알리는 결과는 호출부가 준다.
 */
export function memoInReadContext<T>(key: string, load: () => Promise<T>, keep: (value: T) => boolean = notFolded): Promise<T> {
  const memo = store.getStore()?.memo;
  if (!memo) return load();
  const hit = memo.get(key) as Promise<T> | undefined;
  if (hit) return hit;
  const next = load();
  memo.set(key, next);
  // 실패·접힌 결과는 기억하지 않는다 — 일시 오류 한 번이 그 실행의 다른 출석부로 번지지 않게(다음 호출이 다시 읽는다, 종전처럼).
  const forget = () => { if (memo.get(key) === next) memo.delete(key); };
  next.then((value) => { if (!keep(value)) forget(); }, forget);
  return next;
}

export const attendanceReadContext = (): AttendanceReadContext | null => store.getStore() ?? null;

/** 캐시 키에 붙일 지점 표식 — 문맥이 없으면(화면) 빈 글자. */
export const readContextKey = (): string => store.getStore()?.tenantId ?? "";

/** 조립 사슬의 DB 클라이언트 — 문맥이 있으면 관리 클라이언트, 없으면 종전 그대로 로그인 클라이언트. */
export async function attendanceDb(): Promise<{ db: SupabaseClient; tenantId: string | null }> {
  const ctx = store.getStore();
  return ctx ? { db: ctx.db, tenantId: ctx.tenantId } : { db: (await createClient()) as unknown as SupabaseClient, tenantId: null };
}

/** 넓은 조회(반·학생 id로 좁히지 않는 것)에 지점 조건 — 문맥이 없으면 손대지 않는다(RLS가 이미 지점으로 거른다). */
export function scopeTenant<Q>(query: Q, tenantId: string | null): Q {
  // 제약을 걸지 않는다 — PostgREST 빌더 타입에 제약을 걸면 타입 계산이 끝없이 깊어진다(TS2589).
  return tenantId ? (query as unknown as { eq(column: string, value: string): Q }).eq("tenant_id", tenantId) : query;
}
