/**
 * **테스트 학생은 운영 집계·알림에 들어가지 않는다.**
 *
 * 2026-09-01 원장 지시로 ClassNote 발송 시험용 학생 '학원이'(`students.is_test`)를 **모든 선생님이
 * 자기 화면에서 테스트할 수 있도록** 반 15개(수학 9·영어 6)에 배정했다. 그 순간부터 '미작성 보고서'
 * 신호가 요일에 따라 **매일 2~5명을 더 세게 된다** — 진짜 미작성(수학 30여 명) 안에 가짜가 섞이는 것이라
 * 숫자도 명단도 거짓이 된다.
 *
 * 2026-09-13 원장: *"테스트 계정 알림 전부 off."* — 집계뿐 아니라 **알림**도 같은 축으로 뺀다.
 * 🔴 `notifyUsers` 한 곳에서는 막을 수 없다: 그 함수는 수신자·본문만 받고 학생 id를 모르며, 본문이
 *    묶음이라(`구한결 외 10명 …`) 항목째 버리면 **실학생 10명의 알림이 함께 사라진다**. 그래서 거르는
 *    자리는 언제나 **경로별 후보 선정 단계**이고, 판정 재료는 공용 헬퍼 한 벌이다.
 *
 * ⚠️ 이건 **집계·알림**에서만 빼는 것이다. 선생님 화면의 명단(원스크린·ECS·출석부)과 학생목록에는
 *    그대로 보여야 테스트가 된다 — 거기까지 빼면 배정한 의미가 없어진다.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

const HELPER = strip(read("src", "features", "students", "server", "test-students.ts"));
const signals = strip(read("src", "features", "dashboard", "server", "action-signals.ts"));

describe("공용 헬퍼 — 판정 재료가 한 벌이다", () => {
  it("is_test 학생 id를 전건 페이징으로 받는다(B2 — 무페이징 select 금지)", () => {
    expect(HELPER).toContain('.eq("is_test", true)');
    expect(HELPER).toMatch(/fetchAllPaged<\{ id: string \}>\(/);
    // OFFSET 페이지 안정화 — unique tie-break 정렬(batch.ts 계약).
    expect(HELPER).toMatch(/\.order\("id"\)/);
  });

  it("admin(RLS 우회) 경로에서는 테넌트로 좁힌다 — 유일한 격리선이다", () => {
    expect(HELPER).toMatch(/if \(tenantId\)[\s\S]{0,120}?\.eq\("tenant_id", tenantId\)/);
  });

  it("fail-open — 조회 실패가 알림·집계를 죽이지 않는다", () => {
    // throw하면 테스트 학생 명단 한 번 못 읽었다고 그날 신호·알림이 통째로 사라진다.
    expect(HELPER).toMatch(/\.catch\(/);
    expect(HELPER).toMatch(/return new Set/);
  });
});

describe("미작성 보고서 신호는 테스트 학생을 세지 않는다", () => {
  it("공용 헬퍼로 id를 받아 대상에서 뺀다", () => {
    expect(signals).toContain("getTestStudentIds(supabase, db?.tenantId)");
    expect(signals).toMatch(/\.filter\(\(row\) => !testStudentIds\.has\(row\.student_id\)\)/);
  });

  it("수강 조회와 함께 병렬로 돈다(B4 — 직렬 워터폴 금지)", () => {
    expect(signals).toMatch(/const \[enrollmentRows, testStudentIds\] = await Promise\.all\(/);
  });
});

/**
 * 원장 2026-09-13이 지목한 **실제로 울린 4경로**. 화면에서만 빼면 알림이 계속 재촉하므로(#77의 변종)
 * 각 경로가 후보 선정 단계에서 공용 헬퍼를 지나는지를 소스로 잠근다.
 */
describe("알림 4경로가 모두 테스트 학생을 뺀다", () => {
  const cases: [string, string[]][] = [
    ["미발송 재촉 + 미수 경보", ["src", "features", "notifications", "server", "events.ts"]],
    ["미출결 → 출결 교차", ["src", "features", "attendance", "live", "server", "cross-notify.ts"]],
    ["출석 입력 완료", ["src", "features", "attendance", "server", "complete-notify.ts"]],
  ];
  for (const [label, path] of cases) {
    it(`${label}은 getTestStudentIds를 지난다`, () => {
      expect(strip(read(...path))).toContain("getTestStudentIds(");
    });
  }

  it("🔴 교차 출결은 **dedup 앞에서** 뺀다 — 뒤에서 빼면 dedup만 소모돼 진짜 알림이 영영 막힌다", () => {
    const src = strip(read("src", "features", "attendance", "live", "server", "cross-notify.ts"));
    expect(src.indexOf("getTestStudentIds(")).toBeGreaterThan(-1);
    expect(src.indexOf("getTestStudentIds(")).toBeLessThan(src.indexOf("notification_events"));
  });

  it("🔴 출석 완료도 **완료 판정 앞에서** 뺀다 — 뒤로 밀면 그 반은 영원히 '미완료'다", () => {
    const src = strip(read("src", "features", "attendance", "server", "complete-notify.ts"));
    expect(src.indexOf("testStudentIds.has(")).toBeLessThan(src.indexOf("isClassAttendanceComplete("));
    expect(src.indexOf("isClassAttendanceComplete(")).toBeLessThan(src.indexOf("notification_events"));
  });

  it("🔴 미수 경보는 RPC가 아니라 **결과를 JS에서** 거른다(화면 숫자를 함께 바꾸지 않는다)", () => {
    // dashboard_top_outstanding*는 운영실 카드·브리핑·retention이 함께 읽는다 — RPC를 고치면 별개의 결정이 된다.
    const src = strip(read("src", "features", "notifications", "server", "events.ts"));
    expect(src).toMatch(/\.filter\(\(row\) => !testStudentIds\.has\(row\.student_id\)\)/);
    expect(src).toContain("dashboard_top_outstanding_admin");
  });

  it("🔴 미발송 재촉은 공용 게이트(unsent-sendable)가 아니라 호출부에서 뺀다", () => {
    // 그 게이트는 **발송 큐 카드와 공유**라, 거기 넣으면 원장이 "빼지 않기로 한" 카드 수까지 바뀐다.
    expect(strip(read("src", "features", "report-admin", "unsent-sendable.ts"))).not.toContain("is_test");
    expect(strip(read("src", "features", "notifications", "server", "events.ts"))).toContain("sendableRows");
  });
});

describe("이미 같은 축을 쓰던 곳들이 그대로다", () => {
  const cases: [string, string[]][] = [
    ["작성률(report-admin)", ["src", "features", "report-admin", "server", "queries.ts"]],
    ["오늘의 수학(연동)", ["src", "features", "integrations", "todays-math", "service.ts"]],
    ["발송 실패 알림", ["src", "features", "notifications", "server", "failed-notify-sweep.ts"]],
    ["보드 명단", ["src", "features", "report-admin", "server", "board-roster-queries.ts"]],
  ];
  for (const [label, path] of cases) {
    it(`${label}은 여전히 is_test를 본다`, () => {
      expect(strip(read(...path))).toContain("is_test");
    });
  }
});
