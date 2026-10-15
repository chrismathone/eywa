import { STATUS_TEXT, type AttendanceMark } from "@/features/attendance/cell-display";
import { CONSULTATION_AUDIENCE_LABEL, CONSULTATION_CATEGORY_LABEL } from "@/features/consultations/labels";
import { OUTCOME_PILL } from "@/features/enrollment/outcome-meta";
import { ASSET_STATUS_LABEL } from "@/features/inventory/status";
import { ONBOARDING_ITEMS } from "@/features/newcomers/onboarding-items";
import { STUDENT_STATUS_LABEL } from "@/features/students/status/status-labels";
import { activityDetail, blank } from "./activity-detail";
import { scrubSensitive } from "./render";

/**
 * 슬랙 활동의 **무엇을 했나**(원장 2026-09-29 *"대략적으로 어떤걸 작성했고, 뭘 행동했는지 요약보고"*) — codex·grok 설계 합의.
 * 순수 함수(Vitest). `action × 키` **허용 목록**만 읽는다 — 같은 `from/to`라도 액션마다 뜻과 라벨 맵이 다르다.
 *
 * 🔴 라벨은 앱의 단일 맵에서 **등록된 값만**(`own`) — 모르는 enum은 그 조각만 뺀다(원문 폴백 금지, raw 코드 노출 금지).
 * 🔴 자유 글: **첫 줄**엔 강사 시트의 짧은 수업 내용(과제·목표·시험 범위, 24자)만 전후를 싣고 특이사항·메모 칸은 '입력/수정'만.
 *    **자세히**엔 칸 전·후 전문(500자, 특이사항·메모 포함 — 원장 2026-09-29 *"필요한 정보들은 전부"*). 자르기 **전에** 가린다
 *    (`scrubSensitive` — 자른 자리에 걸린 번호가 가리기 조건을 빠져나가지 않게). 상담 본문·병합에서 버린 항목·삭제 스냅샷·금액은
 *    여전히 싣지 않는다. `queued`는 '발송 완료'가 아니고 `planned`는 '적용'이 아니다.
 * 결과의 `brief`는 **첫 줄**에 붙는다 — 묶음·요약이 첫 줄만 쓰므로 '무엇이 바뀌었나'가 거기 있어야 한다.
 */
export type ActivityChange = { brief: string[]; rows: { label: string; value: string }[] };
const NONE: ActivityChange = { brief: [], rows: [] };

const own = (map: Readonly<Record<string, string>>, v: unknown) =>
  typeof v === "string" && Object.hasOwn(map, v) ? map[v]! : null;
const outcome = (v: unknown) => (typeof v === "string" && Object.hasOwn(OUTCOME_PILL, v) ? OUTCOME_PILL[v]!.label : null);
const attend = (v: unknown) => {
  const t = own(STATUS_TEXT as Record<AttendanceMark, string>, v);
  return v === "excused" ? "결석(사유)" : t;
};
/** 0 이상 정수만 — 문자열·소수·음수는 안 싣는다. */
const count = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null);
/** 한 줄로 접고 자른다(줄바꿈이 첫 줄을 끊지 않게). */
export const oneLine = (v: unknown, max: number) => {
  if (typeof v !== "string") return null;
  const t = v.replace(/\s+/g, " ").trim();
  if (!t) return null;
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

/** `이전 → 이후` — 한쪽만 알면 그쪽만, 같으면 한 번. 둘 다 모르면 null. */
export function transition(from: string | null, to: string | null): string | null {
  if (from && to) return from === to ? to : `${from} → ${to}`;
  return to ?? null;
}

const FOLLOWUP_SIGNAL: Record<string, string> = { absent: "결석", unmarked: "미출결" };
const FOLLOWUP_STATE: Record<string, string> = { open: "연락 중", resolved: "확인 완료", dismissed: "종료" };
const CONTACT_VIA: Record<string, string> = { phone: "전화", kakao: "카카오", in_person: "대면", other: "기타" };
const AUTOLINK_RULE: Record<string, string> = { phone_name: "연락처·이름 일치", name_school_grade: "이름·학교·학년 일치" };
const LESSON_SHIFT: Record<string, string> = { skip: "한 칸 미루기", advance: "한 칸 당기기" };
/** 내용을 싣지 않는 강사 시트 칸 — 가정사·연락처가 섞일 수 있는 자유 메모. */
const PRIVATE_FIELDS = /특이사항|메모|비고/;
const SHEET_EDITS = new Set(["ecs_mark_edit", "ecs_plan_cell_edit", "ecs_month_plan_edit", "seat_jj_mark_edit", "ecs_goal_edit", "ecs_memo_edit"]);
const one = (label: string, value: string | null): ActivityChange => (value ? { brief: [value], rows: [{ label, value }] } : NONE);

export function activityChange(action: string, metadata: unknown): ActivityChange {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return NONE;
  const m = metadata as Record<string, unknown>;

  // 칸 수정 — 항목 이름(기록 때 한글 스냅샷) + 짧은 전후. 긴 글·메모 칸은 '무엇을 바꿨나'만.
  if (SHEET_EDITS.has(action)) {
    const field = oneLine(m.fieldLabel, 20);
    if (!field || /^[a-z0-9_]+$/.test(field)) return NONE; // 영문 내부 키 모양이면 싣지 않는다
    // 옛 기록은 빈 값을 문자열 "null"로 들고 있다 — 빈칸으로 읽는다(`blank`).
    const val = (v: unknown, max: number) => (blank(v) || typeof v !== "string" ? null : oneLine(scrubSensitive(v), max));
    const has = (v: unknown) => !blank(v);
    const verb = !has(m.before) && has(m.after) ? "입력" : has(m.before) && !has(m.after) ? "비움" : "수정";
    // '자세히' = 바꾼 내용 전부(원장 2026-09-29 *"내용을 알 수 있는 메시지들은 내용까지 첨부 … 필요한 정보들은 전부"*) —
    // 특이사항·메모 칸도 자세히에선 싣는다(첫 줄은 여전히 '입력/수정'만). 전화번호·계좌 모양은 발송 직전에 가려진다(render).
    const rows = [
      { label: `${field} 전`, value: val(m.before, 500) ?? "(빈칸)" },
      { label: `${field} 후`, value: val(m.after, 500) ?? "(빈칸)" },
    ];
    const month = typeof m.month === "string" && /^\d{4}-\d{2}$/.test(m.month) ? `${Number(m.month.slice(5))}월` : null;
    if (month) rows.unshift({ label: "달", value: month });
    if (PRIVATE_FIELDS.test(field)) return { brief: [`${field} ${verb}`], rows };
    const b = val(m.before, 24);
    const a = val(m.after, 24);
    const long = (val(m.before, 1000)?.length ?? 0) > 24 || (val(m.after, 1000)?.length ?? 0) > 24;
    const brief = long ? `${field} ${verb}` : `${field} ${b ? `「${b}」` : "(빈칸)"} → ${a ? `「${a}」` : "(빈칸)"}`;
    return { brief: [brief], rows };
  }

  switch (action) {
    case "attendance_cell":
    case "seat_attendance_set": {
      const r = one("출결", transition(attend(m.prevStatus), attend(m.status)));
      // 시수(수학 출결 칸의 숫자) 전후 — 자세히에만.
      const u = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? String(v) : null);
      // 지운 시수(`nextUnits: null`)는 '전 → (빈칸)'으로 — transition은 뒤가 없으면 통째로 null이라 따로 적는다.
      const prevU = u(m.prevUnits);
      const nextU = u(m.nextUnits) ?? u(m.units);
      const cleared = prevU !== null && nextU === null && Object.hasOwn(m, "nextUnits");
      const units = cleared ? `${prevU} → (빈칸)` : transition(prevU, nextU);
      return units ? { brief: r.brief, rows: [...r.rows, { label: "시수", value: units }] } : r;
    }
    case "attendance_bulk": {
      const st = attend(m.status);
      // 인원 = 중복 없는 학생 수(한 학생이 두 칸일 수 있다) → 없으면 기록한 칸 수. `created`(새로 만든 칸)는 덮어쓰면 0이라 마지막.
      const ids = Array.isArray(m.studentIds) ? new Set(m.studentIds.filter((x) => typeof x === "string")).size : null;
      const n = (ids || null) ?? count(m.count) ?? count(m.created);
      return one("출결", st ? `${st}${n !== null ? ` ${n}명` : ""}` : null);
    }
    case "attendance_clear":
    case "seat_attendance_clear":
    case "ecs_attendance_clear":
      return one("출결", "기록 삭제");
    case "attendance_followup": {
      const bits = [own(FOLLOWUP_SIGNAL, m.signal), own(FOLLOWUP_STATE, m.state), own(CONTACT_VIA, m.contactedVia)].filter(Boolean);
      return one("후속", bits.length ? bits.join(" · ") : null);
    }
    case "enrollment_consultation_outcome":
      return one("상태", transition(outcome(m.from), outcome(m.to)));
    case "student_update":
      return one("상태", transition(own(STUDENT_STATUS_LABEL, m.statusFrom), own(STUDENT_STATUS_LABEL, m.statusTo)));
    case "inventory_asset_status":
      return one("상태", transition(own(ASSET_STATUS_LABEL, m.from), own(ASSET_STATUS_LABEL, m.to)));
    case "lesson_report_save":
      return one("구분", m.created === true ? "새로 작성" : m.created === false ? "수정" : null);
    case "report_attachment_add": {
      // 파일명이 흔히 학생 이름이라(실측 3/3) 첫 줄엔 '파일 첨부'만 — 이름은 이미 첫 줄에 있다. 파일명은 자세히 줄에.
      const f = oneLine(m.fileName, 40);
      return f ? { brief: ["파일 첨부"], rows: [{ label: "파일", value: f }] } : NONE;
    }
    case "document_create":
      return one("파일", oneLine(m.fileName, 40));
    case "inventory_supply_create": {
      // 품목 이름은 대상 칸(`HDS-08 헤드셋`)에 이미 있다 — 수량만 더한다.
      const qty = count(m.qty);
      return one("수량", qty !== null ? `${qty}개` : null);
    }
    case "textbook_lesson_shift":
      return one("일정", own(LESSON_SHIFT, m.kind));
    case "textbook_plan_apply": {
      const n = count(m.planned);
      return one("계획", n !== null ? `${n}차수 계획` : null);
    }
    case "calendar_google_import":
    case "calendar_google_push_sync": {
      const bits = [["추가", m.inserted], ["갱신", m.updated], ["삭제", m.deleted]]
        .map(([l, v]) => [l, count(v)] as const)
        .filter(([, v]) => v !== null && v > 0)
        .map(([l, v]) => `${l} ${v}`);
      return one("가져오기", bits.length ? bits.join(" · ") : "변경 없음");
    }
    case "classnote_notice_send": {
      const n = count(m.targetCount);
      return one("대상", n !== null ? `대상 ${n}명` : null);
    }
    case "consultation_merge": {
      const r = m.result && typeof m.result === "object" ? (m.result as Record<string, unknown>) : {};
      const n = count(r.deleted);
      return one("병합", n !== null ? `중복 ${n}건 정리` : null);
    }
    case "consultation_autolink":
      return one("연결", own(AUTOLINK_RULE, m.rule));
    case "student_consultation_create": {
      const bits = [own(CONSULTATION_AUDIENCE_LABEL, m.audience), own(CONSULTATION_CATEGORY_LABEL, m.category)].filter(Boolean);
      const base = one("상담", bits.length ? `${bits.join(" · ")} 상담 기록` : null);
      // 상담일·후속 예정 — 자세히에만(activity-detail).
      return { brief: base.brief, rows: [...base.rows, ...activityDetail(action, m).rows] };
    }
    case "student_consultation_follow_up":
      return one("후속", m.done === true ? "후속조치 완료" : m.done === false ? "완료 해제" : null);
    case "newcomer_check": {
      const item = ONBOARDING_ITEMS.find((i) => i.key === m.itemKey);
      return one("신규생", item ? item.label : null);
    }
    case "ecs_shouting_toggle":
      return one("체크", m.checked === true ? "체크" : m.checked === false ? "체크 해제" : null);
    default: {
      // 나머지 = 날짜·반·자산·결재 등 '자세히' 내용 허용 목록(activity-detail.ts).
      const d = activityDetail(action, m);
      return d.brief.length || d.rows.length ? d : NONE;
    }
  }
}
