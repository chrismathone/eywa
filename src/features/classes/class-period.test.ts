import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { classOperatingPeriod, commonPeriod } from "./class-period";

import { readMigration } from "@/lib/db/migrations-corpus.mjs";
const TODAY = "2026-09-18";
const slot = (validFrom: string | null, validTo: string | null) => ({ validFrom, validTo });

describe("commonPeriod — 반 수정 폼 프리필과 같은 압축", () => {
  it("전 교시가 같으면 그 한 쌍", () => {
    expect(commonPeriod([slot("2026-09-03", "2026-09-21"), slot("2026-09-03", "2026-09-21")])).toEqual({
      validFrom: "2026-09-03",
      validTo: "2026-09-21",
      mixed: null,
    });
  });
  it("갈리면 그 칸을 비우고 어느 쪽인지 밝힌다(지어내지 않는다)", () => {
    expect(commonPeriod([slot("2026-09-03", "2026-09-21"), slot("2026-09-05", "2026-09-21")]).mixed).toBe("from");
    expect(commonPeriod([slot("2026-09-03", "2026-09-21"), slot("2026-09-03", null)])).toMatchObject({
      validTo: null,
      mixed: "to",
    });
  });
});

describe("classOperatingPeriod — 반 정보 '운영 기간'(원장 2026-09-18)", () => {
  it("지금 유효한 교시의 공통값 — 주말내신특강(고1) 9/3~9/21", () => {
    expect(
      classOperatingPeriod([slot("2026-09-03", "2026-09-21"), slot("2026-09-03", "2026-09-21")], TODAY),
    ).toEqual({ validFrom: "2026-09-03", validTo: "2026-09-21", mixed: null, ended: false });
  });
  it("정규 반(무기한) — 종료일 없음", () => {
    expect(classOperatingPeriod([slot("2026-03-02", null)], TODAY)).toMatchObject({ validTo: null, ended: false });
  });
  it("지난 이력 행은 섞지 않는다 — 폼이 편집하는 것과 같은 범위", () => {
    // 8월에 마감된 옛 배치 + 지금 배치(9/3~9/21) — 옛 행 때문에 '교시마다 다름'이 되면 안 된다.
    expect(
      classOperatingPeriod([slot("2026-03-02", "2026-08-31"), slot("2026-09-03", "2026-09-21")], TODAY),
    ).toMatchObject({ validFrom: "2026-09-03", validTo: "2026-09-21", mixed: null });
  });
  it("기간이 이미 끝난 반 — 가장 늦게 끝난 교시 묶음의 기간을 보이고 '운영 종료'", () => {
    expect(
      classOperatingPeriod([slot("2026-07-01", "2026-07-31"), slot("2026-08-01", "2026-08-31")], TODAY),
    ).toEqual({ validFrom: "2026-08-01", validTo: "2026-08-31", mixed: null, ended: true });
  });
  it("교시가 없으면 null", () => {
    expect(classOperatingPeriod([], TODAY)).toBeNull();
  });
});

/**
 * 배선 가드 — 운영 기간 → 수강 종료일(0274a). 🔴 **미래 종료일을 미리 박지 않는다**(적대 리뷰 2026-09-18: 앱 26곳이 "종료일이
 * 비었으면 수강 중"으로 판정해 그 사이 퇴원·휴원·반 폐지·공지 대상에서 수강이 빠진다). 닫기는 끝난 뒤 cron, 그 전엔 표시만.
 */
describe("배선 — 운영 기간 → 수강 종료일(0274a)", () => {
  const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8").replace(/\r\n/g, "\n");
  const sqlFile = readMigration("0274a_class_period_enrollment_end.sql");
  const actions = read("src", "features", "classes", "server", "actions.ts");
  const helper = read("src", "features", "classes", "server", "period-enrollments.ts");
  const cron = read("src", "app", "api", "cron", "close-ended-class-periods", "route.ts");

  it("🔴 닫는 건 **끝난 기간**뿐 — 지금 유효한 교시가 있으면 종료일이 없다(미래 종료일을 박지 않는다)", () => {
    expect(sqlFile).toMatch(
      /when exists \(select 1 from slots sl, today t where sl\.valid_to is null or sl\.valid_to >= t\.d\) then null/,
    );
    // 옛 설계(저장 시 미래 종료일로 닫기)가 되살아나지 않게.
    expect(sqlFile).not.toContain("sync_class_period_enrollments");
    expect(actions).not.toContain("syncClassPeriodEnrollments");
  });

  it("🔴 교시를 다 지워 생긴 마감 행(만든 날 > 종료일)은 운영 종료로 치지 않는다 — 정규 반 전원이 밤사이 닫히지 않게", () => {
    expect(sqlFile).toContain("when exists (select 1 from slots sl, last l where sl.valid_to = l.d and sl.made_on > l.d) then null");
  });

  it("매일 밤 cron이 닫고 반마다 감사로그 — 테넌트를 가로지르는 일괄이라 service_role 전용", () => {
    expect(read("vercel.json")).toContain('"path": "/api/cron/close-ended-class-periods"');
    expect(cron).toContain('supabase.rpc("close_ended_class_period_enrollments")');
    expect(cron).toContain('action: "class_period_enrollments"');
    expect(sqlFile).toContain(
      "revoke all on function public.close_ended_class_period_enrollments() from public, anon, authenticated;",
    );
    expect(sqlFile).toContain("grant execute on function public.close_ended_class_period_enrollments() to service_role;");
  });

  it("새 수강은 트리거가 — 이미 끝난 반에 넣을 때만 닫는다", () => {
    expect(sqlFile).toContain("create trigger trg_enrollments_class_period_end");
    expect(sqlFile).toMatch(/v_end := public\.class_period_closed_end\(new\.class_id\)/);
  });

  it("🔴 사유 문자열은 SQL과 앱이 글자까지 같다 — 사람이 날짜를 고치면 앱이 이 사유를 지운다", () => {
    expect(helper).toContain('export const PERIOD_END_REASON = "운영 기간 종료";');
    expect(sqlFile.match(/'운영 기간 종료'/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("🔴 되살리기는 없다 — 끝난 반에 교시를 다시 넣어도 지난 기수(퇴원생 포함)가 되살아나지 않는다(재리뷰 2026-09-18)", () => {
    expect(sqlFile).not.toMatch(/reopen_class_period/);
    expect(actions).not.toMatch(/reopenClassPeriod|syncClassPeriod/);
  });

  it("🔴 사람이 종료일을 고치면 표식을 지운다 — 기간을 다시 열 때 그 값을 덮지 않게", () => {
    const edit = read("src", "features", "enrollments", "server", "actions.ts");
    expect(edit).toContain("=== PERIOD_END_REASON ? { withdrawal_reason: null } : {}");
  });

  it("🔴 SQL은 security invoker(기본)다 — RLS(0219a)를 우회하지 않는다", () => {
    expect(sqlFile).not.toMatch(/security definer/i);
  });

  it("반 수정 폼·반 정보 카드·학생 줄이 **같은 판정**을 쓴다(폼에 사본을 두지 않는다)", () => {
    const edit = read("src", "app", "(shell)", "classes", "[id]", "edit", "page.tsx");
    expect(edit).toContain('import { commonPeriod } from "@/features/classes/class-period";');
    expect(edit).not.toContain("function commonPeriod(");
    const detail = read("src", "app", "(shell)", "classes", "[id]", "page.tsx");
    expect(detail).toContain("const classPeriod = classOperatingPeriod(klass.scheduleSlots, today);");
    expect(detail).toContain("<ClassPeriodView period={classPeriod} lang={lang} />");
    expect(detail).toContain("emptyLabel={openEndLabel(s.enrolledAt)}");
  });
});
