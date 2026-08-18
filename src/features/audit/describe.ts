// 운영 감사로그(audit_logs) metadata → 한글 상세 — 순수 함수(서버/클라 공용, activity.ts와 동일 원칙).
// UI 규칙: raw JSON·uuid·영문 enum을 셀에 그대로 노출하지 말 것 — 한글 요약을 보여주고 원문은 title 툴팁으로만.
import { ROLE_LABEL } from "@/lib/auth/role-hierarchy";
import { SECTION_LABELS } from "@/features/owner/settings-types";
import { STUDENT_STATUS_LABEL } from "@/features/students/status-labels";
import { reasonDisplay } from "@/features/withdrawals/types";

/** 대상 유형(target_type) → 한글 — 감사로그 '대상' 열 접두. 미등록 유형은 원문 폴백. */
export const AUDIT_TYPE_LABEL: Record<string, string> = {
  staff: "직원",
  // 같은 "직원"이지만 호출부마다 target_type 표기가 달라 실제로 쌓여 있다(user 6행·users 3행) — 셋 다 한글로.
  user: "직원",
  users: "직원",
  student: "학생",
  academy_documents: "서식 문서",
  invoice: "청구서",
  exam: "시험",
  payroll: "급여",
  class: "반",
  classroom: "강의실",
  tenant_settings: "학원 설정",
  staff_resume: "직원 이력서",
  intake_token: "QR 접수 링크",
  notice_popup: "팝업 공지",
  classnote_notice: "학부모 공지",
  operating_periods: "세션 기간",
  // 2026-08-17 원장 제보("대상이 attendance 등 날것으로 나옴") — 누락 유형 전수 추가(가드 테스트도 갱신).
  attendance: "출결",
  lesson_report: "수업보고서",
  approval_document: "결재 문서",
  enrollment_consultations: "등록상담",
  document: "문서",
};

// 시험유형은 운영 enum이 아니라 코드 고정(CLAUDE.md) — exams 화면과 동일 라벨.
const EXAM_TYPE_LABEL: Record<string, string> = { weekly: "주간", mock: "모의", school: "학교" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Meta = Record<string, unknown>;
/** uuid → 표시 이름(해석 실패 시 null). 서버가 페이지 단위로 일괄 조회해 만든 맵을 감싼다. */
export type AuditNameOf = (id: unknown) => string | null;

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const won = (v: unknown): string | null => {
  const n = num(v);
  return n === null ? null : `${n.toLocaleString("ko-KR")}원`;
};
const roleKo = (v: unknown): string | null => {
  const s = str(v);
  return s ? ((ROLE_LABEL as Record<string, string>)[s] ?? s) : null;
};
const join = (...parts: Array<string | null>): string | null => {
  const out = parts.filter(Boolean);
  return out.length ? out.join(" · ") : null;
};

/** 페이지 행들의 metadata에서 이름 해석이 필요한 학생/직원/반 uuid 수집(일괄 조회용). */
export function collectAuditNameIds(rows: Array<{ metadata: Meta | null }>): {
  studentIds: string[];
  userIds: string[];
  classIds: string[];
} {
  const students = new Set<string>();
  const users = new Set<string>();
  const classes = new Set<string>();
  for (const r of rows) {
    const m = r.metadata;
    if (!m) continue;
    const sid = str(m.studentId);
    if (sid && UUID_RE.test(sid)) students.add(sid);
    for (const key of ["userId", "newTeacherId"]) {
      const uid = str(m[key]);
      if (uid && UUID_RE.test(uid)) users.add(uid);
    }
    const cid = str(m.classId);
    if (cid && UUID_RE.test(cid)) classes.add(cid);
  }
  return { studentIds: [...students], userIds: [...users], classIds: [...classes] };
}

/** targetLabel이 빈 행(퇴원 사유·인수인계 취소 등)의 '대상' 열을 metadata의 학생/직원/반 이름으로 보충. */
export function auditTargetName(metadata: Meta | null, nameOf: AuditNameOf): string | null {
  if (!metadata) return null;
  return (
    nameOf(metadata.studentId) ?? nameOf(metadata.userId) ?? nameOf(metadata.newTeacherId) ?? nameOf(metadata.classId)
  );
}

/**
 * 감사로그 1건의 metadata를 한글 상세 문장으로. null = 표기할 상세 없음("—").
 * 모르는 액션은 uuid를 걸러낸 키값 나열 폴백(원문 JSON은 뷰어가 title 툴팁으로 보존).
 */
export function auditDetail(
  action: string,
  metadata: Meta | null,
  ctx: { nameOf: AuditNameOf; subjectLabel: (key: string) => string },
): string | null {
  const m = metadata ?? {};
  switch (action) {
    case "owner_settings_update": {
      const s = str(m.section);
      const label = s ? ((SECTION_LABELS as Record<string, string>)[s] ?? s) : null;
      return label ? `「${label}」 설정 저장` : "설정 저장";
    }
    case "owner_subject_absorb": {
      const moved = num(m.moved);
      return moved === null ? "연결 데이터 이동" : `연결 데이터 ${moved.toLocaleString("ko-KR")}건 이동`;
    }
    case "owner_subject_delete": {
      const key = str(m.key);
      return key ? `과목 「${ctx.subjectLabel(key)}」 설정에서 제거(사용 데이터 없음)` : null;
    }
    case "staff_role_change": {
      const from = roleKo(m.from);
      const to = roleKo(m.to);
      return from && to ? `역할 ${from} → ${to}` : null;
    }
    case "staff_delete": {
      const r = roleKo(m.role);
      return r ? `삭제 당시 역할: ${r}` : null;
    }
    case "staff_password_reset": {
      const mode = str(m.mode);
      if (mode === "temp") return "임시 비밀번호 발급";
      if (mode === "custom") return "비밀번호 직접 설정";
      return null; // 비밀번호 자체는 metadata에 없다(있어서도 안 된다)
    }
    case "self_password_change":
      return null; // metadata 없음 — 대상 열이 본인 이름을 보여준다
    case "staff_email_change":
    case "self_email_change": {
      const from = str(m.from);
      const to = str(m.to);
      return from && to ? `${from} → ${to}` : (to ?? null);
    }
    case "self_report_name_change": {
      const name = str(m.reportName);
      return name ? `발송용 이름 "${name}"` : "발송용 이름 해제(실명으로 발송)";
    }
    case "staff_contract_extend": {
      const seq = num(m.seq);
      const start = str(m.startDate);
      const end = str(m.endDate);
      return join(seq === null ? null : `${seq}차 계약`, start && end ? `${start} ~ ${end}` : null);
    }
    case "staff_contract_update": {
      // kind='note'(시트 이관 이력 줄)는 차수가 없다 — 영문 "note"를 그대로 내보내지 않는다.
      const isNote = str(m.kind) === "note";
      const seq = num(m.seq);
      const start = str(m.startDate);
      const end = str(m.endDate);
      return join(
        isNote ? "이력 줄" : seq === null ? null : `${seq}차 계약`,
        start && end ? `${start} ~ ${end}` : null,
      );
    }
    case "staff_contract_delete": {
      const seq = num(m.seq);
      return seq === null ? null : `${seq}차 계약 삭제`;
    }
    case "staff_contract_file_add":
    case "staff_contract_file_delete": {
      const name = str(m.fileName);
      return name ? `파일 ${name}` : null;
    }
    case "staff_contract_pdf_extract": {
      // metadata.filled = 추출된 필드 키 배열(영문) — 개수만 보여주고 키 자체는 노출하지 않는다.
      const n = Array.isArray(m.filled) ? m.filled.length : null;
      return n === null ? null : `PDF에서 항목 ${n}개 추출`;
    }
    case "invoice_create": {
      const w = won(m.amountTotal);
      return join(ctx.nameOf(m.studentId), w ? `청구액 ${w}` : null);
    }
    case "exam_create": {
      const subject = str(m.subject);
      const type = str(m.examType);
      return join(subject ? ctx.subjectLabel(subject) : null, type ? `${EXAM_TYPE_LABEL[type] ?? type} 시험` : null);
    }
    case "exam_delete":
      return null; // metadata = 시험 uuid뿐(삭제되어 해석 불가)
    case "exam_scores": {
      const saved = num(m.saved);
      const students = num(m.students);
      if (saved === null && students === null) return null;
      return `학생 ${students ?? "?"}명 중 점수 ${saved ?? "?"}건 저장`;
    }
    case "payroll_upsert": {
      const w = won(m.total);
      return join(ctx.nameOf(m.userId), w ? `지급 합계 ${w}` : null);
    }
    case "withdrawal_update": {
      const reason = str(m.reason);
      return join(ctx.nameOf(m.studentId), reason ? `사유: ${reason}` : null);
    }
    // 학생 기록 변경 전수 감사(2026-08-18) — 누가·언제·어느 학생을 바꿨는지 역검수용.
    case "student_withdraw": {
      const reason = reasonDisplay(str(m.reason));
      return join(
        ctx.nameOf(m.studentId),
        str(m.date) ? `퇴원일 ${str(m.date)}` : null,
        reason ? `사유: ${reason}` : null,
        str(m.memo),
      );
    }
    case "student_hold":
    case "student_restore": {
      return ctx.nameOf(m.studentId);
    }
    case "student_update": {
      const from = str(m.statusFrom);
      const to = str(m.statusTo);
      const statusChanged =
        from && to && from !== to
          ? `상태 ${STUDENT_STATUS_LABEL[from] ?? from} → ${STUDENT_STATUS_LABEL[to] ?? to}`
          : null;
      return join(ctx.nameOf(m.studentId), statusChanged);
    }
    case "student_create": {
      return ctx.nameOf(m.studentId) ?? str(m.studentName);
    }
    case "student_delete": {
      // 삭제된 학생은 uuid로 이름을 되찾을 수 없다 — 기록 시점의 이름을 metadata에 실어 보존.
      return str(m.studentName) ?? ctx.nameOf(m.studentId);
    }
    case "enrollment_end": {
      const reason = reasonDisplay(str(m.reason));
      return join(
        ctx.nameOf(m.studentId),
        ctx.nameOf(m.classId),
        str(m.date) ? `종료일 ${str(m.date)}` : null,
        reason ? `사유: ${reason}` : null,
      );
    }
    case "student_bulk_withdraw":
    case "student_bulk_delete": {
      const n = num(m.count);
      return n === null ? null : `${n}명 (관리 도구 · 수강 없는 학생 정리)`;
    }
    case "class_end_term": {
      const d = str(m.closedAt);
      return d ? `종강일 ${d}` : null;
    }
    // 반 수정(2026-08-04 신설) — 그동안 **폼 저장에 로그가 아예 없어서** 담당·강의실이 언제 누구로
    // 바뀌었는지 되살릴 근거가 없었다. 바뀐 항목만 적는다(안 바뀐 건 안 적는다).
    // 🔴 2026-08-05: 예전엔 항목 이름만 적어 "변경: 강의실"이었다 — 어디서 어디로 바뀌었는지가 없어
    //    이력으로 쓸 수가 없었다(원장 지시). 이제 `changes`에 이전값·이후값이 함께 온다.
    //    ⚠️ 그 이전에 쌓인 행은 `changed`(이름만)뿐이다 — 없는 화살표를 지어내지 말고 그대로 보여준다.
    case "class_update": {
      const changes = Array.isArray(m.changes) ? m.changes : [];
      const parts = changes
        .map((c) => {
          if (!c || typeof c !== "object") return null;
          const o = c as Meta;
          const field = str(o.field);
          if (!field) return null;
          // 배치처럼 짝이 없는 항목은 이름만. 값이 비었으면 '없음'(빈칸으로 두면 화살표가 허공을 가리킨다).
          if (!("from" in o) && !("to" in o)) return field;
          return `${field} ${str(o.from) ?? "없음"} → ${str(o.to) ?? "없음"}`;
        })
        .filter((v): v is string => !!v);
      if (parts.length > 0) return `변경: ${parts.join(" · ")}`;
      const fields = Array.isArray(m.changed) ? m.changed.filter((v): v is string => typeof v === "string") : [];
      return fields.length > 0 ? `변경: ${fields.join(", ")}` : null;
    }
    case "class_handover_schedule": {
      const n = ctx.nameOf(m.newTeacherId);
      const d = str(m.effectiveDate);
      return join(n ? `새 담임 ${n}` : null, d ? `${d}부터` : null);
    }
    case "class_handover_apply": {
      const n = ctx.nameOf(m.newTeacherId);
      return n ? `새 담임 ${n}` : null;
    }
    // 반 임시 위임(0173a) — 담임은 안 바뀐다. "누가 · 언제까지" 둘 다 없으면 로그를 읽을 수 없으니 함께 적는다.
    case "class_delegate": {
      const n = ctx.nameOf(m.delegateUserId);
      const from = str(m.fromDate);
      const to = str(m.toDate);
      const period = from && to ? (from === to ? from : `${from}~${to}`) : (from ?? to);
      return join(n ? `대신 맡을 선생님 ${n}` : null, period ? `기간 ${period}` : null);
    }
    case "class_delegate_revoke": {
      const n = ctx.nameOf(m.delegateUserId);
      return n ? `위임 해제 ${n}` : null;
    }
    case "class_handover_bulk": {
      const to = ctx.nameOf(m.newTeacherId);
      const cls = num(m.classCount);
      const slots = num(m.slotCount);
      return join(
        to ? `새 담임 ${to}` : null,
        cls === null ? null : `반 ${cls}개 인계`,
        slots ? `교시 ${slots}개` : null,
      );
    }
    case "class_reopen_term":
    case "class_handover_cancel":
      return null; // metadata = 반 uuid뿐(대상 열이 반 이름을 보여줌)
    case "class_archive":
    case "class_unarchive": {
      const n = num(m.affectedStudents);
      if (n === null) return null;
      return action === "class_archive" ? `수강 ${n}건 종료` : `수강 ${n}건 복원`;
    }
    case "owner_integration_groups_update": {
      const subject = str(m.subject);
      const groups = num(m.groups);
      return join(
        subject ? `과목 「${ctx.subjectLabel(subject)}」` : null,
        m.enabled === true ? "통합뷰 사용" : m.enabled === false ? "통합뷰 미사용" : null,
        groups === null ? null : `그룹 ${groups}개`,
      );
    }
    case "owner_teacher_view_order_update": {
      const subject = str(m.subject);
      const count = num(m.count);
      return join(
        subject ? `과목 「${ctx.subjectLabel(subject)}」` : null,
        count === null ? null : count === 0 ? "순서 초기화" : `강사 ${count}명 순서 지정`,
      );
    }
    case "classroom_auto_assign": {
      const applied = num(m.applied);
      const rooms = num(m.rooms);
      if (applied === null && rooms === null) return null;
      return `강의실 ${rooms ?? "?"}곳에 반 ${applied ?? "?"}개 자동배정`;
    }
    case "classnote_notice_send": {
      const n = num(m.targetCount);
      return n === null
        ? "학부모 공지 발송 대기(큐 적재)"
        : `대상 ${n}명 발송 대기(큐 적재 — 연동 PC가 순차 게시)`;
    }
    case "classnote_notice_edit":
      return m.posted ? "게시된 공지 내용 수정(게시글에 반영)" : "발송 전(대기) 공지 내용 수정";
    case "classnote_notice_delete":
      return "발송 전(대기) 공지 삭제";
    case "classnote_notice_revoke": {
      const c = num(m.reportCount);
      return c === null ? "게시된 공지 게시취소(회수)" : `게시된 공지 ${c}건 게시취소(회수)`;
    }
    case "classnote_report_recall": {
      const c = num(m.reportCount);
      // 누가 지웠는지만큼 "관리자 강제 회수인지 담당 강사 본인 회수인지"가 감사에서 중요하다.
      const who = m.byAdmin === true ? "관리자 회수" : "담당 강사 회수";
      const names = Array.isArray(m.studentNames) ? m.studentNames.filter((x) => typeof x === "string") : [];
      const label = names.length ? `(${names.slice(0, 3).join(", ")}${names.length > 3 ? " 외" : ""})` : "";
      return join(c === null ? `수업보고서 회수 — ${who}` : `수업보고서 ${c}건 회수 — ${who}`, label || null);
    }
    case "ecs_attendance_clear": {
      const rows = num(m.rows);
      const date = typeof m.date === "string" ? m.date.slice(5) : null;
      return join(date ? `${date} 출석 체크 해제` : "출석 체크 해제", rows ? `기록 ${rows}건 삭제` : null);
    }
    case "student_import": {
      const inserted = num(m.inserted);
      if (inserted === null) return null;
      const skipped = num(m.skipped);
      const failed = num(m.failed);
      return join(
        `추가 ${inserted}명`,
        skipped ? `건너뜀 ${skipped}명` : null,
        failed ? `실패 ${failed}명` : null,
      );
    }
    default: {
      // 미등록 액션 폴백 — uuid는 이름으로 해석(실패 시 숨김), 나머지는 키: 값.
      const parts: string[] = [];
      for (const [k, v] of Object.entries(m)) {
        if (v === null || v === undefined || v === "" || typeof v === "object") continue;
        const s = String(v);
        if (UUID_RE.test(s)) {
          const n = ctx.nameOf(s);
          if (n) parts.push(n);
          continue;
        }
        parts.push(`${k}: ${s.length > 40 ? s.slice(0, 40) + "…" : s}`);
      }
      return parts.length ? parts.join(" · ") : null;
    }
  }
}
