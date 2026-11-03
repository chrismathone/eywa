import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { WITHDRAWAL_REASONS } from "./types";

import { migrationFiles, readMigration } from "@/lib/db/migrations-corpus.mjs";
/**
 * **퇴원은 퇴원보고서로만** 배선 가드 — 원장 2026-10-23 *"퇴원한 학생의 퇴원보고서를 새로 써야하는 경우는 앞으로 없도록. 퇴원 보고서를 써야
 * 퇴원처리가 가능하도록."* 직원이 학생을 퇴원시키는 길은 퇴원보고서(강사 작성 요청 → 승인, 또는 관리자 바로 처리)의 DB 처리 함수 하나다.
 *
 * 🔴 아래 '그대로 두는 길' 밖에서 학생 상태를 퇴원으로 쓰거나(`status: "withdrawn"`) 퇴원일을 값으로 쓰는(`withdrawn_at: 값` — 퇴원·퇴원 예약)
 *    코드가 생기면 실패한다. 이 목록을 늘리려면 그 길이 왜 보고서를 안 지나도 되는지 [`via-report.ts`](./via-report.ts) 머리 주석과
 *    `docs/decisions/withdrawal-reports.md`에 먼저 적을 것. 같은 파일 안에서 하나 더 늘어도 실패한다(건수를 잠근다).
 * ⚠️ 한계(알고 둔다): 변수로 상태를 쓰는 저장(학생 등록·수정 폼 — 그 두 곳은 판정 함수를 부르는지 따로 본다) · 따옴표 키(`"withdrawn_at": x`) ·
 *    SQL 템플릿 안의 쓰기 · RPC · 수강 `end_date` 쓰기
 *    (반 폐지·종강·시트/엑셀 가져오기 등 시스템 종료는 학생을 퇴원시키지 않는다 — 수업 없는 재원생은 퇴원보고서로만 퇴원한다)는 글자로 못 잡는다.
 *    DB 트리거로 **막지는** 않는다(워커·동기화·cron이 조용히 깨질 위험 #95). 대신 보고서를 안 거친 퇴원·새 퇴원 예약은 DB가 **경고**한다 —
 *    원장 2026-10-23 *"개발자 도구는 어쩔 수 없지. 대신 경고할 수 있게"* → 0454a 지연 트리거(그 지점 원장 벨 알림 + 감사로그, 쓰기는 그대로 커밋).
 *    트리거가 빼는 길도 이 목록과 같다(보고서 처리 · 옛 예약 당일 처리 · 병합 · 옛 기록/데모 INSERT). 운영자 스크립트(`scripts/`)는 대상이 아니다.
 */
const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) sources(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(relative(ROOT, p).split(sep).join("/"));
  }
  return out;
}
const STATUS_WITHDRAWN = /status:\s*["']withdrawn["']/g;
/** 퇴원일을 null이 아닌 값으로 쓰는 객체 칸 — 변수·함수 호출(`kstToday()`)·`??`·글자 날짜까지. 타입 표기(`withdrawn_at: string`)는 뺀다. */
const WITHDRAWN_AT_VALUE = /withdrawn_at:\s*(?!null\b|string\b)[^\s,}|;)]/g;

/** 그대로 두는 길 — 파일 → [상태 퇴원 쓰기 건수, 퇴원일 값 쓰기 건수, 이유]. */
const ALLOWED: Record<string, [number, number, string]> = {
  "src/app/api/cron/apply-due-withdrawals/route.ts": [1, 0, "이번 변경 전에 걸린 퇴원 예약의 당일 처리(새 예약 입구는 막혔다)"],
  "src/features/admin/server/actions.ts": [1, 1, "학생 병합(진 쪽 정리) — 장부 정리는 바로 처리 보고서(DB 함수)로 옮겼다"],
  "src/features/audit/activity.ts": [0, 1, "감사로그 칸 이름표(`withdrawn_at: \"퇴원일\"` — 쓰기가 아니다)"],
  "src/features/demo-roster/dashboard-apply.ts": [1, 0, "데모 데이터"],
  "src/features/excel-import/importers/students.ts": [0, 1, "옛 기록 가져오기(새 원생 · 지난 퇴원만 — 예약은 거절)"],
  "src/features/students/server/actions.ts": [0, 2, "새 원생을 지난 퇴원으로 등록(옛 기록) · 학생 수정(이미 퇴원·걸린 예약 그대로 — 판정 formWithdrawalViaReport)"],
};

describe("퇴원은 퇴원보고서로만", () => {
  it("🔴 학생을 퇴원시키는 쓰기는 '그대로 두는 길'에만 있다(건수까지)", () => {
    const found: Record<string, [number, number]> = {};
    for (const file of sources(join(ROOT, "src"))) {
      const text = read(file);
      const a = text.match(STATUS_WITHDRAWN)?.length ?? 0;
      const b = text.match(WITHDRAWN_AT_VALUE)?.length ?? 0;
      if (a || b) found[file] = [a, b];
    }
    const expected = Object.fromEntries(Object.entries(ALLOWED).map(([f, [a, b]]) => [f, [a, b]]));
    expect(found).toEqual(expected);
  });

  it("상태 전환 창은 퇴원을 같은 문구로 거절하고, 퇴원 갈래(상태 퇴원 · 수강 닫기 · 예약 걸기)가 없다", () => {
    const src = read("src/features/students/server/actions.ts");
    const fn = src.slice(src.indexOf("export async function changeStudentStatus"), src.indexOf("export async function cancelScheduledWithdrawal"));
    expect(fn).toContain('if (target === "withdrawn") return { error: WITHDRAWAL_VIA_REPORT };');
    expect(fn).not.toContain("closeActiveEnrollmentsClamped");
    expect(fn).not.toMatch(/withdrawn_at:\s*date/);
  });

  it("학생 폼(등록·수정)과 엑셀 가져오기는 같은 판정으로 새 퇴원·새 예약을 거절한다", () => {
    const src = read("src/features/students/server/actions.ts");
    const create = src.slice(src.indexOf("export async function createStudent"), src.indexOf("export async function deleteStudent"));
    const update = src.slice(src.indexOf("export async function updateStudent"), src.indexOf("export type ChangeStatusState"));
    expect(create).toContain("formWithdrawalViaReport({ prevStatus: null, kind: createPlan.kind");
    expect(update).toContain("const viaReport = formWithdrawalViaReport(");
    expect(update.indexOf("const viaReport")).toBeLessThan(update.indexOf("let update = supabase"));
    const imp = read("src/features/excel-import/importers/students.ts");
    expect(imp).toContain("formWithdrawalViaReport({ prevStatus: null, kind: w.kind");
    expect(imp).toContain("if (plan.inserts.some((r) => r.scheduled)) return { error: SCHEDULE_VIA_REPORT };");
  });

  it("마지막 반(학생 · 그 과목) 종료는 두 수강 종료 액션이 같은 게이트로 거절한다 — 시간표 확인 문구 · 원생 화면과 같은 판정", () => {
    const src = read("src/features/students/server/actions.ts");
    const partial = src.slice(src.indexOf("export async function endStudentEnrollments"), src.indexOf("export async function setStudentEnrollmentHolds"));
    const single = src.slice(src.indexOf("export async function endSingleEnrollment"), src.indexOf("// ────────────────────── 메모 + 성적"));
    for (const fn of [partial, single]) {
      expect(fn).toContain("await lastCourseViaReport(supabase,");
      expect(fn.indexOf("lastCourseViaReport")).toBeLessThan(fn.indexOf("endEnrollmentById("));
    }
    const scope = read("src/features/timetable/server/end-scope.ts");
    expect(scope).toContain("endScopeFor(rows, target");
    expect(scope).toContain("viaReportMessage(rows, [enrollmentId], date, withdrawnAt)");
    const gate = read("src/features/withdrawals/server/via-report.ts");
    expect(gate).toContain("viaReportMessage(rows, input.enrollmentIds, input.date, withdrawnAt)");
    // 과목 마지막 반 판정은 특강 여부가 재료다(끝난 특강은 퇴원관리 '수강종료'가 아니다) — 조회가 칸을 읽는다.
    expect(gate).toContain('select("id, class_name, subject, is_special")');
    // 반·학생 상세의 수강 종료 창은 열리는 순간 같은 서버 판정으로 막는다(원장 2026-11-02 — 사유를 다 고른 뒤 거절하지 않는다).
    const dialog = read("src/features/enrollments/components/end-enrollment-action.tsx");
    expect(dialog).toContain("fetchEndScope(enrollmentId, today)");
    expect(dialog).toContain("endScopeViaReport(result)");
    // 연습본 적용의 수강 종료도 같은 안내로 막는다.
    expect(read("src/features/timetable-lab/apply-plan.ts")).toContain("SUBJECT_END_VIA_REPORT");
    // 원생 화면의 상태 전환 창도 같은 함수로 과목별 '퇴원보고서로'를 미리 계산한다(원장 2026-10-26).
    expect(read("src/app/(shell)/students/[id]/page.tsx")).toContain("viaReportMessage(endRows,");
  });

  it("보고서를 거치지 않은 퇴원은 DB가 막지 않고 경고한다(0454a) — 지연 트리거 · 실패해도 쓰기 커밋", () => {
    const sql = readMigration("0454a_withdrawal_bypass_warning.sql");
    expect(sql).toContain("create constraint trigger zz_withdrawal_without_report_warning");
    expect(sql.match(/deferrable initially deferred/g)?.length).toBe(2);
    expect(sql).toContain("security definer");
    expect(sql).toContain("exception when others or query_canceled then");
    // 경고 함수가 쓰기를 막는 일은 없다 — raise 없음.
    const fn = sql.slice(sql.indexOf("create or replace function withdrawal_guard_private.warn_unreported_withdrawal"), sql.indexOf("comment on function"));
    expect(fn).not.toMatch(/\braise\b/i);
    // 보고서 처리 = 이 트랜잭션에서 완료된 묶음(글자만 흉내 낸 metadata는 경고).
    expect(fn).toContain("g.applied_at = now()");
    expect(fn).toContain("'withdrawal_bypass'");
    expect(read("src/features/notifications/types.ts")).toContain('| "withdrawal_bypass"');
  });

  it("장부 정리(수강 없는 재원생 일괄 퇴원)도 학생마다 바로 처리 보고서를 남긴다 — 학생을 직접 쓰지 않는다", () => {
    const src = read("src/features/admin/server/actions.ts");
    const fn = src.slice(src.indexOf("export async function bulkWithdrawStudents"), src.indexOf("export async function bulkDeleteStudents"));
    expect(fn).toContain("const ids = picked.filter((id) => !attending.has(id));");
    expect(fn).toContain(".or(`end_date.is.null,end_date.gte.${today}`)");
    expect(fn).toContain('admin.rpc("direct_withdrawal_report"');
    expect(fn).toContain("enrollmentIds: [], effectiveDate: today, reason: \"other\"");
    expect(fn).not.toMatch(/from\("students"\)\s*\.update\(/);
    expect(fn).not.toMatch(/from\("enrollments"\)\s*\.update\(/);
  });

  it("수강 종료일 수정이 다니는 마지막 반을 닫으면 같은 게이트로 거절한다", () => {
    const src = read("src/features/enrollments/server/actions.ts");
    const fn = src.slice(src.indexOf("export async function updateEnrollmentDates"));
    expect(fn).toContain("await lastCourseViaReport(dateWriter");
    expect(fn.indexOf("lastCourseViaReport")).toBeLessThan(fn.indexOf('dateWriter.from("enrollments").update(patch)'));
  });

  it("바로 처리는 원생 상태 변경 자격까지 본다(승인을 건너뛰므로) — 앱·DB 둘 다", () => {
    const action = read("src/features/withdrawal-reports/server/actions.ts");
    const direct = action.slice(action.indexOf("export async function processWithdrawalDirectly"), action.indexOf("export async function changeWithdrawalReport"));
    expect(direct).toContain("if (!(await canManageStudentStatusNow()))");
    expect(readMigration("0453a_withdrawal_report_direct.sql")).toContain("special ? 'studentStatusManagerIds'");
  });

  it("관리자 바로 처리는 보고서 기록을 남기고 승인된 보고서와 같은 처리 함수를 지난다(0453a)", () => {
    const sql = readMigration("0453a_withdrawal_report_direct.sql");
    expect(sql).toContain("insert into public.withdrawal_reports(");
    expect(sql).toContain("perform public.transition_withdrawal_report(p_tenant, p_actor, rid, 'apply', '{}'::jsonb)");
    // 직접 학생을 퇴원으로 쓰지 않는다 — 학생·수강을 바꾸는 것은 처리 함수뿐.
    expect(sql).not.toMatch(/update\s+public\.students/i);
    expect(sql).not.toMatch(/update\s+public\.enrollments/i);
    // 사유 목록 = 앱 사유 목록(전이 함수와 같다 — reason-detail.test.ts가 0367a 목록을 잠근다).
    const list = sql.match(/reason not in \(([^)]*)\)/)?.[1] ?? "";
    const keys = [...list.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect([...keys].sort()).toEqual([...WITHDRAWAL_REASONS].sort());
    const action = read("src/features/withdrawal-reports/server/actions.ts");
    const direct = action.slice(action.indexOf("export async function processWithdrawalDirectly"), action.indexOf("export async function changeWithdrawalReport"));
    expect(direct).toContain("if (!viewer?.request)");
    expect(direct).toContain('db.rpc("direct_withdrawal_report"');
    expect(direct).toContain('await finish(report as WithdrawalReport, "direct");');
  });

  it("앞으로의 마이그레이션도 학생을 직접 퇴원으로 쓰지 않는다(0453a 이후)", () => {
    // 시즌1 0453a 이후 구역 + 시즌2 파일 전부(시즌2 이름 `s2_…`는 사전순으로 시즌1 번호 뒤다).
    const later = migrationFiles(ROOT).filter((f) => f.name >= "0453a");
    expect(later.length).toBeGreaterThan(0);
    // 예외 하나 — 처리 함수(`transition_withdrawal_report`) 자신을 다시 정의하는 본문(s2_0020 — 학생을 퇴원시키는 유일한 길이다).
    // 그 함수 정의만 빼고 본다(다른 함수·문장이 퇴원을 쓰면 그대로 실패한다). 본문 끝 = **여는 따옴표 표식과 같은** 닫는 표식(`as $x$ … $x$;`) —
    // 닫는 표식을 하나로 못박으면 `$$` 같은 다른 표식의 정의에서 뒤 함수까지 삼킨다(리뷰 2026-11-03). 머리에서 `as $` 전에 `;`가 나오면 정의가 아니다.
    const processing = /create\s+or\s+replace\s+function\s+public\.transition_withdrawal_report\([^;]*?\bas\s+(\$[a-z_]*\$)[\s\S]*?\1\s*;/gi;
    for (const { name: f, sql } of later) {
      expect(sql.replace(processing, ""), f).not.toMatch(/update\s+public\.students\s+set\s+status\s*=\s*'withdrawn'/i);
    }
    // 그 예외는 처리 함수 하나에만 — 다시 정의한 본문도 학생을 퇴원시키는 곳은 묶음 처리 한 군데다.
    for (const { name: f, sql } of later) {
      for (const body of sql.match(processing) ?? []) expect(body.match(/update\s+public\.students\s+set\s+status\s*=\s*'withdrawn'/gi)?.length ?? 0, f).toBeLessThanOrEqual(1);
    }
  });

  it("원생 화면의 '퇴원' 자리는 퇴원보고서 입구다 — 상태 메뉴에 '퇴원 처리'가 없다", () => {
    expect(read("src/app/(shell)/students/[id]/_components/status-action.tsx")).not.toContain('label: "퇴원 처리"');
    expect(read("src/app/(shell)/students/[id]/page.tsx")).toContain("<WithdrawalReportEntry entry={reportEntry} />");
    expect(read("src/app/(shell)/students/[id]/page.tsx")).toContain("`/withdrawal-reports?request=${student.id}`");
  });
});
