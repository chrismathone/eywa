import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { canSeePortfolio, classReviewFaces, resolveClassReviewTab } from "@/features/class-review/faces";
import { rotateForDay } from "./server/refresh";
import { deltaOf, followAnchor, groupByWeek, pickWeek, scoreColor } from "./view";

import { readMigration } from "@/lib/db/migrations-corpus.mjs";
/**
 * 직원 포트폴리오 배선 — 원장 2026-10-13: 직원 평가의 내부 탭 둘(직원 평가 / 직원 포트폴리오).
 * 전 강사의 점수와 담당 매출이 실리는 면이라, 열 수 없는 사람에겐 탭도 주소도 통하지 않아야 한다(#77).
 */
const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("내부 탭", () => {
  it("볼 수 있는 사람에겐 두 면, 아니면 종전 화면 하나뿐이다", () => {
    expect(classReviewFaces({ portfolio: true }).map((f) => f.label)).toEqual(["직원 평가", "직원 포트폴리오", "업무 현황"]);
    expect(classReviewFaces({ portfolio: false }).map((f) => f.key)).toEqual(["review"]);
  });
  it("주소로 강제해도 열 수 없는 면은 직원 평가로 돌아간다", () => {
    expect(resolveClassReviewTab("portfolio", { portfolio: true })).toBe("portfolio");
    expect(resolveClassReviewTab("portfolio", { portfolio: false })).toBe("review");
    // 업무 현황(대시보드 강사별 업무 현황을 옮김 — 원장 2026-10-30 "원장만")도 포트폴리오와 같은 판정.
    expect(resolveClassReviewTab("work", { portfolio: true })).toBe("work");
    expect(resolveClassReviewTab("work", { portfolio: false })).toBe("review");
    expect(resolveClassReviewTab("nope", { portfolio: true })).toBe("review");
  });
  it("🔴 원장 역할이 자기 눈으로 볼 때만 연다 — '다른 강사 뷰'로 원장을 빌려도, 개인 예외로도 안 열린다", () => {
    const viewer = (role: string, viewAs = false, selfOnly = false) => ({ role, viewAs, selfOnly });
    expect(canSeePortfolio(viewer("master"), false)).toBe(true);
    expect(canSeePortfolio(viewer("master", true), false)).toBe(false);
    expect(canSeePortfolio(viewer("master", true), true)).toBe(false);
    expect(canSeePortfolio(viewer("admin"), false)).toBe(false);
    expect(canSeePortfolio(viewer("admin"), true)).toBe(true);
    expect(canSeePortfolio(viewer("teacher", false, true), true)).toBe(false);
  });
  it("화면·조회·집계가 같은 게이트를 지난다", () => {
    const page = read("src/app/(shell)/class-review/page.tsx");
    expect(page).toContain('requireAccess("class_review")');
    expect(page).toContain("resolveClassReviewTab(sp.tab, faceOptions)");
    const queries = read("src/features/teacher-portfolio/server/queries.ts");
    const view = queries.slice(queries.indexOf("export async function getPortfolioView"));
    expect(view).toMatch(/^export async function getPortfolioView\([^)]*\): Promise<PortfolioView \| null> \{\s*const gate = await getPortfolioGate\(\);\s*if \(!gate\) return null;/);
    expect(queries).toContain("(await getReviewPrivileges()).seePortfolio");
    const action = read("src/features/teacher-portfolio/server/actions.ts");
    expect(action).toMatch(/const gate = await getPortfolioGate\(\);[\s\S]*if \(!gate \|\| !user\) return/);
    expect(read("src/features/class-review/server/queries.ts")).toContain("const seePortfolio = canSeePortfolio(v, ");
  });
});

describe("매일 집계", () => {
  it("vercel.json에 00:10 KST cron이 있고, 꺼진 지점·실험실이 닫힌 지점·표가 없는 지점은 건너뛴다", () => {
    const crons = (JSON.parse(read("vercel.json")) as { crons: { path: string; schedule: string }[] }).crons;
    expect(crons).toContainEqual({ path: "/api/cron/teacher-portfolio", schedule: "10 15 * * *" });
    const route = read("src/app/api/cron/teacher-portfolio/route.ts");
    expect(route).toContain("bearerMatches(auth, secret)");
    expect(route).toContain('"class_review")');
    // 직원 평가 = 실험실 메뉴(원장 2026-10-13) — 화면이 닫힌 지점은 집계도 하지 않는다.
    expect(route).toContain('isLaboratoryMenuAvailable(tenantId, "class_review")');
    expect(route).toContain("summary.tableMissing");
  });
  it("고친 배선이 빠지지 않았다 — 마감 전 달 · 처음 완료 시각 · 이 달 상담 수", () => {
    expect(read("src/features/teacher-portfolio/server/refresh.ts")).toContain("buildPortfolio(snapshot, { openMonths, evaluation: { config: scoring.evaluation.config, entries: scoring.entries }, pay })");
    // 급여 비율을 일시 실패로 못 센 달은 마감을 미룬다(0점으로 굳지 않게).
    expect(read("src/features/teacher-portfolio/server/refresh.ts")).toContain("savePortfolioMonths(admin, tenantId, result, now, { withRaws, holdClose })");
    // 학부모 만족도 확인 대기가 남은 달은 다음 달 말까지 마감을 미룬다(원장 2026-10-16 '9월을 이달 말까지 열어 두기').
    expect(read("src/features/teacher-portfolio/server/refresh.ts")).toContain("waiting.has(`${teacherId}|${month}`)");
    expect(read("src/features/teacher-portfolio/server/refresh.ts")).toContain("loadOpenMonths(admin, tenantId, portfolioFloor(periodEnd))");
    expect(read("src/features/class-review/server/actions.ts")).toContain("firstCompletedAt(submissions[slot], scores, areas, now)");
    expect(read("src/app/(shell)/class-review/_components/portfolio/evidence-records.tsx")).toContain('{ label: "이 달 상담", value: `${held(rows)}건` }');
  });
  it("지점을 도는 순서는 날마다 한 칸씩 돈다 — 같은 지점만 시간 부족으로 밀리지 않게", () => {
    const ids = ["a", "b", "c"];
    const days = ["2026-10-13", "2026-10-14", "2026-10-15"].map((day) => rotateForDay(ids, day)[0]);
    expect(new Set(days).size).toBe(3);
    expect(rotateForDay(ids, "2026-10-13").sort()).toEqual(ids);
    expect(rotateForDay([], "2026-10-13")).toEqual([]);
  });
  it("강사평가 설정·직접 입력은 포트폴리오와 같은 원장 문을 지나고, 표는 서버만 지난다(0359a)", () => {
    // 바꾸는 액션은 전부 한 문(evaluationWriteGate) — 설정 저장·직접 입력(2) · 구성 저장·삭제(2).
    const gate = read("src/features/teacher-portfolio/server/write-gate.ts");
    expect(gate).toMatch(/async function evaluationWriteGate\(\)[\s\S]*const gate = await getPortfolioGate\(\);[\s\S]*readonlyTeacherViewError[\s\S]*canWriteTenant\(user\.systemRole, "class_review"\)/);
    const actions = read("src/features/teacher-portfolio/server/evaluation-actions.ts");
    expect(actions).toContain("const writeGate = evaluationWriteGate;");
    expect(actions.match(/const gate = await writeGate\(\);\s*if \("error" in gate\) return/g)).toHaveLength(2);
    const presets = read("src/features/teacher-portfolio/server/preset-actions.ts");
    expect(presets.match(/const gate = await evaluationWriteGate\(\);\s*if \("error" in gate\) return/g)).toHaveLength(2);
    const page = read("src/app/(shell)/owner/page.tsx");
    expect(page).toContain('requestedFace === "evaluation" && !(await getPortfolioGate())');
    expect(page).toContain('tab === "evaluation" && showEvaluation ? <EvaluationFace /> : null');
    const sql = readMigration("0359a_teacher_evaluation_settings.sql");
    expect(sql).not.toMatch(/create policy/i);
    for (const t of ["teacher_evaluation_settings", "teacher_evaluation_entries"]) {
      expect(sql).toContain(`alter table public.${t} enable row level security`);
      expect(sql).toContain(`revoke all on public.${t} from public, anon, authenticated`);
    }
    const presetSql = readMigration("0360a_teacher_evaluation_presets.sql");
    expect(presetSql).not.toMatch(/create policy/i);
    expect(presetSql).toContain("alter table public.teacher_evaluation_presets enable row level security");
    expect(presetSql).toContain("revoke all on public.teacher_evaluation_presets from public, anon, authenticated");
  });
  it("저장 표는 정책 없이 서버만 지나고, 마감한 줄은 DB가 고치지 못하게 막는다", () => {
    const sql = readMigration("0357a_teacher_portfolio_months.sql");
    expect(sql).toContain("enable row level security");
    expect(sql).toContain("revoke all on public.teacher_portfolio_months from public, anon, authenticated");
    expect(sql).not.toMatch(/create policy/i);
    expect(sql).toContain("before update on public.teacher_portfolio_months");
  });
});

describe("표시 규칙", () => {
  const october = { start: "2026-10-01", end: "2026-10-11" };
  it("주는 월~일이고 달 경계에서 자른다", () => {
    const weeks = groupByWeek(october, [{ day: "2026-10-01" }, { day: "2026-10-06" }], (r) => r.day);
    expect(weeks.map((w) => [w.start, w.end, w.rows.length])).toEqual([["2026-10-01", "2026-10-04", 1], ["2026-10-05", "2026-10-11", 1]]);
  });
  it("처음에는 기록이 있는 가장 최근 주를 펼치고, 고른 주가 있으면 그 주다", () => {
    const weeks = groupByWeek(october, [{ day: "2026-10-02" }], (r) => r.day);
    expect([pickWeek(weeks, undefined), pickWeek(weeks, 1), pickWeek(weeks, 9)]).toEqual([0, 1, 0]);
  });
  it("상담은 그 달에 한 것은 상담일, 앞 달에서 넘어온 후속은 기한일에 묶는다", () => {
    const row = { studentId: "s", scored: true, state: "완료" as const };
    expect(followAnchor(october, { ...row, day: "2026-10-03", due: "2026-10-20" })).toBe("2026-10-03");
    expect(followAnchor(october, { ...row, day: "2026-09-20", due: "2026-10-05" })).toBe("2026-10-05");
  });
  it("전월 대비는 오르면 붉은색, 내리면 파란색이고 산출불가와는 비교하지 않는다", () => {
    expect([deltaOf(9, 8).text, deltaOf(9, 8).tone]).toEqual(["+1.0점", "up"]);
    expect([deltaOf(8, 9.5).text, deltaOf(8, 9.5).tone]).toEqual(["−1.5점", "down"]);
    expect(deltaOf(null, 9).tone).toBe("none");
  });
  it("총점 색은 토큰에서만 온다", () => {
    expect(scoreColor(71.2)).toBe("color-mix(in srgb, var(--color-danger) 71%, var(--color-blue))");
    expect(scoreColor(null)).toBe("var(--color-line-strong)");
  });
});
