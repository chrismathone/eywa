import "server-only";
import { cache } from "react";

import { createClient } from "@/lib/supabase/server";
import { kstToday } from "@/lib/date-kst";
import { fetchAllPaged, fetchInChunks } from "@/lib/supabase/batch";
import {
  NEWCOMER_WINDOW_DAYS,
  ONBOARDING_ITEMS,
  bucketOf,
  newcomerWindowStart,
  progressOf,
  type NewcomerBucket,
  type NewcomerProgress,
} from "../onboarding-items";

export { NEWCOMER_WINDOW_DAYS };

/**
 * 신규생 관리 목록 — 원장 2026-09-09: *"신입 등록부터 3개월까지 7일, 30일, 60일, 90일 까지 관리하는거야.
 * 각종 지표를 바로 확인하게해서 신입생이 잘 관리되고 있는가 체크하게 하는것."*
 *
 * 🔴 **기준일이 둘이다**([`onboarding-items.ts`](../onboarding-items.ts) 참조): 창(7·30·60·90일)은 등록일에서,
 *    사전 콜·첫 수업 안내·첫 수업 후 콜은 **첫 수업일**에서 센다. 실측(2026-09-09, 대상 30명): 등록일과 첫
 *    수업일 간격이 **0~56일**이다(박인유 07-06 등록 · 09-01 첫 수업). 등록일 하나로 재촉하면 **수업도 하기
 *    전에 "첫 수업 후 콜 지연"** 이 뜬다.
 * 🔴 첫 수업일 = `min(enrollments.start_date)`(수강 시작일) — 출결 기록으로 잡으면 **이미 지난 뒤에야** 알게 돼
 *    사전 콜 기한을 미리 띄울 수 없다. 수강이 아직 없는 학생(반 배정 전)은 null이고, 그 항목들은 기한 없음
 *    (`pending`)이라 지연으로 세지 않는다 — 모르는 것을 지연으로 세지 않는다.
 * ⚠️ 0251a 미적용이어도 **목록은 그대로 뜬다**([[#95]]) — 체크가 전부 빈 상태로 보이고 저장만 잠긴다.
 *    표가 없는 것과 조회가 실패한 것은 다른 사실이라 `checksAvailable`로 갈라 화면이 한글로 밝힌다.
 */

export type NewcomerRow = {
  studentId: string;
  name: string;
  school: string | null;
  grade: string | null;
  /** 등록일(YYYY-MM-DD). */
  enrolledOn: string;
  /** 첫 수업일 — 수강이 없으면 null. */
  firstClassOn: string | null;
  /** 등록 후 경과일. */
  elapsedDays: number;
  bucket: NewcomerBucket;
  /** 항목 키 → 완료일(YYYY-MM-DD). 없으면 미완료. */
  checks: Record<string, string | null>;
  progress: NewcomerProgress;
};

export type NewcomersView = {
  today: string;
  rows: NewcomerRow[];
  /** 0251a가 적용돼 체크를 저장할 수 있나. false면 화면이 배너로 밝히고 체크를 잠근다. */
  checksAvailable: boolean;
  /** 체크 조회가 표 부재가 아닌 이유로 실패했을 때의 한글 사유(원문은 툴팁). */
  checksError: { summary: string; raw: string } | null;
};

function isMissingRelationText(msg: string): boolean {
  return /PGRST205|PGRST20[12]|42P01|does not exist|Could not find the table/i.test(msg);
}

function ymd(value: unknown): string | null {
  if (!value) return null;
  const s = String(value);
  return s.length >= 10 ? s.slice(0, 10) : null;
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export const getNewcomers = cache(async (): Promise<NewcomersView> => {
  const supabase = await createClient();
  const today = kstToday();
  const since = newcomerWindowStart(today);

  // 대상 = 등록일이 창 안인 재원생. ⚠️ 휴원(on_hold)도 남긴다 — 신입이 초반에 흔들려 쉬는 경우가 정확히
  //    이 탭이 봐야 하는 상황이다. 퇴원은 뺀다(관리 대상이 아니라 결과다).
  const students = await fetchAllPaged<{
    id: string;
    name: string;
    school: string | null;
    grade: string | null;
    enrolled_at: string | null;
  }>((from, to) =>
    supabase
      .from("students")
      .select("id, name, school, grade, enrolled_at")
      .in("status", ["enrolled", "on_hold"])
      .gte("enrolled_at", since)
      .order("enrolled_at", { ascending: false })
      .order("id", { ascending: true })
      .range(from, to),
  );
  const ids = students.map((s) => s.id);
  if (ids.length === 0) return { today, rows: [], checksAvailable: true, checksError: null };

  // 첫 수업일 = 가장 이른 수강 시작일. 학생별 최솟값이라 전건이 필요하다(청크 + 페이지네이션, B2/B3).
  const enrollments = await fetchInChunks<{ student_id: string; start_date: string | null }>(ids, (chunk) =>
    supabase.from("enrollments").select("student_id, start_date").in("student_id", chunk),
  );
  const firstClassBy = new Map<string, string>();
  for (const e of enrollments) {
    const d = ymd(e.start_date);
    if (!d) continue;
    const prev = firstClassBy.get(e.student_id);
    if (!prev || d < prev) firstClassBy.set(e.student_id, d);
  }

  // 체크 — 0251a 미적용이면 표가 없다. 그때도 화면은 살고(빈 체크) 저장만 잠긴다([[#95]]).
  let checksAvailable = true;
  let checksError: NewcomersView["checksError"] = null;
  const checkBy = new Map<string, Record<string, string | null>>();
  try {
    const checks = await fetchInChunks<{ student_id: string; item_key: string; done_on: string | null }>(
      ids,
      (chunk) => supabase.from("student_onboarding_checks").select("student_id, item_key, done_on").in("student_id", chunk),
    );
    for (const c of checks) {
      const bucket = checkBy.get(c.student_id) ?? {};
      bucket[c.item_key] = ymd(c.done_on);
      checkBy.set(c.student_id, bucket);
    }
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e);
    checksAvailable = false;
    checksError = isMissingRelationText(raw)
      ? null // 표가 아직 없는 것은 '오류'가 아니라 미적용 상태다 — 화면이 다른 문구로 안내한다.
      : { summary: "체크 기록을 불러오지 못했습니다 — 화면의 체크는 비어 보일 수 있습니다", raw };
  }

  const rows: NewcomerRow[] = students
    .map((s) => {
      const enrolledOn = ymd(s.enrolled_at);
      if (!enrolledOn) return null; // 등록일이 없으면 창을 셀 수 없다 — 대상이 아니다.
      const firstClassOn = firstClassBy.get(s.id) ?? null;
      const checks = checkBy.get(s.id) ?? {};
      return {
        studentId: s.id,
        name: s.name,
        school: s.school,
        grade: s.grade,
        enrolledOn,
        firstClassOn,
        elapsedDays: daysBetween(enrolledOn, today),
        bucket: bucketOf(enrolledOn, today),
        checks,
        progress: progressOf({ enrolledOn, firstClassOn }, checks, today, ONBOARDING_ITEMS),
      };
    })
    .filter((r): r is NewcomerRow => r !== null);

  return { today, rows, checksAvailable, checksError };
});
