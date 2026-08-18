// 수업보고서 발송용 이름(0217a users.report_display_name) — **서버 조회** 헬퍼.
// 판정 규칙(동명 직원 모호 시 미적용)은 ../report-author-name.ts 순수 함수 단일 소스.
//
// 🔴 전부 fail-soft다: 이 조회가 실패하면(0217a 미적용 42703·일시 오류) **원래 이름으로 폴백**하고
//    페이지는 절대 죽지 않는다 — 소비처가 학부모 공개 링크(/r)·인쇄·원스크린(전원 매일 핫패스)이라
//    "이름 한 줄"이 화면 생존보다 우선일 수 없다(#95 expand/contract, mentSourceColumnReady와 같은 결).
//    단 컬럼 부재가 아닌 일시 오류는 warn으로 드러낸다([[#89]] 폴백 있는 기능은 실패율 계측).
import { createAdminClient } from "@/lib/supabase/admin";
import { pickReportAuthorName } from "../report-author-name";

/** 0217a 미적용(컬럼 부재) 판별 — PostgREST 42703 문구. */
function isColumnMissing(message: string): boolean {
  return /report_display_name/.test(message) && /(does not exist|42703|column)/i.test(message);
}

function warnTransient(scope: string, message: string): void {
  if (isColumnMissing(message)) return; // 미적용은 정상 경로(조용히 폴백)
  console.warn(JSON.stringify({ level: "warn", scope, reason: "probe_failed_transient", message }));
}

/**
 * 보고서에 저장된 강사 표시 이름(`lesson_reports.teacher_name`) → 발송용 이름. 없으면 null(원래 이름).
 * admin(service_role)은 RLS 우회라 **tenantId 명시 필터 필수** — 호출부가 신뢰 가능한 tenantId를 넘긴다
 * (/r은 행의 tenant_id, 인쇄·원스크린은 세션 user.tenantId).
 */
export async function resolveReportAuthorName(
  tenantId: string,
  teacherName: string | null | undefined,
): Promise<string | null> {
  // 🔴 raw 정확 일치(순수 함수 규칙과 동일) — trim해서 eq에 넣으면 워커(JS raw 매칭)와 답이 갈린다.
  const name = teacherName ?? "";
  if (!name.trim()) return null;
  try {
    const admin = createAdminClient();
    // 같은 표시 이름의 직원 **전부**(override 유무 무관) — 2명이면 모호라 매핑하지 않는다(순수 함수 규칙).
    // 학생 계정은 제외(직원 풀 규약 `.neq(system_role,'student')` — staff/approvals 조회와 동일):
    // 동명 학생이 강사의 발송용 이름을 조용히 꺼 버리면 안 된다(적대 리뷰 2026-08-18). 퇴사자는 남긴다
    // (퇴사 강사의 옛 공유 링크도 그 사람 이름 규칙을 유지). ⚠️ 워커 복제본과 반드시 같은 필터일 것.
    const { data, error } = await admin
      .from("users")
      .select("display_name, report_display_name")
      .eq("tenant_id", tenantId)
      .eq("display_name", name)
      .neq("system_role", "student")
      .limit(2);
    if (error) {
      warnTransient("resolveReportAuthorName", error.message);
      return null;
    }
    return pickReportAuthorName(
      name,
      (data ?? []).map((r) => ({
        displayName: r.display_name as string | null,
        reportDisplayName: r.report_display_name as string | null,
      })),
    );
  } catch (e) {
    warnTransient("resolveReportAuthorName", e instanceof Error ? e.message : String(e));
    return null;
  }
}

/** 본인(user id)의 발송용 이름 — /me 입력칸 프리필. 실패·미적용 = null(빈 칸). */
export async function fetchMyReportDisplayName(userId: string): Promise<string | null> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("users")
      .select("report_display_name")
      .eq("id", userId)
      .maybeSingle();
    if (error) {
      warnTransient("fetchMyReportDisplayName", error.message);
      return null;
    }
    const v = ((data?.report_display_name as string | null) ?? "").trim();
    return v || null;
  } catch (e) {
    warnTransient("fetchMyReportDisplayName", e instanceof Error ? e.message : String(e));
    return null;
  }
}
