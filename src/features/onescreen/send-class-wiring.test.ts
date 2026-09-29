import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 🔴 반별 발송 '보낼 반' 배선 가드 — 원장 2026-09-30:
 *  *"관리자 화면은 반 선택해서 발송할 수 있게"* · *"담당 반이 없으면 보고서 발송 불가능하게"* ·
 *  *"종강은 클래스노트에 반이 살아있는 한은 계속 보내고, 이후에 반이 사라지면 반 선택이 뜨도록"* ·
 *  ClassNote 관련 기능은 ClassNote 모듈을 켠 학원에만.
 * 발송 경로 셋(원스크린·관리자 직접 작성·관리자 일괄)이 **같은 판정**을 지나는지 코드 모양으로 잠근다.
 */
const ROOT = join(__dirname, "..", "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const ONESCREEN = read("src/features/onescreen/server/actions.ts");
const COMPOSE = read("src/features/report-admin/server/compose-actions.ts");
const BATCH = read("src/features/report-admin/server/actions.ts");

describe("반별 발송 '보낼 반' — 세 발송 경로", () => {
  it("모두 classRouteActive(ClassNote 모듈 + 경로 설정)로 판정한다 — 모듈이 꺼진 학원은 예전 그대로", () => {
    for (const src of [ONESCREEN, COMPOSE]) {
      expect(src).toContain("classRouteActive(settings");
      expect(src).toContain("needsSendClass(");
      expect(src).toContain("classBoardLiveForStudent(");
    }
    // 관리자 일괄 경로 셋(미발송 일괄 발송·재발송·멈춤 복구)은 한 함수(blockedForNoSendClass)를 지난다.
    expect(BATCH).toContain("isSendClassRouteRow(settings"); // = classRouteActive + 수학(send-class.ts)
    expect(BATCH.match(/blockedForNoSendClass\(user\.tenantId/g)?.length).toBe(3);
    // 대량 작성(sendBulkAdminReports)도 같은 게이트.
    expect(COMPOSE).toContain("blockedForNoSendClass(user.tenantId, routeRows.map(sendClassRow))");
    expect(ONESCREEN).not.toContain("classRouteAppliesTo(settings.report");
  });

  it("🔴 보낼 반이 없으면 발송하지 않는다(no_class) — 1인 보드로 흘리지 않는다", () => {
    expect(ONESCREEN).toMatch(/if \(!pick\.ok\) \{\s*await unqueue\(\);\s*return \{[^}]*status: "no_class"/);
    expect(ONESCREEN).not.toContain('pick.reason === "none"');
    expect(COMPOSE).toContain('status: "no_class", error: NO_SEND_CLASS_ERROR');
    expect(BATCH).toContain("noClassIds");
  });

  it("🔴 반 보드 확인 실패(null)는 발송하지 않는다(fail-closed)", () => {
    expect(ONESCREEN).toContain("classLive === null");
    expect(COMPOSE).toContain("classLive === null");
    expect(ONESCREEN).toContain('status: "class_check_failed"');
  });

  it("보고서에 반이 있는데 반 보드가 없으면 메인 수업을 자동으로 고르지 않는다(autoPick)", () => {
    expect(ONESCREEN).toContain("{ autoPick: !input.classId }");
    expect(COMPOSE).toContain("{ autoPick: !classId }");
  });

  it("🔴 워커 판정도 '연결 + 그 학생 ok 멤버' — 앱과 한 규칙", () => {
    const route = read("scripts/_classnote/classnote-class-route.mjs");
    expect(route).toContain("export async function isClassRouteEligible(sql, tenant, classId, studentId)");
    expect(route).toMatch(/classnote_class_board_members m[\s\S]*m\.status = 'ok'/);
    expect(route).toContain("m.status <> 'ok'");
    const server = read("src/features/onescreen/server/send-class.ts");
    expect(server).toContain("liveBoardClassIdsOf("); // 순수 판정(ok ≥1 · 보류 0 · 대상 반) — send-class.test.ts가 고정
  });

  it("🔴 종강 반 연결 지키기는 조회 실패를 삼키지 않는다(삼키면 연결이 전부 지워진다)", () => {
    const load = read("scripts/_classnote/math-class-boards-load.mjs");
    const closed = load.slice(load.indexOf("export async function loadClosedLinked"), load.indexOf("export async function loadLinkedBoards"));
    expect(closed).not.toContain(".catch(");
    for (const f of ["scripts/_classnote/math-class-boards-sync.mjs", "scripts/_classnote/provision-math-class-boards.mjs"])
      expect(read(f)).toContain("loadLinkedBoards(sql, tenant, { strict: true })");
  });

  it("관리자 직접 작성은 고른 반을 서버가 후보 안에서 다시 확인한다(resolveSendClass에 classnoteClassId)", () => {
    expect(COMPOSE).toMatch(/resolveSendClass\(\s*user\.tenantId,\s*input\.studentId,\s*reportDate,\s*input\.classnoteClassId \?\? null/);
    expect(COMPOSE).toContain("export async function getAdminSendClassOptions(");
  });
});
