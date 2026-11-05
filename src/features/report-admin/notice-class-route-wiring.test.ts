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
      ["src", "features", "report-admin", "server", "prepare-class-notice.ts"],
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
    const app = read("src", "features", "report-admin", "server", "notice-class-route.ts");
    // 판정할 발송 PC가 있고 **전부** 알아야 한다(켜진 워커 전부 · 없으면 가장 최근 워커)
    expect(app).toContain("const poolSupports = (pool: readonly unknown[], supports: (raw: unknown) => boolean) => pool.length > 0 && pool.every(supports);");
    expect(app).toContain("return poolSupports(await postingWorkerPool(supabase), workerSupportsNoticeClassRoute);");
    expect(app).toContain("const mathOn = wantMath && poolSupports(pool, workerSupportsNoticeClassRoute);");
  });
});

describe("영어 개별 공지 — 반 방 경로(원장 2026-11-04 · 1인 보드 배정 금지 뒤)", () => {
  const app = read("src", "features", "report-admin", "server", "notice-class-route.ts");
  const core = read("scripts", "_classnote", "classnote-notice-core.mjs");
  const route = read("scripts", "_classnote", "notice-class-route.mjs");
  it("🔴 연동 PC가 `noticeEnglishRoom`을 알릴 때만 영어 대상에 반을 싣는다(옛 워커는 영어 반을 수학 반 보드로 보고 실패시킨다)", () => {
    expect(read("scripts", "_classnote", "watch-classnote-queue.mjs")).toMatch(/WORKER_CAPS = \{[^}]*noticeEnglishRoom: true/);
    expect(app).toContain("const englishOn = wantEnglish && poolSupports(pool, workerSupportsNoticeEnglishRoom);");
    // 영어 대상의 반은 워커의 분기 표식(subject)과 함께 싣는다 · 반 방이 없거나 반을 못 정하면 지금처럼 1인 보드(rest)
    expect(app).toContain("subject: ENGLISH_NOTICE_SUBJECT,");
    expect(app).toContain('if (pick?.route !== "room") {');
    expect(app).toContain("englishPersonal.add(c.studentId);");
  });
  it("두 과목의 삼자 일치 재료는 한 벌이다(학생 다리 · 선생님 다리)", () => {
    const english = read("src", "features", "report-admin", "server", "notice-english-route.ts");
    for (const code of [app, english]) {
      expect(code).toContain("attendingClassesOf(await studentLegQuery(admin, tenantId, studentIds), date)");
      expect(code).toContain("...teacherLegQueries(admin, tenantId, classIds, teacherIds, date),");
      expect(code).toContain("teachersByClass({ classes:");
    }
  });
  it("워커 — 영어 반 방 대상은 반 보드 분기 안에서 대상 확정만 달리하고, 같은 게시·교차 확인 코드를 탄다(1인 보드로 떨어지지 않는다)", () => {
    const head = core.slice(core.indexOf("export async function processTarget"));
    const branch = head.slice(head.indexOf("if (isClassRouteTarget(target)) {"), head.indexOf("ctx.boardByNorm.get(norm(target.board))"));
    expect(branch.indexOf("if (classRouteHaltReason())")).toBeLessThan(branch.indexOf("resolveNoticeEnglishTarget("));
    expect(branch).toContain("const resolved = isEnglishRoomTarget(target)");
    expect(branch.indexOf("resolveNoticeEnglishTarget(")).toBeLessThan(branch.indexOf("await postToChildren("));
  });
  it("워커 — 영어 반 방의 원아는 영어 보고서와 같은 함수로 고른다(원아 연결 ∩ 지금 그 방 · 이름으로 찾지 않는다)", () => {
    expect(route).toContain(
      'import { ENGLISH_ROUTE_SUBJECTS, englishBlockedMessage, loadEnglishClassBoard, resolveEnglishClassTargets } from "./english-class-route.mjs";',
    );
    const fn = route.slice(route.indexOf("export async function resolveNoticeEnglishTarget"));
    expect(fn).toContain("await loadEnglishClassBoard(sql, tenant, classId)");
    expect(fn).toContain("await resolveEnglishClassTargets(sql, page, { tenant, centerId, board, studentId })");
    expect(fn).not.toMatch(/resolveBoardChildEnrollments|fetchChildren|childKeys|boardByNorm/);
  });
});

describe("반 공지 이미지 — 옛 발송 PC가 글만 올리는 것을 막는다", () => {
  it("워커가 지원한다고 알리고(caps), 앱은 큐를 집을 수 있는 발송 PC가 전부 지원할 때만 이미지를 받는다", () => {
    expect(read("scripts", "_classnote", "watch-classnote-queue.mjs")).toMatch(/WORKER_CAPS = \{[^}]*classNoticeImages: true/);
    const action = read("src", "features", "report-admin", "server", "class-notice-actions.ts");
    expect(action).toContain("pool.every((w) => workerSupportsClassNoticeImages(w.raw))");
    expect(action).toContain("const gate = await classNoticeImageGate(");
    // 발송 표식이 없는 옛 판도 센다(명시적 dry-run만 뺀다) · 이미지 판정은 경로로만
    expect(action).toContain(".postMode === false");
    expect(action).not.toContain(".postMode === true");
    expect(action).toContain("images.some((a) => !isImageAttachment(a.path))");
  });
  it("워커 — 이미지는 가드·중복 확인을 통과한 뒤에 올리고, 준비가 안 되면 그 반엔 게시하지 않는다", () => {
    const core = read("scripts", "_classnote", "classnote-class-notice-core.mjs");
    const body = core.slice(core.indexOf("async function sendToBoard("), core.indexOf("export async function sendClassNoticeRow("));
    const at = (needle: string) => {
      const i = body.indexOf(needle);
      expect(i, needle).toBeGreaterThan(-1);
      return i;
    };
    expect(at("if (!guard.ok) return")).toBeLessThan(at("const dup = before.find(same);"));
    expect(at("const dup = before.find(same);")).toBeLessThan(at("await prepareImages()"));
    expect(at("if (!media.ok) return { ok: false")).toBeLessThan(at("await postNotice("));
    // 이미지 공지의 중복은 **이 행이 올린 공지**일 때만 성공으로 넘긴다(장수만 세면 바꾼 이미지를 못 가린다)
    expect(at("if (has !== null && has >= imageCount && ownNoticeIds.has(Number(dup.id))) return { ok: true")).toBeLessThan(at("await prepareImages()"));
    // 이미지 목록을 못 받으면 한 반에도 올리지 않는다 · 결과는 호출부 배열에 반마다 쌓는다
    expect(core).toContain("for (const n of names) results.push({ ...n, ok: false, note: fetched.error });");
    expect(core).toContain("await sendClassNoticeRow(page, sql, row, { tenant, centerId, authorName: DEFAULT_AUTHOR_NAME, log, base, results, onProgress });");
    // 진행 기록 — 집을 때 앞선 시도의 결과를 함께 읽고, 반마다 큐 행에 적는다
    expect(core).toContain("returning c.id, c.title, c.body, c.targets, c.is_test, c.results`");
    expect(core).toContain("set results=${sql.json(list)} where id=${row.id} and status='processing'");
  });
  it("내부 라우트 — 시크릿 게이트 · 공지가 없으면 404(빈 목록으로 얼버무리지 않는다) · 서명 전 장수를 함께 준다", () => {
    const route = read("src", "app", "api", "internal", "class-notice-attachments", "[noticeId]", "route.ts");
    expect(route).toContain('authorizeInternalWorker(request.headers.get("x-eywa-internal"))');
    expect(route).toContain('notice.tenant_id !== worker.tenantId');
    expect(route).toContain('{ error: "notice_not_found" }, { status: 404 }');
    expect(route).toContain("expected: list.length, missing");
    expect(route).toContain('"report_attachment", notice.tenant_id as string');
  });
  it("화면 — 보내는 중에는 첨부를 못 건드리고, 업로드가 끝나면 그 시점의 목록에 합친다(지운 이미지가 되살아나지 않게)", () => {
    expect(read("src", "features", "onescreen", "components", "notice-class-composer.tsx")).toContain("disabled={busy}");
    expect(read("src", "app", "(shell)", "lesson-reports", "_components", "class-notice-panel.tsx")).toContain("disabled={busy}");
    const picker = read("src", "features", "onescreen", "components", "notice-attachment-picker.tsx");
    expect(picker).toContain("const now = latest.current;");
    expect(picker).not.toContain("onChange([...attachments, ...added])");
  });
});

describe("화면 — 반 공지와 개별 공지를 섞지 않는다", () => {
  it("원스크린 반 공지 작성부에는 학생별 내용 칸이 없다(반 공지는 그 반 학부모 모두가 본다) · 이미지는 전 반 공통 한 벌뿐", () => {
    const code = read("src", "features", "onescreen", "components", "notice-class-composer.tsx");
    expect(code).toContain("sendClassWideNotice(");
    // 학생별 내용·학생별 첨부(요청서 이미지)는 원생 개별 공지로만 나간다
    expect(code).not.toMatch(/sendOnescreenNotice|individualBody|studentAttachments|perStudent/);
    // 이미지(2026-10-03) = 공통 한 벌 · 올리는 중에는 보내지 못한다(올리던 이미지가 빠진 채 나가지 않게)
    expect(code.match(/<NoticeAttachmentPicker/g)?.length).toBe(1);
    expect(code).toContain("const ready = !!title.trim() && !!body.trim() && !busy && !uploading;");
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
