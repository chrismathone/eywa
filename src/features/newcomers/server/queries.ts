import "server-only";
import { cache } from "react";

import { createClient } from "@/lib/supabase/server";
import type { createAdminClient } from "@/lib/supabase/admin";
import { kstToday, diffDays } from "@/lib/date-kst";
import { fetchAllPaged } from "@/lib/supabase/batch";
import {
  NEWCOMER_WINDOW_DAYS,
  ONBOARDING_ITEMS,
  bucketOf,
  newcomerWindowStart,
  progressOf,
  type NewcomerBucket,
  type NewcomerProgress,
} from "../onboarding-items";
import { buildSubjectAnchors, collapseChecks, effectiveChecks, indexChecks } from "../subject-rows";
import { loadCheckRows, loadEnrollmentSubjects, type ScopeFn } from "./cohort";

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
  /**
   * 과목 키(학원설정 `subjects[].key`) — **학생 × 과목 한 줄**(원장 2026-09-10 *"여러 과목이면 과목별로
   * 행이 존재해야함"*). 수강이 없으면 null. 🔴 라벨은 화면이 학원설정으로 붙인다(raw 키 노출 금지).
   * 학생 한 줄로 접은 행(`NewcomersView.rows`)은 언제나 null이다.
   */
  subject: string | null;
  /** 표의 줄 키 — `학생id|과목`(접은 행은 학생 id). */
  rowKey: string;
  /**
   * **학생 한 줄로 접은 행에만** — 그 학생의 과목 행들. 운영실 칸 판정(`careCellMatches`)이 이것을 보고
   * "어느 과목이라도 걸리면 그 학생이 걸린다"로 센다.
   * 🔴 접은 체크 + 가장 이른 첫 수업일로 판정하면 **늦게 시작하는 과목의 콜이 기한 전에 '지연'**이 된다
   *    (첫 수업일을 앞 과목에서 빌려 쓰므로) — 그래서 판정은 언제나 과목 행으로 한다.
   */
  subjects?: NewcomerRow[];
  /** 종료되지 않은 수강 여부. 과목 미지정 수강도 포함한다. */
  hasCurrentEnrollment?: boolean;
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
  checkDetails?:Record<string,{memo:string|null;consultationId:string|null}>;
  progress: NewcomerProgress;
};

export type NewcomersView = {
  today: string;
  /**
   * **학생 한 줄**(과목을 접은 것) — 운영실·브리핑처럼 "N명"을 세는 자리가 쓴다. 🔴 `rows.length`는 학생 수다.
   * 체크는 **모든 과목이 끝나야 완료**로 접었고, 칸 판정은 `subjects`(과목 행)로 한다.
   */
  rows: NewcomerRow[];
  /** **학생 × 과목** — 신규생 관리 표(0256a). 수강이 없는 학생은 과목 null 한 줄. */
  subjectRows: NewcomerRow[];
  /** 과목별 체크를 저장할 수 있나(0256a 적용). false면 체크가 과목 무관으로 저장된다 — 화면이 밝힌다. */
  subjectChecks: boolean;
  /** 0251a가 적용돼 체크를 저장할 수 있나. false면 화면이 배너로 밝히고 체크를 잠근다. */
  checksAvailable: boolean;
  followupError?: string;
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

export const getNewcomers = cache(async (): Promise<NewcomersView> => loadNewcomers(await createClient(), kstToday()));

/**
 * 신규생 목록 본문 — 화면(`getNewcomers`, 로그인 사용자 · RLS)과 매일 기록(cron · 관리 키)이 같은 함수를 쓴다.
 * `tenantId`를 주면(관리 키) 모든 조회를 그 지점으로 좁힌다 — 관리 키는 RLS를 건너뛴다([[#104]]).
 */
export async function loadNewcomers(
  supabase: Awaited<ReturnType<typeof createClient>> | ReturnType<typeof createAdminClient>,
  today: string,
  tenantId?: string,
  includeStudentIds: string[] = [],
): Promise<NewcomersView> {
  const since = newcomerWindowStart(today);
  const included = includeStudentIds.filter(id => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id));
  const scope: ScopeFn = tenantId ? <T,>(q: T): T => (q as unknown as { eq(c: string, v: string): T }).eq("tenant_id", tenantId) : (q) => q;

  // 대상 = 등록일이 창 안인 재원생. ⚠️ 휴원(on_hold)도 남긴다 — 신입이 초반에 흔들려 쉬는 경우가 정확히
  //    이 탭이 봐야 하는 상황이다. 퇴원은 뺀다(관리 대상이 아니라 결과다).
  const students = await fetchAllPaged<{
    id: string;
    name: string;
    school: string | null;
    grade: string | null;
    enrolled_at: string | null;
  }>((from, to) => {
    let query = supabase.from("students").select("id, name, school, grade, enrolled_at").in("status", ["enrolled", "on_hold"]);
    query = included.length ? query.or(`enrolled_at.gte.${since},id.in.(${included.join(",")})`) : query.gte("enrolled_at", since);
    return scope(query).order("enrolled_at", { ascending: false }).order("id", { ascending: true }).range(from, to);
  });

  const ids = students.map((s) => s.id);
  if (ids.length === 0)
    return { today, rows: [], subjectRows: [], checksAvailable: true, checksError: null, subjectChecks: true };

  // 🔴 수강·체크는 서로 **독립**이다 — 줄지어 await하면 라운드트립이 합산된다(B4). 이 조회는 운영실
  //    한 화면에서도 도는 경로라(창마다 셸이 재실행된다) 한 왕복이 그대로 곱해진다.
  // 🔴 조회는 운영실 신호(`newcomerOverdueSignal`)와 **같은 함수**다([`cohort.ts`](./cohort.ts)) — 한쪽만 과목을
  //    알면 같은 학생을 두 화면이 다르게 말한다.
  const [enrollments, checksResult] = await Promise.all([
    loadEnrollmentSubjects(supabase, ids, scope),
    loadCheckRows(supabase, ids, scope),
  ]);
  // 🔴 `today`를 넘긴다 — 끝난 과목(그만둔 과목)은 줄을 세우지 않는다(아래 순수 함수 주석).
  const { bySubject, earliest } = buildSubjectAnchors(enrollments, today);
  const activeStudents = new Set(enrollments
    .filter((enrollment) => !ymd(enrollment.endDate) || ymd(enrollment.endDate)! > today)
    .map((enrollment) => enrollment.studentId));

  let checksAvailable = true;
  let checksError: NewcomersView["checksError"] = null;
  let subjectChecks = true;
  let checkIndex = indexChecks([]);
  if (checksResult.ok) {
    checkIndex = indexChecks(checksResult.rows);
    // 0256a 전이면 체크는 전부 과목 무관('')으로 읽혔다 — 그 사실을 화면이 밝히도록 올려 보낸다.
    subjectChecks = checksResult.subjectAware;
  } else {
    const e = checksResult.error;
    const raw = e instanceof Error ? e.message : String(e);
    checksAvailable = false;
    checksError = isMissingRelationText(raw)
      ? null // 표가 아직 없는 것은 '오류'가 아니라 미적용 상태다 — 화면이 다른 문구로 안내한다.
      : { summary: "체크 기록을 불러오지 못했습니다 — 화면의 체크는 비어 보일 수 있습니다", raw };
  }

  const itemKeys = ONBOARDING_ITEMS.map((item) => item.key);
  const rows: NewcomerRow[] = [];
  const subjectRows: NewcomerRow[] = [];
  for (const s of students) {
    const enrolledOn = ymd(s.enrolled_at);
    if (!enrolledOn) continue; // 등록일이 없으면 창을 셀 수 없다 — 대상이 아니다.
    const base = {
      studentId: s.id,
      hasCurrentEnrollment: activeStudents.has(s.id),
      name: s.name,
      school: s.school,
      grade: s.grade,
      enrolledOn,
      elapsedDays: diffDays(enrolledOn, today),
      bucket: bucketOf(enrolledOn, today),
    };
    const subjMap = bySubject.get(s.id);
    // 과목 순서는 키 순으로 고정한다 — 서버 렌더와 클라 첫 렌더가 같은 줄 순서를 그려야 한다.
    const subjects = subjMap ? [...subjMap.keys()].sort() : [];

    // ① 과목 행 — 과목마다 **제 첫 수업일·제 체크**. 수강이 없으면 과목 null 한 줄(반 배정 전 신입이
    //    가장 챙길 대상이라 사라지면 안 된다).
    const perSubject: NewcomerRow[] = (subjects.length > 0 ? subjects : [null]).map((subject) => {
      const firstClassOn = subject ? (subjMap?.get(subject) ?? null) : (earliest.get(s.id) ?? null);
      const checks = effectiveChecks(checkIndex, s.id, subject);
      return {
        ...base,
        subject,
        rowKey: `${s.id}|${subject ?? ""}`,
        firstClassOn,
        checks,
        checkDetails:Object.fromEntries((checksResult.ok?checksResult.rows:[]).filter(r=>r.studentId===s.id&&(!(r.subject??"")||r.subject===subject)).sort((a,b)=>Number(!!a.subject)-Number(!!b.subject)).map(r=>[r.itemKey,{memo:r.memo??null,consultationId:r.consultationId??null}])),
        progress: progressOf({ enrolledOn, firstClassOn }, checks, today, ONBOARDING_ITEMS),
      };
    });
    subjectRows.push(...perSubject);

    // ② 학생 한 줄 — 옛 모양 그대로(가장 이른 첫 수업일). 체크는 **모든 과목이 끝나야 완료**로 접는다.
    //    칸 판정은 `subjects`(과목 행)가 한다 — 과목이 없으면 이 줄 자체가 과목 행과 같다.
    const firstClassOn = earliest.get(s.id) ?? null;
    const checks = collapseChecks(checkIndex, s.id, subjects, itemKeys);
    rows.push({
      ...base,
      subject: null,
      rowKey: s.id,
      firstClassOn,
      checks,
      progress: progressOf({ enrolledOn, firstClassOn }, checks, today, ONBOARDING_ITEMS),
      ...(subjects.length > 0 ? { subjects: perSubject } : {}),
    });
  }

  return { today, rows, subjectRows, checksAvailable, checksError, subjectChecks };
}
