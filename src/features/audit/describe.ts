// 운영 감사로그(audit_logs) metadata → 한글 상세 — 순수 함수(서버/클라 공용, activity.ts와 동일 원칙).
// UI 규칙: raw JSON·uuid·영문 enum을 셀에 그대로 노출하지 말 것 — 한글 요약을 보여주고 원문은 title 툴팁으로만.
import { ROLE_LABEL } from "@/lib/auth/role-hierarchy";
import { SECTION_LABELS } from "@/features/owner/settings-types";

/** 대상 유형(target_type) → 한글 — 감사로그 '대상' 열 접두. 미등록 유형은 원문 폴백. */
export const AUDIT_TYPE_LABEL: Record<string, string> = {
  staff: "직원",
  student: "학생",
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
    case "class_end_term": {
      const d = str(m.closedAt);
      return d ? `종강일 ${d}` : null;
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
