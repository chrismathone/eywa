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
  it("모두 classRouteActive(ClassNote 모듈 켜짐 — 수학은 늘 반별)로 판정한다 — 모듈이 꺼진 학원은 예전 그대로", () => {
    for (const src of [ONESCREEN, COMPOSE]) {
      expect(src).toContain("classRouteActive(settings");
      expect(src).toContain("SEND_CLASS_SUBJECTS.has(");
      expect(src).toContain("classBoardLiveForStudent(");
      // 🔴 정규 보고서 반 보드가 없으면 막는다(원장 결정 4) — 다른 반을 고르게 하지 않는다. 까닭은 가려서 말한다(2026-10-03 —
      //    board-missing.test.ts). 까닭을 가린 결과는 언제나 ok:false다(통과시키는 길이 아니다).
      expect(src).toMatch(/const why = await explainBoardMissing\([^)]*\{ request: true \}\);\s*return \{ ok: false,[^}]*status: why\.status, error: why\.error/);
    }
    // 관리자 일괄 경로 셋(미발송 일괄 발송·재발송·멈춤 복구)은 한 함수(blockedForNoSendClass)를 지난다.
    expect(BATCH).toContain("isSendClassRouteRow(settings"); // = classRouteActive + 수학(send-class.ts)
    expect(BATCH.match(/blockedForNoSendClass\(user\.tenantId/g)?.length).toBe(3);
    // 대량 작성(sendBulkAdminReports)도 같은 게이트.
    expect(COMPOSE).toContain("blockedForNoSendClass(user.tenantId, routeRows.map(sendClassRow), gateOut)");
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

  it("🔴 정규 보고서는 보고서 반으로만 — '보낼 반' 후보를 세우지 않는다(원장 결정 4)", () => {
    for (const src of [ONESCREEN, COMPOSE]) expect(src).not.toContain("needsSendClass(");
    expect(ONESCREEN).not.toContain("classnoteClassId ?? null,"); // 강사가 고른 '보낼 반'을 따로 받던 길(C1)
  });

  it("🔴 보강 추가한 반(makeup_class_id)이 먼저 — 원스크린·관리자 직접 작성·일괄 게이트·워커가 모두 본다(원장 2026-09-30)", () => {
    // 원스크린 = saveLessonReport가 확인해 **저장한** 앵커(클라 값을 그대로 믿지 않는다 — prepareMakeupAnchor → acceptMakeupAnchor)
    expect(ONESCREEN).toContain("resolveMakeupSendClass(user.tenantId, input.studentId, reportDate, input.subject, saved.makeupClassId ?? null)");
    expect(ONESCREEN).toContain("prepareMakeupAnchor(supabase, {");
    expect(ONESCREEN).toContain("makeup_class_id: makeupAnchor,");
    // 🔴 '보낼 반'은 앵커의 복사본 — 저장이 같은 값으로 적는다(따로 고른 반을 적는 길 없음)
    expect(ONESCREEN).toContain("{ classnote_class_id: makeupAnchor }");
    expect(ONESCREEN).not.toContain("update({ classnote_class_id: pick.classId })");
    // 관리자 직접 작성 = 같은 앵커 함수 + 반 고르기 재료는 저장된 앵커
    expect(COMPOSE).toContain("prepareMakeupAnchor(supabase, {");
    expect(COMPOSE).not.toContain("update({ classnote_class_id: pick.classId })");
    expect(COMPOSE.match(/reportMakeupClassId\(user\.tenantId/g)?.length).toBe(1);
    const server = read("src/features/onescreen/server/send-class.ts");
    expect(server).toContain("decideSendClass(");
    expect(server).toContain('.select("id, classnote_class_id, makeup_class_id, classnote_sent_at")'); // 일괄 게이트
    expect(server).toContain("sendClassGateRow(");
    expect(server).toContain('.is("classnote_sent_at", null)'); // 게시된 행의 '보낼 반'을 덮지 않는다
    // 일괄 경로 넷 모두 적은 행을 감사로그에
    expect(BATCH.match(/makeupRewritten/g)?.length).toBe(3);
    expect(COMPOSE).toContain("makeupRewritten");
    const core = read("scripts/_classnote/classnote-core.mjs");
    expect(core).toContain("lr.makeup_class_id");
    expect(core).toContain("makeupEligible");
    // 보강 반 조회 실패는 "대상"(아래 대상 확정이 재시도로 드러낸다 — 막힌 것으로 영구 실패시키지 않는다) · '보낼 반'은 게시 뒤에만, 비어 있을 때만 적는다
    expect(core).toContain("isClassRouteEligible(sql, tenant, r.makeup_class_id, r.student_id).catch(() => true)");
    // 🔴 막힌 행(보드 없음·보낼 반 ≠ 보강 반·반 미정)은 1인 보드로 흘리지 않고 failed + 한국어 사유
    expect(core).toContain('if (pick.route === "blocked") {');
    expect(core).toContain("ROUTE_BLOCKED_MESSAGE[pick.reason]");
    expect(core).toContain("and classnote_class_id is null");
    // 회수 = 보고서 반·보낼 반·보강 반 전부
    const recall = read("scripts/_classnote/classnote-recall-core.mjs");
    expect(recall).toContain("select classnote_class_id, makeup_class_id from lesson_reports");
    expect(recall).toContain("classLocs,");
  });

  it("🔴 다른 반으로 갈 때는 경고와 함께 묻는다 — 화면이 경고 재료를 받는다", () => {
    expect(ONESCREEN).toContain("makeupClassName: pick.makeupClass?.name || null");
    expect(COMPOSE).toContain("makeupClassName: pick.makeupClass?.name || null");
    const dialog = read("src/features/onescreen/components/send-class-dialog.tsx");
    expect(dialog).toContain('"os.sendClass.makeupMismatch"');
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

  it("관리자 직접 작성은 고른 반을 **보강 반**으로 받는다 — 서버가 같은 함수(acceptMakeupAnchor)로 다시 확인한다", () => {
    expect(COMPOSE).toContain("wanted: input.makeupClassId ?? input.classnoteClassId ?? null,");
    expect(COMPOSE).toContain("export async function getAdminSendClassOptions(");
  });
});
