import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readMigration } from "@/lib/db/migrations-corpus.mjs";

const ROOT = path.resolve(__dirname, "../../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

/**
 * 저장 즉시 반영(s2_0051) 배선 가드 — 원장 2026-11-10 *"출결이나 상담같이 실시간 체크 가능한것들은 실시간 반영 … 오해를 사지 않게"*.
 * 장부를 읽는 화면이 읽기 전 맞춤(`flushDuties`)을 빼먹으면 "찍었는데 칸이 안 채워진다"가 되돌아온다.
 */
describe("업무 완성도 — 저장 즉시 반영 배선", () => {
  it("🔴 장부를 읽는 입구는 전부 읽기 전에 맞춘다", () => {
    const entrances = ["src/app/api/duties/mine/route.ts", "src/app/api/duties/summary/route.ts", "src/app/api/duties/admin/route.ts", "src/app/(shell)/duties/page.tsx", "src/features/duties/components/my-duties-strip.tsx"];
    expect(entrances.filter((p) => !/flushDuties\(/.test(read(p)))).toEqual([]);
  });
  it("🔴 맞춤이 완료를 읽는 사실 표(출결 · 보고서 · 알림장 · 상담 · 성적 · 신규생 체크)에는 변경 기록 트리거가 있다 · 트리거는 저장을 막지 않는다", () => {
    const sql = readMigration("s2_0051_duty_live_sync.sql");
    const sources = [...read("src/features/duties/server/sync.ts").matchAll(/admin\.from\("(attendance_records|lesson_reports|classnote_class_posts)"\)/g), ...read("src/features/duties/server/monthly-sync.ts").matchAll(/admin\.from\("(student_consultations|student_grades)"\)/g)].map((m) => m[1]!);
    expect([...new Set(sources)].sort()).toEqual(["attendance_records", "classnote_class_posts", "lesson_reports", "student_consultations", "student_grades"]);
    for (const table of [...sources, "student_onboarding_checks"]) expect(sql).toContain(`on public.${table} for each row execute function duties_private.mark_dirty(`);
    expect(sql).toMatch(/exception when others then\s+null;/);
  });
  it("🔴 화면의 맞춤은 던지지 않는다 · 크론은 같은 잠금을 쓴다 · 둘 다 오늘과 최근 7일만 맞춘다", () => {
    const live = read("src/features/duties/server/live-sync.ts");
    expect(live).toMatch(/export async function flushDuties[\s\S]*?catch \(error\) \{\s+reportError/);
    expect(live).toContain("syncDays(got.days, today");
    const cron = read("src/app/api/cron/duties/route.ts");
    expect(cron).toContain("claimDutySync(tenantId, true)");
    expect(cron).toContain("finishDutySync(tenantId, claim, false)");
    expect(cron).toContain("syncDays(got.days, today");
    // 변경 기록이 준 날을 창 없이 그대로 맞춤에 태우는 길이 없어야 한다.
    for (const src of [live, cron]) expect(src).not.toMatch(/of got\.days\)|\.\.\.got\.days/);
  });
  it("🔴 가져가기는 지우지 않는다(맞춤이 죽어도 줄이 남는다) · 마무리는 증표가 맞을 때만 · 변경 기록에 유니크가 없다(저장이 기다리지 않는다)", () => {
    const sql = readMigration("s2_0051_duty_live_sync.sql");
    const claim = sql.slice(sql.indexOf("function public.duty_sync_claim"), sql.indexOf("function public.duty_sync_finish"));
    expect(claim).not.toMatch(/delete from public\.duty_dirty/);
    expect(claim).toContain("set claimed = v_token");
    const finish = sql.slice(sql.indexOf("function public.duty_sync_finish"));
    expect(finish).toContain("sync_token = p_token");
    expect(finish).toMatch(/if p_ok then delete from public\.duty_dirty where tenant_id = p_tenant and claimed = p_token/);
    expect(sql).not.toMatch(/into public\.duty_dirty[^;]*on conflict/);
    expect(sql).toMatch(/and d\.claimed is null[^\n]*\n\s+and d\.created_at < clock_timestamp\(\) - interval '1 hour'/);
    expect(sql).toContain("drop constraint if exists duty_dirty_pkey");
  });
  it("월 상담은 분석 중인 임시 행만 뺀다(전사에 실패한 녹음 상담도 한 상담이다)", () => {
    expect(read("src/features/duties/server/monthly-sync.ts")).toContain('.not("processing_status", "in", "(uploaded,transcribing,analyzing)")');
  });
  it("🔴 지난달 다시 만들기는 평가 개시 전에 끝난 달만 · 윗단계 할 일은 '처리됨'으로 단정해 닫지 않는다 · 면제는 맞춤이 되살리지 않는다", () => {
    expect(read("src/features/duties/server/backfill.ts")).toContain("if (!liveDay || `${nextMonth(month)}-01` >= liveDay) return");
    expect(readMigration("s2_0057_duty_resolve_keep_merged.sql")).toContain("not in ('waived', 'merged')");
    const sql = readMigration("s2_0052_duty_manage.sql");
    const up = sql.slice(sql.indexOf("function public.duty_escalate_up"), sql.indexOf("function duties_private.rollup_rows"));
    expect(up).toContain("'duties_cleared'");
    expect(up).not.toContain("'duties_resolved'");
    expect(sql).toContain("and d.void_reason is distinct from 'waived'");
  });
  it("🔴 저장 순간의 신호 — 트리거가 보내는 채널 · 사건 이름이 화면이 듣는 것과 같다 · 신호에 내용을 싣지 않는다 · 저장을 막지 않는 블록 안", () => {
    const sql = readMigration("s2_0054_duty_live_ping.sql");
    expect(sql).toContain("perform realtime.send(jsonb_build_object('scope', tg_argv[0]), 'changed', 'duties:' || v_tenant::text, false);");
    const ping = read("src/features/duties/live-ping.ts");
    expect(ping).toContain('DUTY_PING_EVENT = "changed"');
    expect(ping).toContain("`duties:${tenantId}`");
    expect(sql.indexOf("perform realtime.send")).toBeLessThan(sql.indexOf("exception when others then"));
    for (const p of ["src/features/duties/components/admin/duty-admin.tsx", "src/features/duties/components/my-duties-strip-button.tsx"]) expect(read(p)).toContain("useDutyPing(tenantId");
  });
  it("🔴 할 일 제목의 종류 이름(DB `kind_label`)은 화면 이름(`kinds.ts`)과 같은 글자다 · 모르는 종류에 영문 키를 내보내지 않는다", async () => {
    const sql = readMigration("s2_0055_duty_kind_labels.sql");
    const { DUTY_KINDS } = await import("./kinds");
    for (const [kind, info] of Object.entries(DUTY_KINDS)) expect(sql, kind).toMatch(new RegExp(`when '${kind}'\\s+then '${info.label}'`));
    expect(sql).toContain("else '업무' end");
  });
});
