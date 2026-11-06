import "server-only";
import { createHash } from "node:crypto";
import { reportError } from "@/lib/observability/report-error";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPagedInChunks, fetchInChunks } from "@/lib/supabase/batch";
import { getTenantSettings } from "@/features/owner/server/queries";
import { hasClassnoteNameCollision } from "@/features/onescreen/server/scope";
import { isTenantReportAttachmentPath } from "@/lib/storage/legacy-audio-path";
import { noticeAttachmentOverflow, NOTICE_ATTACHMENT_INPUT_MAX, NOTICE_ATTACHMENT_MAX, sanitizeNoticeAttachments } from "@/features/onescreen/notice-attachments";
import { resolveNoticeTargets, type NoticeSkip, type NoticeTarget } from "../notice-targets";
import { classnoteModuleOn, classnoteSendOn } from "@/features/owner/classnote-gate";
import { routeNoticeCandidates, type RoutedCandidate } from "./notice-class-route";
import type { ClassNoticeInput } from "../class-notice-preview";

const BODY_MAX = 4000;
const TEST_TARGET = { studentName: "학원이", board: "(수학)학원이" };

/** Preview and enqueue share every permission, recipient and attachment check. No writes here. */
export async function prepareClassNotice(input: ClassNoticeInput) {
  try {
    return await prepare(input);
  } catch (error) {
    reportError(error, { scope: "notice.prepare" });
    return { ok: false as const, error: "공지 대상을 확인하지 못했습니다. 잠시 뒤 다시 시도하세요" };
  }
}

async function prepare(input: ClassNoticeInput) {
  // '다른 강사 뷰'면 대상 X의 명의로 보낸다(큐의 created_by) — 미리보기와 발송이 같은 사람이라 지문(userId)도 맞는다.
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { ok: false as const, error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "lesson_reports"))) return { ok: false as const, error: "공지 발송 권한이 없습니다" };
  const body = (input.body ?? "").trim();
  if (!body) return { ok: false as const, error: "공지 내용을 입력하세요" };
  if (body.length > BODY_MAX) return { ok: false as const, error: `공지가 너무 깁니다(최대 ${BODY_MAX}자)` };

  const settings = await getTenantSettings();
  if (!classnoteModuleOn(settings)) return { ok: false as const, error: "사용할 수 없는 기능입니다" };
  const supabase = await createClient();

  // body?: 개별 내용을 담을 수 있음. 테스트 타깃은 studentId null이라 유니온.
  // subject = 영어 반 방 대상 표식(notice-targets.ts `NoticeTarget.subject`) — 큐에 그대로 실린다.
  let targets: { studentId: string | null; studentName: string; board: string; body?: string; classId?: string; className?: string; subject?: "english" }[] = [];
  let skipped: NoticeSkip[] = [];
  if (input.test) {
    // 테스트 학생은 탈원 처리라 반 해석 경로로 못 뽑힘 — 고정 타깃(보드·학부모 연결 실존 확인됨). 개별 내용 없음.
    targets = [{ studentId: null, ...TEST_TARGET }];
  } else {
    if (!Array.isArray(input.classIds) || input.classIds.length > 5000 || input.classIds.some((id) => typeof id !== "string" || id.length > 100)) {
      return { ok: false as const, error: "대상 반 선택을 확인하세요(한 번에 최대 5,000반)" };
    }
    const classIds = [...new Set(input.classIds)].sort();
    if (!classIds.length) return { ok: false as const, error: "대상 반을 선택하세요" };
    const classes = await fetchInChunks<{ id: string; subject: string | null }>(classIds, (chunk) =>
      supabase.from("classes").select("id, subject").in("id", chunk).eq("is_active", true),
    );
    if (classes.length !== classIds.length) return { ok: false as const, error: "선택한 반 중 더 이상 조회할 수 없는 반이 있습니다. 반 목록을 새로고침한 후 다시 선택하세요" };
    const subjectByClass = new Map((classes ?? []).map((c) => [c.id as string, c.subject as string | null]));
    const enr = await fetchAllPagedInChunks<{ id: string; class_id: string; student_id: string }>(classIds, (chunk, from, to) =>
      supabase.from("enrollments").select("id, class_id, student_id").in("class_id", chunk).is("end_date", null).order("id").range(from, to),
    );
    // 청크 순서나 반 선택 순서와 무관하게 같은 수강 순서로 반 보드 힌트를 만든다.
    enr.sort((a, b) => a.id.localeCompare(b.id));
    const studentIds = [...new Set(enr.map((e) => e.student_id))];
    const students = await fetchInChunks<{ id: string; name: string; classnote_name: string | null; status: string }>(
      studentIds,
      (chunk) => supabase.from("students").select("id, name, classnote_name, status").in("id", chunk),
    );
    const studentById = new Map(students.map((s) => [s.id, s]));
    const candidates: RoutedCandidate[] = [];
    for (const e of enr) {
      const s = studentById.get(e.student_id);
      if (!s || s.status !== "enrolled") continue; // 재원생만
      candidates.push({
        studentId: s.id,
        name: s.name,
        classnoteName: s.classnote_name,
        subject: subjectByClass.get(e.class_id) ?? null,
        // 사무실 발송 = 선생님 다리 대신 **고른 반**(그 반 명단에서 뽑은 학생)으로 보낸다.
        hints: [e.class_id],
        teacherIds: null,
      });
    }
    // 수학은 반 보드 경로(맞는 반 보드가 없으면 제외 — 1인 보드로 되돌리지 않는다). 영어는 고른 반에 반 방이 이어져 있으면 반 방,
    // 없으면 지금처럼 1인 보드(2026-11-04). 조회 실패는 발송을 막는다.
    let routed: Awaited<ReturnType<typeof routeNoticeCandidates>>;
    try {
      routed = await routeNoticeCandidates({ supabase, tenantId: user.tenantId, settings, candidates });
    } catch (e) {
      console.error("[notice] 반 보드 경로 판정 실패", e instanceof Error ? e.message : e);
      return { ok: false as const, error: "보낼 반을 확인하지 못해 발송하지 않았습니다 — 잠시 뒤 다시 시도해 주세요" };
    }
    const resolved = resolveNoticeTargets(routed.rest, settings.report.classnoteSubjects);
    skipped = [...routed.skipped, ...resolved.skipped];

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
    // 반 보드 경로 대상은 이름 가드를 타지 않는다(원아 번호로 올린다 — 같은 반 동명이인은 0302a가 보류로 둔다).
    // 영어 반 방 대상도 같다(워커가 원아 연결 ∩ 지금 그 방 원아로 고른다).
    targets = [...routed.classTargets, ...survivors];
  }

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
      ok: false as const,
      error: `한 글에 올릴 수 있는 이미지는 최대 ${NOTICE_ATTACHMENT_MAX}장입니다`,
      skipped,
    };

  // A stale-preview guard, not an authorization token. Permission is checked on every call.
  const fingerprint = createHash("sha256").update(JSON.stringify({
    tenantId: user.tenantId, userId: user.id, body,
    classes: [...new Set(input.classIds ?? [])].sort(),
    targets: [...targets].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    skipped: [...skipped].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    attachments: commonAttachments, sendOn: classnoteSendOn(settings),
  })).digest("hex");
  return { ok: true as const, user, supabase, settings, body, targets, skipped, commonAttachments, fingerprint };
}
