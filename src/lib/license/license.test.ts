import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { TOGGLE_FEATURES } from "@/features/super-admin/labels";
import { LICENSE_BLOCKED_MESSAGE, licenseAllows, licenseExplicitlyOn, seatLimitOf, seatsExceeded } from "./rule";
import { aiUserMessage } from "@/lib/ai/user-message";

describe("라이선스 판정 규칙", () => {
  const now = new Date("2026-09-25T00:00:00Z");

  it("행이 없으면 허용 — 라이선스 카드 이전부터 쓰던 지점(침산·데모)이 멈추지 않는다", () => {
    expect(licenseAllows(null, now)).toBe(true);
  });

  it("명시로 끈 것·만료된 것만 막는다", () => {
    expect(licenseAllows({ is_active: true, expires_at: null }, now)).toBe(true);
    expect(licenseAllows({ is_active: false, expires_at: null }, now)).toBe(false);
    expect(licenseAllows({ is_active: true, expires_at: "2026-09-24T23:59:59Z" }, now)).toBe(false);
    expect(licenseAllows({ is_active: true, expires_at: "2026-12-31T00:00:00Z" }, now)).toBe(true);
  });

  it("기본 꺼짐 기능(연결 앱)은 켠 행이 있을 때만 — 행이 없으면 꺼짐", () => {
    expect(licenseExplicitlyOn(null, now)).toBe(false);
    expect(licenseExplicitlyOn({ is_active: true, expires_at: null }, now)).toBe(true);
    expect(licenseExplicitlyOn({ is_active: false, expires_at: null }, now)).toBe(false);
    expect(licenseExplicitlyOn({ is_active: true, expires_at: "2026-09-24T23:59:59Z" }, now)).toBe(false);
  });

  it("좌석: 행 없음·끔·비어 있음 = 제한 없음, 한도를 넘는 순간만 막는다", () => {
    expect(seatLimitOf(null)).toBeNull();
    expect(seatLimitOf({ is_active: false, max_seats: 10 })).toBeNull();
    expect(seatLimitOf({ is_active: true, max_seats: null })).toBeNull();
    expect(seatLimitOf({ is_active: true, max_seats: 10 })).toBe(10);
    expect(seatsExceeded(null, 999, 1)).toBe(false);
    expect(seatsExceeded(10, 9, 1)).toBe(false);
    expect(seatsExceeded(10, 10, 1)).toBe(true);
    expect(seatsExceeded(10, 5, 6)).toBe(true);
    expect(seatsExceeded(10, 10, 0)).toBe(false);
  });

  it("AI 차단 문구는 화면까지 그대로 간다(일반 실패 문구로 덮이지 않는다)", () => {
    expect(aiUserMessage(new Error(LICENSE_BLOCKED_MESSAGE.ai_analysis), "실패")).toBe(LICENSE_BLOCKED_MESSAGE.ai_analysis);
  });
});

/**
 * 🔴 **읽는 곳 없는 스위치 금지** — 슈퍼관리자 라이선스 카드의 스위치가 저장만 되고 아무도 안 읽던 것을
 *    (원장 2026-09-25 *"온오프하면 실제로 배선 따여잇나?"*) 다시 만들지 않게, 카드의 **모든 키**에 게이트가 있는지 센다.
 */
describe("라이선스 배선 가드", () => {
  const ROOT = process.cwd();
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((n) => {
      const f = join(dir, n);
      if (statSync(f).isDirectory()) return walk(f);
      return /\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n) ? [f] : [];
    });
  const SRC = walk(join(ROOT, "src"))
    .filter((f) => !relative(ROOT, f).replaceAll("\\", "/").includes("super-admin"))
    .map((f) => ({ path: relative(ROOT, f).replaceAll("\\", "/"), src: readFileSync(f, "utf8") }));

  const consumersOf = (key: string) =>
    SRC.filter(
      ({ src }) =>
        new RegExp(`(licenseBlockReason|isFeatureLicensed|isFeatureOptedIn)\\([^)]*"${key}"`).test(src) ||
        new RegExp(`\\.eq\\("feature",\\s*"${key}"\\)`).test(src),
    ).map((f) => f.path);

  it.each(TOGGLE_FEATURES.map((f) => f.key))("'%s' 스위치를 읽는 게이트가 있다", (key) => {
    expect(consumersOf(key).length).toBeGreaterThan(0);
  });

  it("기대한 자리에 게이트가 서 있다", () => {
    expect(consumersOf("meeting_recording")).toEqual(
      expect.arrayContaining(["src/features/media/server/upload-actions.ts", "src/features/meetings/server/actions.ts"]),
    );
    expect(consumersOf("google_sheets")).toEqual(
      expect.arrayContaining([
        "src/app/api/cron/sheets-sync/route.ts",
        "src/features/integrations/server/actions.ts",
        "src/features/timetable/server/import-actions.ts",
        "src/features/staff/resume/server/resume-roster-sheet.ts",
        "src/features/withdrawals/server/sheet-teachers.ts",
      ]),
    );
    expect(consumersOf("kakao_messaging")).toContain("src/lib/messaging/provider.ts");
    expect(consumersOf("slack")).toEqual(
      expect.arrayContaining([
        "src/features/slack/server/dispatch.ts",
        "src/features/slack/server/gate.ts",
        "src/features/slack/server/queries.ts",
      ]),
    );
    expect(consumersOf("todays_math")).toEqual(
      expect.arrayContaining([
        "src/features/connected-apps/server/visible.ts",
        "src/app/api/integrations/todays-math/roster/route.ts",
        "src/app/api/integrations/todays-math/progress/route.ts",
      ]),
    );
  });

  it("AI 게이트는 단일 관문 generateJSON 안에 있다", () => {
    const gen = SRC.find((f) => f.path === "src/lib/ai/generate.ts")!.src;
    expect(gen).toMatch(/isFeatureLicensed\(tenantId, "ai_analysis"\)/);
    // 지점을 모르는 호출은 통과가 아니라 거절 — "빈틈"(원장 2026-09-25)이 다시 열리지 않게.
    expect(gen).toMatch(/if \(!tenantId\) throw new Error\(AI_TENANT_MISSING_MESSAGE\)/);
    // 타입에서도 지점이 필수다(선택으로 되돌리면 호출부가 조용히 빠진다).
    expect(gen).toMatch(/meta: \{ tenantId: string; feature: string \};/);
  });

  it("학생이 재원이 되는 모든 경로가 좌석을 본다", () => {
    const seatCalls = (path: string) =>
      (SRC.find((f) => f.path === path)!.src.match(/seatBlockReason\(/g) ?? []).length;
    expect(seatCalls("src/features/students/server/actions.ts")).toBe(3); // 등록·수정·상태 복구
    expect(seatCalls("src/features/withdrawals/server/actions.ts")).toBe(1); // 퇴원 복구
    expect(seatCalls("src/features/enrollment/server/actions.ts")).toBe(1); // 상담 → 원생 전환
    expect(seatCalls("src/features/excel-import/importers/students.ts")).toBe(2); // 엑셀 가져오기(미리보기 + 반영)
    expect(seatCalls("src/features/timetable-lab/server/apply-store.ts")).toBe(1); // 시간표 연습본 실제 반영
    const makeedu = readFileSync(join(ROOT, "scripts/_makeedu/import-students-list.cjs"), "utf8");
    const makeeduAlert = readFileSync(join(ROOT, "scripts/_makeedu/seat-limit-alert.cjs"), "utf8");
    expect(makeedu).toMatch(/notifySeatLimitExceeded\(sql, tenantId, insertedEnrolled\)/); // 외부 장부는 막지 않고 반영 뒤 알림
    expect(makeeduAlert).toMatch(/title: "좌석 한도 초과"/);
  });
});
