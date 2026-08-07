import "server-only";
import { cache } from "react";
import { unstable_cache } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/current-user";
import { resolvePeriodWindow, type PeriodDef, type PeriodWindow } from "../resolve";

/** 세션 기간 캐시 무효화 태그(tenantId별). 저장 액션이 updateTag로 비운다. */
export function periodsTag(tenantId: string): string {
  return `operating-periods:${tenantId}`;
}

type Row = {
  id: string;
  subject_key: string;
  class_id: string | null;
  label_year: number;
  label_month: number;
  start_date: string;
  end_date: string;
};

const toDef = (r: Row): PeriodDef => ({
  id: r.id,
  subjectKey: r.subject_key,
  classId: r.class_id,
  labelYear: r.label_year,
  labelMonth: r.label_month,
  startDate: r.start_date,
  endDate: r.end_date,
});

/**
 * 한 해치 세션 정의를 tenantId×year로 캐싱. 창(iframe)마다 셸이 재실행되는 멀티윈도우에서
 * 창 N개 = 조회 N배가 되는 것을 막는다(B6). 캐시 안엔 쿠키 없이 admin client + 신뢰 tenantId.
 *
 * 🔴 **에러를 삼켜 `[]`를 돌린다 — eywa에서 이 삼킴을 허용하는 유일한 자리다.**
 *    이유: SQL 적용과 앱 배포 사이엔 항상 간격이 있고(#95), 표가 아직 없으면 PostgREST가 400/404를
 *    낸다. 그대로 throw하면 출석부가 통째로 죽는다(2026-08-03 강사 전원 원스크린 먹통과 같은 조건).
 *    빈 배열 = "세션 정의 없음" = 달력월 폴백이므로 **화면은 이식 전과 100% 동일하게 동작**한다.
 *    대신 조용히 넘기지 않는다: console.warn + 화면은 항상 현재 기준을 라벨로 노출한다
 *    (구 출석부는 이 삼킴이 무음이라 일시적 조회 실패가 곧 집계 기준 변경이었다).
 *
 * ⚠️ operating_periods는 RLS 정책 0개(service_role 전용, 0189a)라 **tenant 필터는 코드가 건다.**
 *    이 함수가 유일한 읽기 진입점 — 다른 곳에서 admin으로 직접 select 하지 말 것.
 */
const loadPeriodDefsCached = (tenantId: string, year: number) =>
  unstable_cache(
    async (): Promise<PeriodDef[]> => {
      try {
        const admin = createAdminClient();
        const { data, error } = await admin
          .from("operating_periods")
          .select("id, subject_key, class_id, label_year, label_month, start_date, end_date")
          .eq("tenant_id", tenantId)
          .eq("label_year", year)
          .order("subject_key", { ascending: true })
          .order("label_month", { ascending: true });
        if (error) {
          console.warn("[periods] 세션 정의 조회 실패 — 달력월로 폴백합니다", error.message);
          return [];
        }
        return (data ?? []).map((r) => toDef(r as Row));
      } catch (e) {
        console.warn("[periods] 세션 정의 조회 예외 — 달력월로 폴백합니다", e);
        return [];
      }
    },
    ["operating-periods", tenantId, String(year)],
    { tags: [periodsTag(tenantId)], revalidate: 300 },
  )();

/** 현재 테넌트의 해당 연도 세션 정의. 요청 내 중복 제거(React cache). */
export const getPeriodDefs = cache(async (year: number): Promise<PeriodDef[]> => {
  const user = await getCurrentUser();
  if (!user) return [];
  return loadPeriodDefsCached(user.tenantId, year);
});

/**
 * 라벨월 하나를 창으로 해석 — 서버 컴포넌트가 한 줄로 쓰는 진입점.
 *
 * ⚠️ 세션이 라벨월을 넘길 수 있으므로(2월 세션이 3월 초까지) **인접 연도까지 후보에 넣는다.**
 *    12월 세션이 다음 해 1월까지 가는 경우, 그 세션 행은 label_year=올해에 있다.
 */
export async function getPeriodWindow(args: {
  period: string; // "YYYY-MM"
  subjectKey?: string | null;
  classId?: string | null;
  mode?: "session" | "month";
  todayIso?: string;
}): Promise<PeriodWindow> {
  const year = Number(args.period.slice(0, 4));
  const defs = Number.isFinite(year) ? await getPeriodDefs(year) : [];
  return resolvePeriodWindow({ ...args, defs });
}

/** 여러 해에 걸친 조회(연말·연초 화면). 독립 조회라 병렬(B4). */
export async function getPeriodDefsForYears(years: readonly number[]): Promise<PeriodDef[]> {
  const uniq = [...new Set(years)].filter((y) => Number.isFinite(y));
  const all = await Promise.all(uniq.map((y) => getPeriodDefs(y)));
  return all.flat();
}

/** 편집 화면용 — 로그인 사용자의 테넌트에서 그 해 전체(빈 해도 빈 배열). */
export async function getPeriodDefsForEditor(year: number): Promise<PeriodDef[]> {
  return getPeriodDefs(year);
}
