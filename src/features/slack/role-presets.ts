import type { ActivityOption } from "./activity-catalog";
import type { NotificationType } from "@/features/notifications/types";
import { emptyRule, type SlackRule } from "./rules";
import type { ForwardEventOption } from "./events";

/**
 * **역할별 기본 세팅** — '규칙 추가'에서 역할 하나를 고르면 그 역할에 맞는 규칙 1~2개가 한꺼번에 생긴다
 * (원장 2026-09-28 *"기본 세팅 몇개 만들자. 원장/관리자/매니저/선생님/셔틀 디폴트로 할 수 있게"*). 순수 함수(Vitest).
 *
 * 🔑 알림 규칙의 대상은 **받는 사람 본인(1:1)** — 알림은 원래 받을 직원이 정해져 있어(담임·결재자·데스크), 역할에 맞는 알림
 *    종류만 고르면 그 직원 각자에게 간다(슬랙에 연결된 사람만). 활동 피드 규칙은 보낼 채널·사람을 화면에서 고른다(비워 둔다).
 * 🔑 받는 사람 본인(1:1)은 역할로 거르지 않는다 — 그 알림을 받는 사람 **전원**에게 간다. 그래서 규칙 이름은 역할이 아니라
 *    **알림 내용**으로 짓고, 묶음을 여럿 더해도 같은 알림이 한 사람에게 두 번 가지 않게 [`withoutCoveredKeys`]가 이미 1:1로
 *    보내는 알림 키를 뺀다(규칙마다 중복 방지 키가 따로라 겹치면 그대로 두 번 간다 — expand.ts).
 * ⚠️ 저장 전 규칙이라 화면에서 고치고 '저장'을 눌러야 적용된다(대상 없는 활동 규칙은 저장이 막힌다).
 */
export type RolePreset = {
  id: "master" | "admin" | "manager" | "teacher" | "shuttle";
  label: string;
  build: (activityOptions: readonly ActivityOption[]) => SlackRule[];
};

const notif = (name: string, typeKeys: NotificationType[]): SlackRule => ({
  ...emptyRule("notification"),
  name,
  typeKeys,
  targets: [{ kind: "recipient_dm" }],
});

/** 활동 키 고르기 — 카테고리(또는 접두어)로, 보낼 수 없는(forbid) 키는 빼고. */
const activityKeys = (options: readonly ActivityOption[], pick: (o: ActivityOption) => boolean) =>
  options.filter((o) => o.grade !== "forbid" && pick(o)).map((o) => o.key);

const feed = (name: string, typeKeys: string[]): SlackRule => ({ ...emptyRule("activity"), name, typeKeys });

const APPROVALS: NotificationType[] = ["approval_requested", "approval_decided", "approval_comment"];
const STUDENT_WATCH: NotificationType[] = ["absence_alert", "followup_due", "grade_drop", "outstanding_alert", "unsent_report", "progress_anomaly"];
const SEND_FAILS: NotificationType[] = ["report_send_failed", "notice_send_failed"];
const DESK: NotificationType[] = [
  "attendance_absent_desk",
  "attendance_desk_confirm_request",
  "attendance_absence_intake",
  "student_attendance_notice",
  "attendance_input_request",
];

export const ROLE_PRESETS: readonly RolePreset[] = [
  {
    id: "master",
    label: "원장 기본",
    build: (o) => [
      notif("결재·학생 경보·발송 실패 1:1", [...APPROVALS, ...STUDENT_WATCH, ...SEND_FAILS, "makeedu_login_failed", "sync_agent_offline", "slack_broken", "support_answer", "staff_task_digest", "withdrawal_bypass"]),
      feed("원생·상담·수납·직원 활동", activityKeys(o, (x) => ["students", "consult", "billing", "staff"].includes(x.category))),
    ],
  },
  {
    id: "admin",
    label: "관리자 기본",
    build: (o) => [
      notif("결재·출결 데스크·학생 경보 1:1", [...APPROVALS, ...DESK, ...STUDENT_WATCH, ...SEND_FAILS, "classnote_parent_post", "classnote_parent_comment"]),
      feed("원생·상담·출결 활동", activityKeys(o, (x) => ["students", "consult", "attendance"].includes(x.category))),
    ],
  },
  {
    id: "manager",
    label: "매니저(데스크) 기본",
    build: () => [notif("출결 데스크·학부모 글 1:1", [...DESK, "classnote_parent_post", "classnote_parent_comment", ...APPROVALS])],
  },
  {
    id: "teacher",
    label: "선생님 기본",
    build: () => [
      notif("내 반·출결 요청·학생 경보 1:1", [
        "enrollment_assigned",
        "enrollment_transferred_in",
        "teacher_handover",
        "class_delegation",
        "attendance_input_request",
        "attendance_unmarked_to_present",
        "absence_alert",
        "grade_drop",
        "unsent_report",
        "progress_anomaly",
        "followup_due",
        "classnote_parent_post",
        "classnote_parent_comment",
        "report_send_failed",
        "approval_decided",
        "approval_comment",
        "help_answer",
      ]),
    ],
  },
  {
    id: "shuttle",
    label: "셔틀 기본",
    build: (o) => [
      feed("셔틀 기록(운행·탑승·노선)", activityKeys(o, (x) => x.key.startsWith("shuttle_"))),
      { ...notif("셔틀 결석 연락", ["attendance_absence_intake", "student_attendance_notice"]), targets: [] },
    ],
  },
];

export function filterPresetNotifications(rules: readonly SlackRule[], options: readonly ForwardEventOption[]): SlackRule[] {
  const allowed = new Set(options.map((option) => option.type));
  return rules.flatMap((rule) => {
    if (rule.source !== "notification") return [rule];
    const typeKeys = rule.typeKeys.filter((key) => allowed.has(key as NotificationType));
    return typeKeys.length > 0 ? [{ ...rule, typeKeys }] : [];
  });
}

const isRecipientNotif = (r: SlackRule) => r.source === "notification" && r.targets.some((t) => t.kind === "recipient_dm");

/**
 * 새로 더할 규칙에서 **이미 받는 사람 본인(1:1)으로 보내는 알림 키**를 뺀다(앞선 새 규칙끼리도). 키가 다 빠진 1:1 규칙은 버린다.
 * 기준 = **저장됐고 켜진** 기존 규칙만(발송은 켜진 규칙만 쓴다 — expand.ts). 꺼 둔 규칙·저장 전 줄이 키를 가리면 그 알림이 아무에게도 안 간다.
 * `dropped` = 뺀 키 수(화면 안내용).
 */
export function withoutCoveredKeys(adding: readonly SlackRule[], existing: readonly SlackRule[]): { rules: SlackRule[]; dropped: number } {
  const covered = new Set(existing.filter((r) => r.enabled && !!r.id && isRecipientNotif(r)).flatMap((r) => r.typeKeys));
  let dropped = 0;
  const rules: SlackRule[] = [];
  for (const r of adding) {
    if (!isRecipientNotif(r)) {
      rules.push(r);
      continue;
    }
    const keys = r.typeKeys.filter((k) => !covered.has(k));
    dropped += r.typeKeys.length - keys.length;
    keys.forEach((k) => covered.add(k));
    if (keys.length) rules.push({ ...r, typeKeys: keys });
  }
  return { rules, dropped };
}
