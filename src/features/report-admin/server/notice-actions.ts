"use server";

// 반 공지 — eywa 반에서 학생을 골라 각 학생의 ClassNote 개별 보드로 일괄 게시(큐 적재까지만 담당).
// 실제 게시는 연동 PC 워커가 내부 API(POST /api/v1_2/reports/)로 처리. Edutrix NoticeWriteModal 패턴 계승.
import { getCurrentUser } from "@/lib/auth/current-user";
import { canAccessTenant, canWriteTenant } from "@/lib/auth/perm-matrix";
import { createClient } from "@/lib/supabase/server";
import { fetchInChunks } from "@/lib/supabase/batch";
import { getTenantSettings } from "@/features/owner/server/queries";
import { hasClassnoteNameCollision } from "@/features/onescreen/server/scope";
import { logAction } from "@/features/audit/server/log";
import { isTenantReportAttachmentPath } from "@/lib/storage/legacy-audio-path";
import {
  flattenNoticeReportLinks,
  boardStudentName,
  type NoticeReportLink,
} from "@/features/onescreen/notice-links";
import {
  noticeAttachmentOverflow,
  NOTICE_ATTACHMENT_INPUT_MAX,
  NOTICE_ATTACHMENT_MAX,
  sanitizeNoticeAttachments,
  type NoticeAttachment,
} from "@/features/onescreen/notice-attachments";
import { resolveNoticeTargets, type NoticeCandidate, type NoticeSkip, type NoticeTarget } from "../notice-targets";

export type NoticeClassOption = {
  id: string;
  name: string;
  subject: string | null;
  studentCount: number;
  // 반별 재원생 — 개별 내용 입력 UI가 학생별 박스를 그리는 데 사용(공통은 body, 개별은 이 학생들에게만).
  students: { id: string; name: string; grade: string | null }[];
};

/** 공지 대상 반 옵션 — 활성 반(발송 opt-in 과목만) + 재원생 수. 읽기 게이트(viewer 포함). */
export async function getNoticeClassOptions(): Promise<{ ok: boolean; classes?: NoticeClassOption[]; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  if (!(await canAccessTenant(user.systemRole, "lesson_reports"))) return { ok: false, error: "권한이 없습니다" };
  const settings = await getTenantSettings();
  const allowed = settings.report.classnoteSubjects;
  if (!allowed.length) return { ok: true, classes: [] };

  const supabase = await createClient();
  const { data: classes, error } = await supabase
    .from("classes")
    .select("id, class_name, subject")
    .eq("is_active", true)
    .in("subject", allowed)
    .order("class_name");
  if (error) return { ok: false, error: error.message };
  const ids = (classes ?? []).map((c) => c.id as string);
  // 반별 재원생 — 활성 수강 rows(선택 반 한정, 수백 행 규모). 학생 상태는 큐 적재 시 재검증.
  const enr = await fetchInChunks<{ class_id: string; student_id: string }>(ids, (chunk) =>
    supabase.from("enrollments").select("class_id, student_id").in("class_id", chunk).is("end_date", null),
  );
  // 학생 이름·학년 — 개별 내용 입력 UI가 학생별 박스를 그리려면 로스터가 필요(수백 행, 청크 분할).
  const studentIds = [...new Set(enr.map((e) => e.student_id))];
  const studentRows = await fetchInChunks<{ id: string; name: string; grade: string | null }>(studentIds, (chunk) =>
    supabase.from("students").select("id, name, grade").in("id", chunk),
  );
  const studentById = new Map(studentRows.map((s) => [s.id, s]));
  const rosterByClass = new Map<string, NoticeClassOption["students"]>();
  for (const e of enr) {
    const s = studentById.get(e.student_id);
    if (!s) continue;
    const list = rosterByClass.get(e.class_id) ?? [];
    list.push({ id: s.id, name: s.name, grade: s.grade });
    rosterByClass.set(e.class_id, list);
  }
  return {
    ok: true,
    classes: (classes ?? [])
      .map((c) => {
        const roster = rosterByClass.get(c.id as string) ?? [];
        return {
          id: c.id as string,
          name: c.class_name as string,
          subject: c.subject as string | null,
          studentCount: roster.length,
          students: roster,
        };
      })
      .filter((c) => c.studentCount > 0),
  };
}

const BODY_MAX = 4000;
/** 학원이(테스트 학생) 고정 타깃 — 실 학부모에게 안 가는 검증 경로(Edutrix 관리자 테스트 반 패턴). */
const TEST_TARGET = { studentName: "학원이", board: "(수학)학원이" };

/**
 * 반 공지 큐 적재 — 선택 반들의 재원생을 타깃으로 해석(resolveNoticeTargets: 과목 opt-in·동명이인 제외)
 * 후 classnote_notices에 1행 insert. 발송 스위치 OFF면 dry-run(적재 안 함). test=true면 반 선택 무시하고
 * 학원이 1명에게만(파이프라인 검증용).
 */
export async function sendClassNotice(input: {
  classIds: string[];
  body: string; // 공통 내용(선택 반 재원생 모두에게). 개별 내용이 없는 학생은 이 본문만.
  individual?: Record<string, string>; // studentId → 개별 내용(공통 뒤에 덧붙여 그 학생 보드에만)
  /** 전원 공통 이미지(0130a) — 워커가 각 글에 같이 올린다. 0건이면 컬럼을 아예 건드리지 않는다(기존 동작 보존). */
  attachments?: NoticeAttachment[];
  test?: boolean;
}): Promise<{ ok: boolean; queued?: number; skipped?: NoticeSkip[]; dryRun?: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "lesson_reports"))) return { ok: false, error: "공지 발송 권한이 없습니다" };
  const body = (input.body ?? "").trim();
  if (!body) return { ok: false, error: "공지 내용을 입력하세요" };
  if (body.length > BODY_MAX) return { ok: false, error: `공지가 너무 깁니다(최대 ${BODY_MAX}자)` };

  const supabase = await createClient();
  const settings = await getTenantSettings();

  // body?: 개별 내용을 담을 수 있음. 테스트 타깃은 studentId null이라 유니온.
  let targets: { studentId: string | null; studentName: string; board: string; body?: string }[] = [];
  let skipped: NoticeSkip[] = [];
  if (input.test) {
    // 테스트 학생은 탈원 처리라 반 해석 경로로 못 뽑힘 — 고정 타깃(보드·학부모 연결 실존 확인됨). 개별 내용 없음.
    targets = [{ studentId: null, ...TEST_TARGET }];
  } else {
    const classIds = (input.classIds ?? []).slice(0, 100);
    if (!classIds.length) return { ok: false, error: "대상 반을 선택하세요" };
    const { data: classes } = await supabase
      .from("classes")
      .select("id, subject")
      .in("id", classIds)
      .eq("is_active", true);
    const subjectByClass = new Map((classes ?? []).map((c) => [c.id as string, c.subject as string | null]));
    const enr = await fetchInChunks<{ class_id: string; student_id: string }>([...subjectByClass.keys()], (chunk) =>
      supabase.from("enrollments").select("class_id, student_id").in("class_id", chunk).is("end_date", null),
    );
    const studentIds = [...new Set(enr.map((e) => e.student_id))];
    const students = await fetchInChunks<{ id: string; name: string; classnote_name: string | null; status: string }>(
      studentIds,
      (chunk) => supabase.from("students").select("id, name, classnote_name, status").in("id", chunk),
    );
    const studentById = new Map(students.map((s) => [s.id, s]));
    const candidates: NoticeCandidate[] = [];
    for (const e of enr) {
      const s = studentById.get(e.student_id);
      if (!s || s.status !== "enrolled") continue; // 재원생만
      candidates.push({
        studentId: s.id,
        name: s.name,
        classnoteName: s.classnote_name,
        subject: subjectByClass.get(e.class_id) ?? null,
      });
    }
    const resolved = resolveNoticeTargets(candidates, settings.report.classnoteSubjects);
    skipped = resolved.skipped;

    // ⚠️ 학원 전체 동명이인 가드(원스크린 발송과 동일 강도) — resolveNoticeTargets는 배치-로컬 동명이인만 잡아
    // 배치 밖 동명이인(선택 안 한 반의 같은 이름)이면 엉뚱한 보드로 갈 수 있음. 개별 내용이 붙으면 오발송=개인정보
    // 사고라 재검(청크 25). 통과분만 발송.
    const survivors: NoticeTarget[] = [];
    for (let i = 0; i < resolved.targets.length; i += 25) {
      const slice = resolved.targets.slice(i, i + 25);
      const hits = await Promise.all(slice.map((t) => hasClassnoteNameCollision(supabase, t.studentId)));
      slice.forEach((t, j) => {
        if (hits[j]) skipped.push({ name: t.studentName, reason: "name_collision" });
        else survivors.push(t);
      });
    }
    targets = survivors;
  }
  if (!targets.length) return { ok: false, error: "발송 가능한 학생이 없습니다", skipped };

  // ── 개별 내용 — 공통 뒤에 덧붙여 그 학생 target.body에만 저장. 동명이인 가드 **이후** studentId lookup으로 붙여
  // target↔student를 고정(오발송 방지). 개별 있는 학생만 personalized → 워커가 공유 보드(2가족+)엔 자동 차단. ──
  if (!input.test && input.individual) {
    const indiv = new Map<string, string>();
    for (const [sid, txt] of Object.entries(input.individual)) {
      const t = (txt ?? "").trim();
      if (sid && t) indiv.set(sid, t);
    }
    if (indiv.size) {
      targets = targets.map((tg) => {
        const add = tg.studentId ? indiv.get(tg.studentId) : undefined;
        return add ? { ...tg, body: `${body}\n\n${add}` } : tg;
      });
    }
  }

  // 공통 첨부 — 경로는 서버가 다시 검증(클라가 남의 파일 경로를 큐에 싣는 것 차단). 0건이면 컬럼 미접촉.
  // ⚠️ 여기서 상한으로 자르지 않는다 — 넘치면 아래 가드가 **막는다**(조용히 자르면 누락을 아무도 못 본다).
  const commonAttachments = sanitizeNoticeAttachments(
    input.attachments,
    (p) => isTenantReportAttachmentPath(p, user.tenantId),
    NOTICE_ATTACHMENT_INPUT_MAX,
  );
  if (noticeAttachmentOverflow(commonAttachments, []) > 0)
    return {
      ok: false,
      error: `한 글에 올릴 수 있는 이미지는 최대 ${NOTICE_ATTACHMENT_MAX}장입니다`,
      skipped,
    };

  // 발송 안전 스위치 — OFF면 dry-run(큐 적재 안 함). 보고서 발송과 동일 스위치 공유.
  if (!settings.report.classnoteSendEnabled) return { ok: true, queued: 0, skipped, dryRun: true };

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
  if (error) return { ok: false, error: error.message };

  // 감사 로그 — '발송 대기(큐 적재)'(실제 게시는 연동 PC 워커). best-effort. source=class(반 공지 경로).
  await logAction({
    action: "classnote_notice_send",
    targetType: "classnote_notice",
    targetLabel: `대상 ${targets.length}명`,
    metadata: {
      noticeId: inserted?.id ?? null,
      targetCount: targets.length,
      source: "class",
      commonAttachments: commonAttachments.length,
    },
  });

  return { ok: true, queued: targets.length, skipped };
}

export type NoticeRow = {
  id: string;
  body: string;
  targetCount: number;
  status: string;
  /** 실패 표시용 — board는 보드명이라 화면에선 학생 이름(studentName)으로 보여준다. */
  results: { board: string; studentName: string; ok: boolean; note?: string }[] | null;
  /** 게시된 글 주소 + 학생 이름 — '#1 #2'로는 누구 글인지 알 수 없어 이름으로 되붙인다. */
  reportLinks: NoticeReportLink[];
  error: string | null;
  createdAt: string;
  processedAt: string | null;
};

/** 최근 공지 이력(20건) — 상태·타깃별 결과. */
export async function listClassNotices(): Promise<{ ok: boolean; rows?: NoticeRow[]; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  if (!(await canAccessTenant(user.systemRole, "lesson_reports"))) return { ok: false, error: "권한이 없습니다" };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("classnote_notices")
    .select("id, body, targets, status, results, error, created_at, processed_at")
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) return { ok: false, error: error.message };
  return {
    ok: true,
    rows: (data ?? []).map((r) => {
      // 워커 results[]는 보드명 기준 — targets[]로 학생 이름을 되붙인다(못 찾으면 보드명에서 과목 접두어만 벗김).
      const nameByBoard = new Map<string, string>();
      if (Array.isArray(r.targets)) {
        for (const t of r.targets as Array<Record<string, unknown>>) {
          if (typeof t?.board === "string" && typeof t?.studentName === "string")
            nameByBoard.set(t.board, t.studentName);
        }
      }
      const results = (r.results as Array<{ board: string; ok: boolean; note?: string }> | null) ?? null;
      return {
        id: r.id as string,
        body: r.body as string,
        targetCount: Array.isArray(r.targets) ? r.targets.length : 0,
        status: r.status as string,
        results: results
          ? results.map((x) => ({
              ...x,
              studentName: nameByBoard.get(x.board) ?? boardStudentName(x.board ?? ""),
            }))
          : null,
        reportLinks: flattenNoticeReportLinks(r.results, r.targets),
        error: r.error as string | null,
        createdAt: r.created_at as string,
        processedAt: r.processed_at as string | null,
      };
    }),
  };
}
