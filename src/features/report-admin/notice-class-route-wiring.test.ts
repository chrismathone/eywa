/**
 * 공지의 반 보드 경로 **배선 가드**(원장 2026-10-02 *"배선이 철저해야 오발송 일어나지 않음"*).
 *
 * 수학 개별 공지·교재요청서는 세 표면에서 나간다(원스크린 강사 공지 · 사무실 '반 공지' 탭의 원생 개별 공지 · 교재요청서).
 * 표면마다 따로 보낼 곳을 정하면 한 곳만 옛 1인 보드로 남는다([[#77]]) — 그래서 **한 함수**(`routeNoticeCandidates`)를 지나는지,
 * 워커가 반 보드 경로에서 1인 보드로 되돌아가지 않는지, 반 공지 화면에 개인 내용 칸이 없는지를 소스로 잠근다.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NOTICE_SKIP_LABEL } from "./notice-targets";

const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8").replace(/\r\n/g, "\n");

describe("앱 — 보낼 반은 한 함수가 정한다", () => {
  it("원스크린 강사 공지·사무실 원생 개별 공지가 routeNoticeCandidates를 지나고, 반 보드 대상을 이름 가드 뒤에 합친다", () => {
    for (const file of [
      ["src", "features", "onescreen", "server", "notice-actions.ts"],
      ["src", "features", "report-admin", "server", "notice-actions.ts"],
    ]) {
      const code = read(...file);
      expect(code, file.join("/")).toContain("await routeNoticeCandidates({");
      // 기존 1인 보드 경로에는 반 보드로 못 간 나머지(rest)만 넘긴다 — 수학 학생이 두 경로로 두 번 나가지 않게.
      expect(code, file.join("/")).toContain("resolveNoticeTargets(routed.rest, settings.report.classnoteSubjects)");
      expect(code, file.join("/")).toContain("targets = [...routed.classTargets, ...survivors]");
      // 판정 실패는 발송을 막는다(조용히 옛 경로로 보내지 않는다).
      expect(code, file.join("/")).toContain("보낼 반을 확인하지 못해 발송하지 않았습니다");
    }
  });
  it("교재요청서는 공지 레일로 보내고(따로 대상을 만들지 않는다), 사무실이 대신 보낼 때의 주인을 넘긴다", () => {
    const code = read("src", "features", "billing", "server", "textbook-notice-actions.ts");
    expect(code).toContain("await sendOnescreenNotice({ body: textbookNoticeCommon(ment), students, attachments: common, teacherIdsByStudent })");
    // 미리 보기(어느 반 보드로 가는지)와 실제 발송이 같은 판정 함수를 쓴다.
    expect(code).toContain("await resolveNoticeClasses(");
    expect(code).not.toMatch(/from\("classnote_notices"\)[\s\S]{0,80}\.insert\(/);
  });
  it("🔴 교재요청서의 '발송함' 표식은 실제로 큐에 오른 학생의 요청서에만 남긴다 — 제외된 학생은 다시 보낼 수 있어야 한다", () => {
    const code = read("src", "features", "billing", "server", "textbook-notice-actions.ts");
    expect(code).toContain("const queuedStudents = new Set(res.queuedStudentIds ?? []);");
    expect(code).toContain("const linkedIds = sendableRows.filter((r) => r.student_id && queuedStudents.has(r.student_id)).map((r) => r.id);");
    expect(code).not.toContain("const linkIds = [...sendableIds];");
    expect(read("src", "features", "onescreen", "server", "notice-actions.ts")).toContain("queuedStudentIds: targets.map((t) => t.studentId).filter(Boolean),");
  });
  it("강사 본인 발송만 선생님 다리가 문이다(남의 반 보드로 못 보낸다)", () => {
    const code = read("src", "features", "onescreen", "server", "notice-actions.ts");
    expect(code).toContain("teacherStrict: !!teacherId");
    // 사무실이 대신 보낼 때의 주인은 모양을 검증해 받는다(클라가 넣을 수 있는 인자 — 배열·UUID만).
    expect(code).toContain("teacherIds: teacherId ? [teacherId] : senderTeachers(input.teacherIdsByStudent, stu.id)");
  });
  it("제외 사유는 전부 한글 문구가 있다(raw 코드 노출 금지)", () => {
    for (const reason of ["subject_off", "name_collision", "no_name", "no_class_board", "not_my_class"] as const)
      expect(NOTICE_SKIP_LABEL[reason]).toMatch(/[가-힣]/);
    expect(read("src", "app", "(shell)", "textbook-requests", "_send-targets.tsx")).toContain("...NOTICE_SKIP_LABEL,");
  });
});

describe("워커 — 반 보드 경로는 1인 보드로 되돌아가지 않는다", () => {
  const core = read("scripts", "_classnote", "classnote-notice-core.mjs");
  it("classId가 실린 타깃은 대상 확정에 실패하면 그 자리에서 실패로 끝난다(1인 보드 조회보다 앞)", () => {
    const head = core.slice(core.indexOf("export async function processTarget"));
    const classBranch = head.indexOf("if (isClassRouteTarget(target)) {");
    const personal = head.indexOf("ctx.boardByNorm.get(norm(target.board))");
    expect(classBranch).toBeGreaterThan(-1);
    expect(personal).toBeGreaterThan(classBranch);
    const branch = head.slice(classBranch, personal);
    expect(branch).toContain("if (!resolved.ok) return { board: target.board, ok: false, note: resolved.note };");
    expect(branch).toContain("await postToChildren(");
    // 비상 정지 중이면 대상 확정도 하지 않는다 · 올린 뒤에는 교차 확인 재료를 남긴다
    expect(branch.indexOf("if (classRouteHaltReason())")).toBeLessThan(branch.indexOf("resolveNoticeClassTarget("));
    expect(branch).toContain("ctx.classPosts.set(resolved.boardId, post);");
    // 대상 원아는 **올리기 전에** 적는다(게시 확인에 실패해도 제 글을 샌 글로 세지 않게) · 기준선은 올리기 전에 읽는다
    expect(branch.indexOf("post.targeted.add(")).toBeLessThan(branch.indexOf("await postToChildren("));
    expect(branch.indexOf("await snapshotChildReports(")).toBeLessThan(branch.indexOf("await postToChildren("));
  });
  it("게시 뒤 교차 확인을 돌리고(대상이 아닌 원아에게 보이면 정지), 수업보고서와 같은 정지 표식을 쓴다", () => {
    expect(core).toContain("const leak = await crossCheckNoticeBoards(page, { centerId, classPosts: ctx.classPosts, leakAlert: ctx.leakAlert, log })");
    // 새었으면 '발송 완료'로 두지 않는다(초록 상태만 보고 지나치지 않게)
    expect(core).toContain('const status = okCount === 0 ? "failed" : okCount === results.length && !leak ? "success" : "partial";');
    expect(core).toContain('haltClassRoute("공지 교차 확인 이상");');
    const sender = read("scripts", "_classnote", "classnote-core.mjs");
    expect(sender).toContain("if (classRouteHalted || classRouteHaltReason()) {");
    expect(sender).toContain('haltClassRoute("수업보고서 교차 확인 이상");');
  });
  it("대상 확정은 수업보고서 반 보드 경로와 같은 함수 — 원아를 이름으로 찾지 않는다", () => {
    const route = read("scripts", "_classnote", "notice-class-route.mjs");
    expect(route).toContain('import { isClassRouteEligible, resolveClassTargets } from "./classnote-class-route.mjs"');
    expect(route).not.toMatch(/resolveBoardChildEnrollments|fetchChildren|childKeys/);
  });
  it("워커가 이 기능을 지원한다고 알린다(앱은 이 값이 있을 때만 반 보드 경로로 큐에 싣는다)", () => {
    expect(read("scripts", "_classnote", "watch-classnote-queue.mjs")).toMatch(/WORKER_CAPS = \{[^}]*noticeClassRoute: true/);
    expect(read("src", "features", "report-admin", "server", "notice-class-route.ts")).toContain("live.every((w) => workerSupportsNoticeClassRoute(w.raw))");
  });
});

describe("화면 — 반 공지와 개별 공지를 섞지 않는다", () => {
  it("원스크린 반 공지 작성부에는 학생별 내용·첨부 칸이 없다(반 공지는 그 반 학부모 모두가 본다)", () => {
    const code = read("src", "features", "onescreen", "components", "notice-class-composer.tsx");
    expect(code).toContain("sendClassWideNotice(");
    expect(code).not.toMatch(/sendOnescreenNotice|individualBody|NoticeAttachmentPicker/);
    // 보낼 반은 지금 보이는 목록 안에서 고른 것만
    expect(code).toContain("const picked = classes.filter((c) => checked.has(c.id));");
  });
  it("토글은 반 공지를 보낼 수 있는 반이 있을 때만 보이고, 기본은 원생 개별 공지다", () => {
    const code = read("src", "features", "onescreen", "components", "notice-composer.tsx");
    expect(code).toContain('useState<"each" | "class">("each")');
    expect(code).toContain("if (!cancelled && cw?.ok && cw.classes?.length) setClassWide(");
    expect(code).toContain("const modeToggle = classWide ? (");
    // 받을 반은 미리 골라 두지 않는다(강사가 직접 누른 반에만) · 제외된 학생과 사유를 화면에 남긴다
    expect(code).not.toContain("seedClassIds");
    expect(read("src", "features", "onescreen", "components", "notice-class-composer.tsx")).toContain("useState<Set<string>>(new Set())");
    expect(code).toContain("setLastSkipped(res.skipped ?? []);");
    expect(code).toContain("t(SKIP_KEY[s.reason]");
    // 🔴 제외된 학생이 있으면 부모에게 끝났다고 알리지 않는다 — 부모가 화면을 새로 그려 방금 띄운 제외 목록이 사라진다
    expect(code).toContain("if (!(res.skipped?.length)) onSent?.();");
    // 공지 단위 사유(교차 확인 이상 등)는 강사 이력·사무실 이력 둘 다 항상 빨갛게 보인다
    expect(code).toContain('{r.error ? <p className="text-danger mt-0.5 text-xs break-keep">{r.error}</p> : null}');
    expect(read("src", "app", "(shell)", "lesson-reports", "_components", "notice-face.tsx")).toContain('<span className="text-danger mt-0.5 block text-xs break-keep" title={r.error}>');
  });
});
