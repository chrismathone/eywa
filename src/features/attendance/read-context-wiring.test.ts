import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TenantSettings } from "@/features/owner/settings-types";
import { memoInReadContext, runWithAttendanceReadContext } from "./server/read-context";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

/**
 * 로그인 없는 출석부 조립(강사평가 밤 집계 — `server/read-context.ts`) 배선 잠금.
 * 🔴 조립 사슬의 바닥 함수가 하나라도 세션 클라이언트·강사 렌즈·세션 학원 설정·권한 확인으로 돌아가면, 밤 집계에선
 *    **에러 없이 0행**이 되어 청구액·실급여가 조용히 비거나 줄어든다(#104 계열). 그래서 자리마다 문맥을 보는지 잠근다.
 * 🔴 관리 클라이언트는 RLS를 우회하므로, 반·학생 id로 좁히지 않는 넓은 조회엔 지점 조건(`scopeTenant`)이 있어야 한다.
 * 🔴 요청 캐시 키에 지점(`readContextKey`)을 넣는다 — 한 요청에서 여러 지점을 돌 때 앞 지점 반 목록을 받지 않게.
 */
const read = (p: string) => readFileSync(p, "utf8").replace(/\s+/g, " ");

describe("로그인 없는 출석부 조립 문맥", () => {
  it("반 목록·교시 배선 — 넓은 조회는 지점 조건, 캐시 키에 지점, 렌즈는 문맥이면 없음", () => {
    const s = read("src/features/attendance/server/teacher-axis-queries.ts");
    expect(s).not.toMatch(/createClient\(/);
    expect(s.match(/scopeTenant\(/g)?.length).toBe(2);
    expect(s).toContain("loadSlotAxisByClassCached(from, to, readContextKey())");
    expect(s).toContain("loadClassAxisRowsCached(from, to, readContextKey())");
    expect(s).toContain("const tId = attendanceReadContext() ? null : await effectiveTeacherId();");
  });
  it("담임 이력 — 감사로그는 문맥의 지점으로(허용 목록 그대로), 반 이름 목록은 지점 조건, 캐시 키에 지점", () => {
    const s = read("src/features/classes/server/teacher-as-of-queries.ts");
    expect(s).toContain('ctx ? systemAuditScopeFor(ctx.tenantId, ["class_handover_apply", "class_update"])');
    expect(s).toContain('scopeTenant(supabase.from("classes").select("id, class_name"), tenantId)');
    expect(s).toContain("loadTeacherTransitionsCached(readContextKey())");
    expect(s).toContain("getHomeroomSinceIndexCached(readContextKey())");
    expect(s).toContain("getHomeroomHistoryIndexCached(readContextKey())");
    // React `cache`는 렌더 밖에서 아무것도 기억하지 않는다 — 문맥 안에서는 실행 메모가 한 번만 읽게 한다.
    expect(s).toContain('memoInReadContext("teacherTransitions", () => loadTeacherTransitionsCached(readContextKey()), (r) => !r.incomplete)');
    expect(s).toContain('memoInReadContext("homeroomSince"');
    expect(s).toContain('memoInReadContext("homeroomHistory"');
    const axis = read("src/features/attendance/server/teacher-axis-queries.ts");
    expect(axis).toContain("memoInReadContext(`slotAxis|${from}|${to}`");
    expect(axis).toContain("memoInReadContext(`classAxis|${from}|${to}`");
  });
  it("출석부 표·청구액·보강 예약·수업 나누기·세션 기간이 문맥을 본다", () => {
    const m = read("src/features/attendance/server/queries.ts");
    expect(m).toContain("const readCtx = attendanceReadContext(); const { db: supabase } = await attendanceDb();");
    expect(m).toContain("const tId = readCtx ? null : await effectiveTeacherId();");
    expect(m).toContain("readCtx ? Promise.resolve(readCtx.settings) : getTenantSettings(),");
    expect(m).toContain("readCtx ? lessonProfileOf(readCtx.settings) : await getLessonProfile()");
    expect(read("src/features/attendance/server/class-billing.ts")).toContain('const user = readCtx ? { tenantId: readCtx.tenantId } : await requireAccess("attendance");');
    expect(read("src/features/attendance/server/makeup-reservation-queries.ts")).toContain("const { db: supabase } = await attendanceDb(); const { data, error } = await supabase .from(\"makeup_reservations\")");
    expect(read("src/features/class-splits/server/queries.ts")).toContain("const { db: supabase } = await attendanceDb();");
    expect(read("src/features/periods/server/queries.ts")).toContain('const defs = args.mode === "month" || !Number.isFinite(year) ? [] : await getPeriodDefs(year);');
    const sheet = read("src/features/attendance/server/teacher-sheet.ts");
    expect(sheet).toContain("readCtx ? Promise.resolve(readCtx.settings) : getTenantSettings(),");
  });
  it("실행 메모 — 문맥 안에서는 같은 열쇠를 한 번만 읽고, 문맥 밖(화면)은 매번 부른다", async () => {
    const load = vi.fn(async () => 1);
    await memoInReadContext("k", load);
    await memoInReadContext("k", load);
    expect(load).toHaveBeenCalledTimes(2);
    load.mockClear();
    const ctx = { tenantId: "t", db: {} as SupabaseClient, settings: {} as TenantSettings };
    await runWithAttendanceReadContext(ctx, async () => {
      await Promise.all([memoInReadContext("k", load), memoInReadContext("k", load)]);
      await memoInReadContext("k", load);
    });
    expect(load).toHaveBeenCalledTimes(1);
    // 실행마다 새 메모 — 다음 실행(다음 지점)이 앞 실행 값을 받지 않는다.
    await runWithAttendanceReadContext(ctx, () => memoInReadContext("k", load));
    expect(load).toHaveBeenCalledTimes(2);
    // 실패는 기억하지 않는다 — 일시 오류 뒤 다음 호출은 다시 읽는다.
    const flaky = vi.fn().mockRejectedValueOnce(new Error("일시 오류")).mockResolvedValue(2);
    await runWithAttendanceReadContext(ctx, async () => {
      await expect(memoInReadContext("f", flaky)).rejects.toThrow("일시 오류");
      await expect(memoInReadContext("f", flaky)).resolves.toBe(2);
      await memoInReadContext("f", flaky);
    });
    expect(flaky).toHaveBeenCalledTimes(2);
    // 접힌(불완전한) 결과도 기억하지 않는다 — 담임 이력처럼 제 칸으로 알리는 것은 호출부의 `keep`.
    const partial = vi.fn<() => Promise<{ incomplete: boolean }>>().mockResolvedValueOnce({ incomplete: true }).mockResolvedValue({ incomplete: false });
    await runWithAttendanceReadContext(ctx, async () => {
      await memoInReadContext("p", partial, (r) => !r.incomplete);
      await new Promise((r) => setTimeout(r, 0));
      await memoInReadContext("p", partial, (r) => !r.incomplete);
      await memoInReadContext("p", partial, (r) => !r.incomplete);
    });
    expect(partial).toHaveBeenCalledTimes(2);
  });
  it("문맥은 서버 코드만 연다 — 강사평가 급여 재료가 유일한 진입점", () => {
    const pay = read("src/features/teacher-portfolio/server/pay-sources.ts");
    expect(pay).toContain("runWithAttendanceReadContext({ tenantId, db: admin, settings }");
    expect(read("src/features/attendance/server/read-context.ts")).toContain('import "server-only";');
  });
});
