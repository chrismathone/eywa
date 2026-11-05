"use server";

// 원스크린 강사 공지 발송 — 선택 학생(들)에게 ClassNote 개별 보드로 **독립 공지**를 게시(classnote_notices).
// 반 공지(report-admin/sendClassNotice)와 같은 레일·워커(POST /api/v1_2/reports/)지만 **강사 스코프**(본인 담당
// 활성 수강생만, 겸직 강사뷰 포함)로 인가하고 카드=1명·표=N명을 지원. 공지는 lesson_reports(수업 보고서)와
// **별개 글**이라 실보고서와 공존·누적한다(같은 날 보고서 + 공지 = 게시판에 글 2개).
//
// ⚠️ 안전(적대검증 반영):
// - 학원 **전체** 동명이인 가드(hasClassnoteNameCollision) — resolveNoticeTargets의 배치-로컬 동명이인 검사만으론
//   배치 밖 동명이인(다른 반 김민수)을 못 잡아 엉뚱한 보드로 갈 수 있음. 보고서 발송 경로와 동일 강도로 재검.
// - 개인화 태그는 서버에서 학생별로 치환해 targets[].body에 넣는다. 대상 매칭에는 원본 이름·학생 ID를 유지한다.
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPagedInChunks, fetchInChunks } from "@/lib/supabase/batch";
import { getTenantSettings } from "@/features/owner/server/queries";
import { effectiveTeacherId, readonlyTeacherViewError } from "@/lib/auth/view-mode";
import { hasClassnoteNameCollision } from "./scope";
// 담당 반 판정 단일 소스(담당 반 ∪ 그날 위임 반) — classes.teacher_id를 직접 비교하지 말 것(0173a).
import { getTeachingClassIds } from "@/features/classes/server/delegation";
import { resolveNoticeTargets, type NoticeSkip, type NoticeTarget } from "@/features/report-admin/notice-targets";
import { logAction } from "@/features/audit/server/log";
import {
  flattenNoticeReportLinks,
  noticePostedActions,
  resultsForRetryRevoke,
  type NoticeReportLink,
} from "../notice-links";
import { isTenantReportAttachmentPath } from "@/lib/storage/legacy-audio-path";
import {
  hasNoticeTargetAttachments,
  noticeAttachmentOverflow,
  NOTICE_ATTACHMENT_INPUT_MAX,
  NOTICE_ATTACHMENT_MAX,
  sanitizeNoticeAttachments,
  type NoticeAttachment,
} from "../notice-attachments";
import { humanizeDbError } from "@/lib/supabase/db-error";
import { classnoteModuleOn, classnoteSendOn } from "@/features/owner/classnote-gate";
// 수학 개별 공지의 반 보드 경로(삼자 일치) — 세 발송 표면이 같이 쓰는 한 벌.
import { routeNoticeCandidates, type RoutedCandidate } from "@/features/report-admin/server/notice-class-route";
import { fillNoticeTemplate, hasNoticeTemplateTags, noticeTemplateError, NOTICE_BODY_MAX } from "../notice-template";

const BODY_MAX = NOTICE_BODY_MAX;
// 학원이(테스트 학생) 고정 타깃 — 실 학부모에게 안 가는 검증 경로(반 공지 TEST_TARGET과 동일 관례).
const TEST_TARGET = { studentName: "학원이", board: "(수학)학원이" };

export type OnescreenNoticeInput = {
  body: string; // 공통 내용(모든 대상 공통). 개별 내용이 없는 학생은 이 본문으로 발송.
  // (학생, 과목) — 과목이 보드 prefix 결정. individualBody = 그 학생에게만 공통 뒤에 덧붙일 개별 내용(선택).
  // attachments = 그 학생에게만 붙는 이미지(예: 학생별 교재요청서 PNG). 업로드가 끝난 {path,name,size}.
  // classId = 화면이 그 학생을 뽑은 반(선택) — 수학 반 보드 경로에서 **같은 선생님 반이 여럿일 때의 선택**으로만 쓴다.
  //   서버가 삼자 일치(보내는 선생님 – 반 – 학생)를 다시 판정하므로, 후보 밖의 반을 적어 보내도 무시된다.
  students: { studentId: string; subject: string | null; classId?: string | null; individualBody?: string; attachments?: NoticeAttachment[] }[];
  /**
   * studentId → 그 학생에게 보내는 선생님(교재요청서의 주인) — **사무실이 대신 보낼 때만** 쓰인다(강사 본인이 보내면 본인이 그 선생님이다).
   * 수학 반 보드 경로의 삼자 일치(선생님 – 반 – 학생)에 쓴다. 고르는 범위는 그 학생이 다니는 자기 반 보드 안이라 권한을 넓히지 않는다.
   */
  teacherIdsByStudent?: Record<string, string[]>;
  test?: boolean; // 학원이 1명에게만(파이프라인 검증)
  /**
   * 전원 공통 첨부(선택, 0130a) — 예: 교재 표지. 워커가 "공통 + 타깃별"을 합쳐 한 글에 올린다.
   * ⚠️ **0건이면 큐 행의 attachments 컬럼을 아예 건드리지 않는다** → 기존 공지 호출부(원스크린 공지 컴포저·
   * 반 공지)는 이 인자를 안 넘기므로 동작이 완전히 동일하다.
   */
  attachments?: NoticeAttachment[];
};

export type OnescreenNoticeResult = {
  ok: boolean;
  queued?: number;
  skipped?: NoticeSkip[];
  dryRun?: boolean;
  error?: string;
  /**
   * 적재된 공지 행 id — 호출부가 "이 글이 어디로 나갔는지"를 되짚어야 할 때 쓴다(교재요청 연결 0174a:
   * 삭제 시 학부모 글 되짚기 + 중복 발송 차단 표식). dry-run이면 적재를 안 하므로 없다.
   */
  noticeId?: string | null;
  /**
   * **실제로 큐에 오른 학생**(제외된 학생은 없다). 호출부가 "이 학생 것은 나갔다"를 적을 때는 반드시 이 목록으로 좁힌다 —
   * `ok:true`는 "한 명이라도 올랐다"일 뿐이라, 제외된 학생의 요청서까지 '발송함'으로 적으면 다시 보낼 길이 막힌다.
   */
  queuedStudentIds?: string[];
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** 클라가 넣을 수 있는 인자라 모양을 믿지 않는다 — 배열·UUID만, 학생당 5명까지. */
function senderTeachers(map: unknown, studentId: string): string[] {
  if (!map || typeof map !== "object" || Array.isArray(map)) return [];
  const list = (map as Record<string, unknown>)[studentId];
  return Array.isArray(list) ? list.filter((x): x is string => typeof x === "string" && UUID_RE.test(x)).slice(0, 5) : [];
}

/**
 * 강사 공지 발송 — 선택 (학생, 과목) 대상에게 같은 본문을 개별 보드로 게시.
 * 인가: effectiveTeacherId(실 강사 or 겸직 강사뷰) 있으면 그 강사 담당 활성수강생만, 없으면(관리자뷰) canWriteTenant.
 * 발송 스위치 OFF면 dry-run(적재 안 함). 게시는 연동 PC 워커가 classnote_notices 큐를 폴링해 처리.
 */
export async function sendOnescreenNotice(input: OnescreenNoticeInput): Promise<OnescreenNoticeResult> {
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  // 🔴 '다른 강사 뷰'(열람 전용) 차단 — 아래 게이트는 effectiveTeacherId(=열람 대상)가 있으면 통과라,
  //    이 가드가 없으면 관리자가 **그 강사 명의·스코프로** 학부모 공지를 내보낼 수 있다(외부 발신).
  const roError = await readonlyTeacherViewError();
  if (roError) return { ok: false, error: roError };
  const body = (input.body ?? "").trim(); // 공통 내용
  if (!body) return { ok: false, error: "공통 내용을 입력하세요" };
  if (body.length > BODY_MAX) return { ok: false, error: `공지가 너무 깁니다(최대 ${BODY_MAX}자)` };
  const templateError = noticeTemplateError(body);
  if (templateError) return { ok: false, error: templateError };

  const supabase = await createClient();
  const settings = await getTenantSettings();

  // ⚠️ 인가 게이트는 test 분기 **위**에서 한 번 — 예전엔 아래 else 블록 안에만 있어서 `test:true`로
  // 부르면 로그인만으로 통과했다(#77 "UI 조건은 게이트 아님": 원스크린 화면으로는 도달 불가여도
  // 서버액션 id는 클라 청크에 실려 직접 호출이 가능하다. 2026-07-22 전수검사).
  // 규칙은 아래 대상 해석과 동일 — 강사(겸직 포함)면 통과하고 그 담당 학생만, 아니면 쓰기 권한 필요.
  const teacherId = await effectiveTeacherId();
  if (!teacherId && !(await canWriteTenant(user.systemRole, "lesson_reports"))) {
    return { ok: false, error: "공지 발송 권한이 없습니다" };
  }

  // ── 1. 대상 (학생,과목) 후보 해석 + 강사 스코프 ──
  let targets: NoticeTarget[] = [];
  let skipped: NoticeSkip[] = [];
  const studentNames = new Map<string, string>();
  if (input.test) {
    // 탈원 테스트 학생이라 반 경로로 안 뽑힘 → 고정 타깃(보드 실존·실 학부모 없음). 동명이인 가드 불필요.
    targets = [{ studentId: "", studentName: TEST_TARGET.studentName, board: TEST_TARGET.board }];
    studentNames.set("", TEST_TARGET.studentName);
  } else {
    const students = (input.students ?? []).filter((s) => s.studentId);
    if (!students.length) return { ok: false, error: "대상 학생을 선택하세요" };
    const studentIds = [...new Set(students.map((s) => s.studentId))];

    // 강사 스코프(겸직 포함) — teacherId(위에서 해석) 있으면 그 강사 담당 활성수강생만,
    // 없으면 관리자뷰 = 위 게이트에서 canWriteTenant를 이미 통과했으므로 전체 허용.
    let allowedIds: Set<string>;
    if (teacherId) {
      // 담당 반 ∪ 오늘 위임받은 반(0173a) — 대체 수업을 맡은 강사도 그 학생들에게 공지를 보낼 수 있어야 한다.
      const { all: myClassIds } = await getTeachingClassIds(supabase, teacherId);
      if (!myClassIds.length) return { ok: false, error: "담당 반이 없습니다" };
      const enr = await fetchInChunks<{ student_id: string }>(studentIds, (chunk) =>
        supabase
          .from("enrollments")
          .select("student_id")
          .in("class_id", myClassIds)
          .is("end_date", null)
          .in("student_id", chunk),
      );
      allowedIds = new Set(enr.map((e) => e.student_id));
    } else {
      allowedIds = new Set(studentIds);
    }
    if (!allowedIds.size) return { ok: false, error: "담당 학생이 아닙니다" };

    const rows = await fetchInChunks<{
      id: string;
      name: string;
      classnote_name: string | null;
      status: string;
    }>([...allowedIds], (chunk) =>
      supabase.from("students").select("id, name, classnote_name, status").in("id", chunk),
    );
    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const row of rows) studentNames.set(row.id, row.name);
    const candidates: RoutedCandidate[] = [];
    for (const s of students) {
      if (!allowedIds.has(s.studentId)) continue;
      const stu = byId.get(s.studentId);
      if (!stu || stu.status !== "enrolled") continue; // 재원생만
      candidates.push({
        studentId: stu.id,
        name: stu.name,
        classnoteName: stu.classnote_name,
        subject: s.subject,
        hints: s.classId ? [s.classId] : [],
        // 선생님 다리 — 강사 본인이 보내면 본인. 사무실이 보내면 호출부가 알려 준 주인(교재요청서), 없으면 선생님 없는 발송.
        teacherIds: teacherId ? [teacherId] : senderTeachers(input.teacherIdsByStudent, stu.id),
        teacherStrict: !!teacherId, // 강사 본인 발송만 문 — 남의 반 보드로는 보내지 않는다
      });
    }
    // 🔴 수학은 **반 보드 경로**(원장 2026-10-02) — 삼자 일치로 반을 정해 그 반 보드의 그 학생 원아에게 1:1로. 맞는 반이 없으면 제외한다
    //    (1인 보드로 되돌리지 않는다). 영어는 그렇게 정한 반에 **반 방**이 이어져 있으면 반 방(2026-11-04), 없으면 지금처럼 1인 보드(rest).
    //    경로가 꺼져 있거나 연동 PC가 아직 못 하면 전원 기존 경로(rest). 조회 실패는 발송을 막는다.
    let routed: Awaited<ReturnType<typeof routeNoticeCandidates>>;
    try {
      routed = await routeNoticeCandidates({
        supabase,
        tenantId: user.tenantId,
        settings,
        candidates,
      });
    } catch (e) {
      console.error("[notice] 반 보드 경로 판정 실패", e instanceof Error ? e.message : e);
      return { ok: false, error: "보낼 반을 확인하지 못해 발송하지 않았습니다 — 잠시 뒤 다시 시도해 주세요" };
    }
    const resolved = resolveNoticeTargets(routed.rest, settings.report.classnoteSubjects);
    skipped = [...routed.skipped, ...resolved.skipped];

    // ⚠️ 학원 전체 동명이인 가드(적대검증 critical) — 배치 밖 동명이인이 있으면 엉뚱한 보드로 갈 수 있어 재검(청크 25).
    const survivors: NoticeTarget[] = [];
    for (let i = 0; i < resolved.targets.length; i += 25) {
      const slice = resolved.targets.slice(i, i + 25);
      const hits = await Promise.all(slice.map((t) => hasClassnoteNameCollision(supabase, t.studentId)));
      slice.forEach((t, j) => {
        if (hits[j]) skipped.push({ name: t.studentName, reason: "name_collision" });
        else survivors.push(t);
      });
    }
    // 반 보드 경로 대상은 이름 가드를 타지 않는다 — 원아를 이름으로 찾지 않고 0302a에 가드를 통과해 적힌 원아 번호로 올린다
    // (같은 반 동명이인은 그 표가 애초에 보류로 둔다 → 위에서 '반 보드 없음'으로 제외됐다). 영어 반 방 대상도 이름으로 찾지 않는다
    // (워커가 원아 연결 ∩ 지금 그 방 원아로 고른다 — 영어 보고서와 같은 함수).
    targets = [...routed.classTargets, ...survivors];
  }
  if (!targets.length) return { ok: false, error: "발송 가능한 학생이 없습니다", skipped };

  // ── 개별 내용 — 공통 뒤에 덧붙여 그 학생 target.body에만 저장. resolve·동명이인 가드 **이후** studentId lookup으로
  // 붙여 target↔student를 고정(오발송 방지). 개별 있는 학생만 personalized → 워커가 공유 보드(2가족+)엔 차단, 없으면 공통 발송.
  // 개별 **첨부**(학생별 요청서 PNG)도 같은 자리에서 같은 방식으로 붙인다 — 남의 요청서가 가는 사고 차단. ──
  if (!input.test) {
    const indiv = new Map<string, string>();
    const files = new Map<string, NoticeAttachment[]>();
    for (const s of input.students ?? []) {
      if (!s.studentId) continue;
      const t = (s.individualBody ?? "").trim();
      if (t) indiv.set(s.studentId, t);
      // 경로는 서버가 다시 검증(클라가 남의 파일 경로를 큐에 싣는 것 차단).
      // ⚠️ 여기서 상한(10)으로 자르지 않는다 — 넘치면 아래 overflow 가드가 **막는다**(조용히 자르면 누락 은폐).
      const atts = sanitizeNoticeAttachments(
        s.attachments,
        (p) => isTenantReportAttachmentPath(p, user.tenantId),
        NOTICE_ATTACHMENT_INPUT_MAX,
      );
      if (atts.length) files.set(s.studentId, atts);
    }
    if (indiv.size || files.size) {
      targets = targets.map((tg) => {
        const add = indiv.get(tg.studentId);
        const atts = files.get(tg.studentId);
        return {
          ...tg,
          ...(add ? { body: `${body}\n\n${add}` } : {}),
          ...(atts ? { attachments: atts } : {}),
        };
      });
    }
  }

  // 이름은 서버에서 읽은 학생 ID로 찾는다. ClassNote 보드명·동명이인 접미사는 발송 대상 판정용으로 그대로 둔다.
  const renderedTargets: NoticeTarget[] = [];
  for (const target of targets) {
    const source = target.body ?? body;
    const rendered = fillNoticeTemplate(source, {
      studentName: studentNames.get(target.studentId) ?? "",
      authorName: user.displayName,
    });
    if (!rendered.ok) return { ...rendered, skipped };
    renderedTargets.push(hasNoticeTemplateTags(source) ? { ...target, body: rendered.body } : target);
  }
  targets = renderedTargets;

  // 공통 첨부 — 0건이면 컬럼 자체를 안 건드린다(기존 호출부 무영향). 상한 판정은 아래 overflow 가드가 단독으로.
  const commonAttachments = sanitizeNoticeAttachments(
    input.attachments,
    (p) => isTenantReportAttachmentPath(p, user.tenantId),
    NOTICE_ATTACHMENT_INPUT_MAX,
  );

  // 한 글 상한 초과는 **조용히 자르지 않고 막는다** — 자르면 워커가 받는 목록엔 잘린 뒤 개수만 남아
  // 누락을 아무도 못 본다(학생 본인 요청서가 사라져도 '성공'으로 기록). 어느 학생이든 넘치면 거부.
  const worstOverflow = targets.reduce(
    (n, tg) => Math.max(n, noticeAttachmentOverflow(commonAttachments, tg.attachments)),
    0,
  );
  if (worstOverflow > 0)
    return {
      ok: false,
      error: `한 글에 올릴 수 있는 이미지는 최대 ${NOTICE_ATTACHMENT_MAX}장입니다 — 공통 이미지를 ${worstOverflow}장 줄여주세요`,
      skipped,
    };

  // ── 2. 발송 안전 스위치(기본 OFF) — dry-run이면 적재 안 함 ──
  if (!classnoteSendOn(settings)) return { ok: true, queued: 0, skipped, dryRun: true };

  const { data: inserted, error } = await supabase
    .from("classnote_notices")
    .insert({
      tenant_id: user.tenantId,
      body,
      targets,
      created_by: user.id,
      ...(commonAttachments.length ? { attachments: commonAttachments } : {}),
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: humanizeDbError(error.message, "발송 요청") };

  // 감사 로그 — '발송 대기(큐 적재)'(실제 게시는 워커, 완료 아님). best-effort.
  await logAction({
    action: "classnote_notice_send",
    targetType: "classnote_notice",
    targetLabel: `대상 ${targets.length}명`,
    metadata: {
      noticeId: inserted?.id ?? null,
      targetCount: targets.length,
      source: "onescreen",
      commonAttachments: commonAttachments.length,
      targetAttachments: targets.reduce((n, t) => n + (t.attachments?.length ?? 0), 0),
      // 반 보드·반 방으로 간 대상 수(나머지는 1인 보드) — 어느 경로로 나갔는지 기록에 남긴다. 그중 영어 반 방은 따로 센다.
      classRouteTargets: targets.filter((t) => t.classId).length,
      englishRoomTargets: targets.filter((t) => t.classId && t.subject === "english").length,
    },
  });

  return {
    ok: true,
    queued: targets.length,
    skipped,
    noticeId: inserted?.id ?? null,
    queuedStudentIds: targets.map((t) => t.studentId).filter(Boolean),
  };
}

export type NoticeStudent = {
  id: string;
  name: string;
  grade: string | null;
  className: string;
  subject: string | null; // 반 과목 키 — 보드 prefix 결정(발송 과목만 담기므로 항상 발송 가능한 값)
  classId?: string; // 그 학생을 뽑은 반 — 수학 반 보드 경로의 선택 힌트(서버가 삼자 일치로 다시 판정한다)
};

/**
 * **내 담당 학생 전체** — 공지 대상 후보(원장 요청 2026-07-23: "전체공지는 관리자가 아니라 강사가 내 담당학생에 대한").
 *
 * 컴포저의 기본 후보는 **그날 로스터**(오늘 수업하는 반)라 "휴강 안내"처럼 요일과 무관한 공지를 담당 전원에게
 * 보낼 방법이 없었다. 이 액션이 요일을 빼고 담당 반 전체 재원생을 돌려준다.
 *
 * 인가는 sendOnescreenNotice와 **같은 분기**(#77) — 강사(겸직 강사뷰 포함)면 본인 담당 반, 아니면 보고서 관리
 * 권한으로 학원 전체. 최종 인가는 발송 액션이 다시 하므로 여기서 새는 값이 곧바로 발송되진 않는다.
 *
 * ⚠️ **발송 과목(classnoteSubjects) 반만** 담는다 — 안 되는 학생을 후보에 세우면 "30명 선택"이라 해놓고
 *    발송 결과가 12명이 되어 숫자가 거짓말을 한다.
 */
export async function listMyNoticeStudents(): Promise<{
  ok: boolean;
  students?: NoticeStudent[];
  /** 실제로 담긴 범위 — 강사면 담당 반, 관리자뷰면 학원 전체. 화면 라벨이 거짓말하지 않게 그대로 알린다. */
  scope?: "teacher" | "tenant";
  error?: string;
}> {
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  const supabase = await createClient();
  const settings = await getTenantSettings();
  const allowed = settings.report.classnoteSubjects;

  const teacherId = await effectiveTeacherId();
  if (!teacherId && !(await canWriteTenant(user.systemRole, "lesson_reports")))
    return { ok: false, error: "공지 발송 권한이 없습니다" };
  const scope = teacherId ? ("teacher" as const) : ("tenant" as const);
  if (!allowed.length) return { ok: true, students: [], scope };

  const base = supabase
    .from("classes")
    .select("id, class_name, subject")
    .eq("is_active", true)
    .in("subject", allowed);
  // 강사 스코프는 담당 반 ∪ 오늘 위임 반(0173a) — 위 발송 게이트(allowedIds)와 **같은 소스**여야
  // "목록엔 뜨는데 보내면 거절"이 안 생긴다.
  const myIds = teacherId ? (await getTeachingClassIds(supabase, teacherId)).all : null;
  const { data: classes, error } = await (myIds ? base.in("id", myIds) : base).order("class_name");
  if (error) return { ok: false, error: humanizeDbError(error.message, "조회") };
  const classById = new Map((classes ?? []).map((c) => [c.id as string, c]));
  const classIds = [...classById.keys()];
  if (!classIds.length) return { ok: true, students: [], scope };

  // 활성 수강 — 반이 수십 개면 청크당 1000행에 근접한다(세는 데 쓰이므로 절단 금지, B2). order는 페이지 안정용 tie-break.
  const enr = await fetchAllPagedInChunks<{ id: string; class_id: string; student_id: string }>(
    classIds,
    (chunk, from, to) =>
      supabase
        .from("enrollments")
        .select("id, class_id, student_id")
        .in("class_id", chunk)
        .is("end_date", null)
        .order("id")
        .range(from, to),
  );
  const studentIds = [...new Set(enr.map((e) => e.student_id))];
  if (!studentIds.length) return { ok: true, students: [], scope };

  const rows = await fetchInChunks<{ id: string; name: string; grade: string | null; status: string }>(
    studentIds,
    (chunk) => supabase.from("students").select("id, name, grade, status").in("id", chunk),
  );
  const byId = new Map(rows.map((r) => [r.id, r]));

  // 학생 1명 = 대상 1건(첫 반) — 두 반을 들어도 보드는 하나라 중복 게시가 되면 안 된다.
  const seen = new Set<string>();
  const out: NoticeStudent[] = [];
  for (const e of enr) {
    if (seen.has(e.student_id)) continue;
    const s = byId.get(e.student_id);
    if (!s || s.status !== "enrolled") continue;
    const c = classById.get(e.class_id);
    if (!c) continue;
    seen.add(e.student_id);
    out.push({
      id: s.id,
      name: s.name,
      grade: s.grade,
      className: c.class_name as string,
      subject: (c.subject as string | null) ?? null,
      classId: c.id as string,
    });
  }
  out.sort((a, b) => a.className.localeCompare(b.className, "ko") || a.name.localeCompare(b.name, "ko"));
  return { ok: true, students: out, scope };
}

export type OnescreenNoticeRow = {
  id: string;
  body: string;
  targetCount: number;
  status: string;
  error: string | null;
  createdAt: string;
  processedAt: string | null;
  // 게시된 리포트 주소(회수용 워커가 캡처) + **학생 이름**(targets에서 되붙임) — 없으면 구버전/미게시
  reportLinks: NoticeReportLink[];
  canRevoke: boolean; // 게시취소 가능(게시됨/회수 일부 실패 + 캡처 id 있음 + 아직 안 지운 글이 남음)
  canEdit: boolean; // 게시본 제자리 수정 가능(게시됨 + 살아 있는 글)
};

/** 내가 보낸 공지 이력(20건) — 대기건 수정/삭제·게시건 게시취소 UI의 소스. created_by=본인만. */
export async function listMyOnescreenNotices(): Promise<{ ok: boolean; rows?: OnescreenNoticeRow[]; error?: string }> {
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("classnote_notices")
    .select("id, body, targets, status, results, error, created_at, processed_at")
    .eq("created_by", user.id)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) return { ok: false, error: humanizeDbError(error.message, "조회") };
  return {
    ok: true,
    rows: (data ?? []).map((r) => {
      const status = r.status as string;
      const links = flattenNoticeReportLinks(r.results, r.targets);
      // 게시취소 가능 = 게시됨(success/partial) 또는 회수 일부 실패 + 아직 안 지운 글이 남음(F2).
      // 제자리 수정 = 게시됨 + 살아 있는 글. 사무실 발송 이력과 같은 판정(noticePostedActions).
      const { canRevoke, canEdit } = noticePostedActions(status, r.results, r.targets);
      return {
        id: r.id as string,
        body: r.body as string,
        targetCount: Array.isArray(r.targets) ? r.targets.length : 0,
        status,
        error: r.error as string | null,
        createdAt: r.created_at as string,
        processedAt: r.processed_at as string | null,
        reportLinks: links,
        canRevoke,
        canEdit: canEdit && !hasNoticeTemplateTags(r.body as string),
      };
    }),
  };
}

/**
 * 게시된 공지에 손댈 수 있는 사람 — **보낸 본인** 또는 **사무실(수업보고서 쓰기 권한)**(F1, 2026-09-23 감사).
 * 사무실 발송 이력 화면은 "회수는 발송 이력에서"라고 안내하면서 정작 버튼이 없었다(쓴 본인만, 원스크린에서만).
 * 새 발송 경로가 아니다 — 같은 큐 상태(revoke_requested·edit_requested)를 같은 연동 PC 워커가 처리한다.
 * ⚠️ `canWriteTenant`는 '다른 강사 뷰'(열람 전용)에서 false라 그 화면에선 사무실 통로가 열리지 않는다.
 */
async function postedNoticeActor(
  createdBy: unknown,
  user: { id: string; systemRole: Parameters<typeof canWriteTenant>[0] },
): Promise<"owner" | "office" | null> {
  if (createdBy === user.id) return "owner";
  if (await canWriteTenant(user.systemRole, "lesson_reports")) return "office";
  return null;
}

/**
 * 게시취소(회수) — 게시된 공지의 실제 ClassNote 글을 삭제 요청(status='revoke_requested').
 * 연동 PC 워커가 저장된 리포트 id를 대조 후 DELETE(비동기). 본인(또는 사무실) + 게시됨 + 캡처 id 있을 때만.
 * **회수 일부 실패(revoke_partial)도 다시 요청할 수 있다**(F2) — 남은 글만 워커가 다시 지운다(이미 지운 글은 404 확인).
 * ⚠️ 캡처 id 없는 구버전 발송분은 회수 불가(워커가 지울 대상 정보 없음) — 명확 안내.
 */
export async function cancelOnescreenNotice(noticeId: string): Promise<MutateResult> {
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  if (!classnoteModuleOn(await getTenantSettings())) return { ok: false, error: "사용할 수 없는 기능입니다" };
  const supabase = await createClient();
  const { data: row } = await supabase
    .from("classnote_notices")
    .select("status, created_by, results, targets")
    .eq("id", noticeId)
    .maybeSingle();
  if (!row) return { ok: false, reason: "not_found", error: "공지를 찾을 수 없습니다" };
  const actor = await postedNoticeActor(row.created_by, user);
  if (!actor) return { ok: false, reason: "forbidden", error: "본인이 보낸 공지만 회수할 수 있습니다" };
  const status = row.status as string;
  if (status !== "success" && status !== "partial" && status !== "revoke_partial")
    return { ok: false, error: "게시 완료된 공지만 게시취소할 수 있습니다" };
  const links = flattenNoticeReportLinks(row.results, row.targets);
  if (!noticePostedActions(status, row.results, row.targets).canRevoke)
    return { ok: false, error: "회수할 게시글 정보가 없습니다(연동 PC 업데이트 전 발송분은 ClassNote 앱에서 직접 삭제)" };

  // 원자 전환(동시 회수 레이스 방지) — 지금 읽은 상태 그대로일 때만 바꾼다.
  // 재회수는 워커가 읽는 모양으로 results를 되돌려 같은 큐에 올린다(resultsForRetryRevoke 주석).
  const retry = status === "revoke_partial";
  let q = supabase
    .from("classnote_notices")
    .update({
      status: "revoke_requested",
      processing_at: null,
      ...(retry ? { results: resultsForRetryRevoke(row.results) } : {}),
    })
    .eq("id", noticeId)
    .eq("status", status);
  if (actor === "owner") q = q.eq("created_by", user.id);
  const { data } = await q.select("id");
  if (!data || data.length === 0) return explainZeroRows(supabase, noticeId, actor === "office" ? null : user.id);
  await logAction({
    action: "classnote_notice_revoke",
    targetType: "classnote_notice",
    targetLabel: retry ? "학부모 공지 게시취소(남은 글 다시)" : "학부모 공지 게시취소",
    metadata: {
      noticeId,
      reportCount: links.filter((l) => !l.revoked).length,
      ...(retry ? { retry: true } : {}),
      ...(actor === "office" ? { via: "admin_console" } : {}),
    },
  });
  return { ok: true };
}

/**
 * 게시된 공지 제자리 수정 — 게시된 글의 내용을 새 본문으로 교체 요청(status='edit_requested').
 * 연동 PC 워커가 저장된 리포트 id에 PATCH(비동기, 2026-07-14 학원이 실측 200). 본인 + 게시됨 + 캡처 id 있을 때만.
 * 개별 내용(targets[].body)은 스트립해 전원 새 공통으로 통일(일괄 정정). 캡처 id 없는 구버전은 앱에서 직접 수정 안내.
 */
export async function editPostedNotice(noticeId: string, newBody: string): Promise<MutateResult> {
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  if (!classnoteModuleOn(await getTenantSettings())) return { ok: false, error: "사용할 수 없는 기능입니다" };
  const body = (newBody ?? "").trim();
  if (!body) return { ok: false, error: "내용을 입력하세요" };
  if (body.length > BODY_MAX) return { ok: false, error: `공지가 너무 깁니다(최대 ${BODY_MAX}자)` };
  // 게시본 PATCH는 공통 본문 한 벌을 쓴다. 학생별 태그가 원문 그대로 게시되지 않도록 이 경로에서는 막는다.
  if (hasNoticeTemplateTags(body))
    return { ok: false, error: "태그를 사용하는 게시 공지는 게시취소한 뒤 다시 보내 주세요" };
  const supabase = await createClient();
  const { data: row } = await supabase
    .from("classnote_notices")
    .select("status, created_by, results, targets")
    .eq("id", noticeId)
    .maybeSingle();
  if (!row) return { ok: false, reason: "not_found", error: "공지를 찾을 수 없습니다" };
  const actor = await postedNoticeActor(row.created_by, user);
  if (!actor) return { ok: false, reason: "forbidden", error: "본인이 보낸 공지만 수정할 수 있습니다" };
  if (row.status !== "success" && row.status !== "partial")
    return { ok: false, error: "게시 완료된 공지만 제자리 수정할 수 있습니다" };
  const links = flattenNoticeReportLinks(row.results, row.targets);
  if (!links.some((l) => !l.revoked))
    return { ok: false, error: "수정할 게시글 정보가 없습니다(연동 PC 업데이트 전 발송분은 ClassNote 앱에서 직접 수정)" };
  // ⚠️ 개별 첨부(요청서 이미지)가 있는 공지는 일괄 수정 금지 — 아래에서 개별 **본문**만 지우므로,
  // 교재명·금액·계좌가 사라진 새 공통 본문에 **요청서 그림만 남는다**(학부모는 이미지 속 숫자만 보고 입금).
  if (hasNoticeTargetAttachments(row.targets))
    return {
      ok: false,
      error: "요청서 이미지가 붙은 공지는 내용만 바꿀 수 없습니다 — 게시취소한 뒤 다시 보내주세요",
    };

  const strippedTargets = Array.isArray(row.targets)
    ? (row.targets as Array<Record<string, unknown>>).map((t) => {
        const rest = { ...t };
        delete rest.body; // 개별 내용 제거 → 전원 새 공통으로 통일
        return rest;
      })
    : undefined;
  let q = supabase
    .from("classnote_notices")
    .update({ body, status: "edit_requested", processing_at: null, ...(strippedTargets ? { targets: strippedTargets } : {}) })
    .eq("id", noticeId)
    .in("status", ["success", "partial"]);
  if (actor === "owner") q = q.eq("created_by", user.id);
  const { data } = await q.select("id");
  if (!data || data.length === 0) return explainZeroRows(supabase, noticeId, actor === "office" ? null : user.id);
  await logAction({
    action: "classnote_notice_edit",
    targetType: "classnote_notice",
    targetLabel: "게시 공지 제자리 수정",
    metadata: {
      noticeId,
      posted: true,
      reportCount: links.filter((l) => !l.revoked).length,
      ...(actor === "office" ? { via: "admin_console" } : {}),
    },
  });
  return { ok: true };
}

// 대기(queued) 상태에서만 수정/삭제 — 워커가 집어(processing 이상)가면 불가. ownership=created_by(본인 공지만).
// 0행 = 이미 발송 처리됨/미소유/없음을 구분해 타입 결과로 반환(UI가 '게시취소'로 전환 유도). status='queued' 원자 가드로 레이스 방지.
type MutateResult = { ok: boolean; reason?: "already_sent" | "forbidden" | "not_found"; error?: string };

async function explainZeroRows(
  supabase: Awaited<ReturnType<typeof createClient>>,
  noticeId: string,
  /** 본인 소유를 따지는 경로면 그 사람 id — 사무실 경로(null)는 소유를 따지지 않는다. */
  userId: string | null,
): Promise<MutateResult> {
  const { data: row } = await supabase
    .from("classnote_notices")
    .select("status, created_by")
    .eq("id", noticeId)
    .maybeSingle();
  if (!row) return { ok: false, reason: "not_found", error: "공지를 찾을 수 없습니다" };
  if (userId !== null && row.created_by !== userId)
    return { ok: false, reason: "forbidden", error: "본인이 보낸 공지만 관리할 수 있습니다" };
  return {
    ok: false,
    reason: "already_sent",
    error: "이미 발송 처리되어 수정·삭제할 수 없습니다 — 게시된 공지는 게시취소를 이용하세요",
  };
}

/** 대기 공지 공통 내용 수정 — status='queued' + 본인만. 수정 시 개별 내용(targets[].body)은 스트립해 전원 공통으로 되돌림(일괄 정정). */
export async function editQueuedNotice(noticeId: string, newBody: string): Promise<MutateResult> {
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  if (!classnoteModuleOn(await getTenantSettings())) return { ok: false, error: "사용할 수 없는 기능입니다" };
  const body = (newBody ?? "").trim();
  if (!body) return { ok: false, error: "공통 내용을 입력하세요" };
  if (body.length > BODY_MAX) return { ok: false, error: `공지가 너무 깁니다(최대 ${BODY_MAX}자)` };
  const templateError = noticeTemplateError(body);
  if (templateError) return { ok: false, error: templateError };

  const supabase = await createClient();
  // 개별 내용 스트립 — 수정된 공통을 전원에게 적용(개별을 남기면 옛 공통이 붙은 채 남아 오해). status='queued'라 아직 미게시.
  const { data: cur } = await supabase
    .from("classnote_notices")
    .select("targets")
    .eq("id", noticeId)
    .eq("created_by", user.id)
    .eq("status", "queued")
    .maybeSingle();
  if (!cur) return explainZeroRows(supabase, noticeId, user.id);
  // 게시본 수정과 같은 이유 — 개별 첨부가 있으면 본문만 갈아끼울 수 없다(그림만 남은 글 방지).
  if (hasNoticeTargetAttachments(cur?.targets))
    return {
      ok: false,
      error: "요청서 이미지가 붙은 공지는 내용만 바꿀 수 없습니다 — 삭제한 뒤 다시 보내주세요",
    };
  const strippedTargets = Array.isArray(cur?.targets)
    ? (cur.targets as Array<Record<string, unknown>>).map((t) => {
        const rest = { ...t };
        delete rest.body; // 개별 내용 제거 → 공통으로 통일
        return rest;
      })
    : undefined;
  if (hasNoticeTemplateTags(body)) {
    if (!strippedTargets?.length) return { ok: false, error: "공지의 대상 학생을 확인하지 못했습니다" };
    const ids = [...new Set(strippedTargets.flatMap(t => typeof t.studentId === "string" && t.studentId ? [t.studentId] : []))];
    const students = await fetchInChunks<{ id: string; name: string }>(ids, chunk =>
      supabase.from("students").select("id, name").in("id", chunk),
    );
    const names = new Map(students.map(student => [student.id, student.name]));
    for (const target of strippedTargets) {
      const rendered = fillNoticeTemplate(body, {
        studentName: typeof target.studentId === "string" && target.studentId
          ? names.get(target.studentId) ?? ""
          : target.board === TEST_TARGET.board ? TEST_TARGET.studentName : "",
        authorName: user.displayName,
      });
      if (!rendered.ok) return rendered;
      target.body = rendered.body;
    }
  }
  const { data } = await supabase
    .from("classnote_notices")
    .update(strippedTargets ? { body, targets: strippedTargets } : { body })
    .eq("id", noticeId)
    .eq("created_by", user.id)
    .eq("status", "queued")
    .select("id");
  if (!data || data.length === 0) return explainZeroRows(supabase, noticeId, user.id);
  await logAction({
    action: "classnote_notice_edit",
    targetType: "classnote_notice",
    targetLabel: "대기 공지 수정",
    metadata: { noticeId },
  });
  return { ok: true };
}

/** 대기 공지 삭제 — status='queued' + 본인만(게시 전이라 학부모 미도달). */
export async function deleteQueuedNotice(noticeId: string): Promise<MutateResult> {
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  if (!classnoteModuleOn(await getTenantSettings())) return { ok: false, error: "사용할 수 없는 기능입니다" };
  const supabase = await createClient();
  const { data } = await supabase
    .from("classnote_notices")
    .delete()
    .eq("id", noticeId)
    .eq("created_by", user.id)
    .eq("status", "queued")
    .select("id");
  if (!data || data.length === 0) return explainZeroRows(supabase, noticeId, user.id);
  await logAction({
    action: "classnote_notice_delete",
    targetType: "classnote_notice",
    targetLabel: "대기 공지 삭제",
    metadata: { noticeId },
  });
  return { ok: true };
}
