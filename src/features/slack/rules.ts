import { activityGradeOf } from "./activity-catalog";
import { sanitizeForwardEventTypes } from "./events";

/**
 * 슬랙 규칙(0298a `slack_rules` 한 행) — 순수 타입·정리·프리셋. 서버·클라 공용.
 * 규칙 하나 = "무엇을(source + 명시 키) · 어디로(대상 여러 개) · 어떻게(형식) · 언제(즉시/요약, 방해금지)".
 */
export type SlackTarget =
  | { kind: "channel"; channelId: string; channelName: string }
  | { kind: "recipient_dm" } // 알림을 받는 aywa 사용자 본인(연결된 사람만)
  | { kind: "user_dm"; userId: string; userName: string }; // 정해 둔 사람에게 항상

export type SlackRule = {
  id: string; // 새 규칙은 "" — 저장 시 발급
  name: string;
  enabled: boolean;
  source: "notification" | "activity";
  typeKeys: string[];
  targets: SlackTarget[];
  template: "short" | "detailed";
  mentionRecipients: boolean;
  ping: "none" | "here" | "channel";
  excludeActorIds: string[];
  timing: "immediate" | "digest";
  digestAt: string | null; // "HH:MM" · null = 기본 요약 시각
  honorDnd: boolean;
  version: number;
};

export const SLACK_MAX_RULES = 30;
export const SLACK_MAX_TARGETS = 12;
const CHANNEL_ID_RE = /^[CG][A-Z0-9]{6,20}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function emptyRule(source: SlackRule["source"] = "activity"): SlackRule {
  return {
    id: "",
    name: source === "activity" ? "활동 피드" : "알림",
    enabled: true,
    source,
    typeKeys: [],
    targets: [],
    template: "short",
    mentionRecipients: false,
    ping: "none",
    excludeActorIds: [],
    timing: "immediate",
    digestAt: null,
    honorDnd: true,
    version: 0,
  };
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export function normalizeTime(v: unknown): string | null {
  const s = typeof v === "string" ? v.slice(0, 5) : "";
  return TIME_RE.test(s) ? s : null;
}

/**
 * 저장 전 정리 — 모르는 키·고를 수 없는(forbid) 활동·잘못된 채널/사람 id는 버린다.
 * `activityKeys` = 서버가 가진 실제 감사로그 액션 키 집합(없는 키를 받지 않게).
 */
export function sanitizeRule(input: unknown, activityKeys: ReadonlySet<string>): SlackRule | null {
  if (!input || typeof input !== "object") return null;
  const r = input as Record<string, unknown>;
  const source = r.source === "notification" ? "notification" : r.source === "activity" ? "activity" : null;
  if (!source) return null;
  const rawKeys = Array.isArray(r.typeKeys) ? r.typeKeys.map(String) : [];
  const typeKeys =
    source === "notification"
      ? sanitizeForwardEventTypes(rawKeys)
      : [...new Set(rawKeys)].filter((k) => activityKeys.has(k) && activityGradeOf(k) !== "forbid");

  const targets: SlackTarget[] = [];
  const seen = new Set<string>();
  for (const t of Array.isArray(r.targets) ? r.targets : []) {
    if (!t || typeof t !== "object" || targets.length >= SLACK_MAX_TARGETS) continue;
    const o = t as Record<string, unknown>;
    let key = "";
    let next: SlackTarget | null = null;
    if (o.kind === "channel" && typeof o.channelId === "string" && CHANNEL_ID_RE.test(o.channelId)) {
      key = `c:${o.channelId}`;
      next = { kind: "channel", channelId: o.channelId, channelName: str(o.channelName, 80) };
    } else if (o.kind === "recipient_dm" && source === "notification") {
      key = "r";
      next = { kind: "recipient_dm" };
    } else if (o.kind === "user_dm" && typeof o.userId === "string" && UUID_RE.test(o.userId)) {
      key = `u:${o.userId}`;
      next = { kind: "user_dm", userId: o.userId, userName: str(o.userName, 40) };
    }
    if (next && !seen.has(key)) {
      seen.add(key);
      targets.push(next);
    }
  }

  return {
    id: typeof r.id === "string" && UUID_RE.test(r.id) ? r.id : "",
    name: str(r.name, 60) || (source === "activity" ? "활동 피드" : "알림"),
    enabled: r.enabled !== false,
    source,
    typeKeys,
    targets,
    template: r.template === "detailed" ? "detailed" : "short",
    mentionRecipients: r.mentionRecipients === true && source === "notification",
    ping: r.ping === "here" || r.ping === "channel" ? r.ping : "none",
    excludeActorIds: (Array.isArray(r.excludeActorIds) ? r.excludeActorIds : [])
      .filter((v): v is string => typeof v === "string" && UUID_RE.test(v))
      .slice(0, 50),
    timing: r.timing === "digest" ? "digest" : "immediate",
    digestAt: normalizeTime(r.digestAt),
    honorDnd: r.honorDnd !== false,
    version: typeof r.version === "number" && Number.isInteger(r.version) ? r.version : 0,
  };
}

/** 대상 한 개의 설명(화면·감사로그용). */
export function targetLabel(t: SlackTarget): string {
  if (t.kind === "channel") return `#${t.channelName || t.channelId}`;
  if (t.kind === "recipient_dm") return "받는 사람 본인(1:1)";
  return `${t.userName || "직원"}(1:1)`;
}

/** 규칙 추가 프리셋 — 빈 규칙에서 350종을 고르게 하지 않는다(grok 제안). 채널·사람은 화면에서 채운다. */
export type RulePreset = { id: string; label: string; build: () => SlackRule };

export const RULE_PRESETS: readonly RulePreset[] = [
  {
    id: "feed",
    label: "원장 활동 피드(원생·상담·수납)",
    build: () => ({
      ...emptyRule("activity"),
      name: "학원 활동 피드",
      typeKeys: [
        "student_create", "student_withdraw", "student_hold", "student_restore",
        "enrollment_assign", "enrollment_move", "enrollment_end",
        "enrollment_consultation_create", "enrollment_consultation_intake", "enrollment_consultation_outcome",
        "invoice_create", "refund_request_create", "expense_create",
      ],
    }),
  },
  {
    id: "desk",
    label: "데스크 출결 알림",
    build: () => ({
      ...emptyRule("notification"),
      name: "데스크 출결",
      typeKeys: ["attendance_absent_desk", "student_attendance_notice", "attendance_desk_confirm_request", "attendance_absence_intake"],
      mentionRecipients: true,
    }),
  },
  {
    id: "approvals",
    label: "결재는 결재자 본인에게",
    build: () => ({
      ...emptyRule("notification"),
      name: "결재 1:1",
      typeKeys: ["approval_requested", "approval_decided", "approval_comment"],
      targets: [{ kind: "recipient_dm" }],
      honorDnd: true,
    }),
  },
  {
    id: "risk",
    label: "하루 요약: 결석·성적·미납·발송 실패",
    build: () => ({
      ...emptyRule("notification"),
      name: "하루 요약",
      typeKeys: ["absence_alert", "grade_drop", "outstanding_alert", "unsent_report", "report_send_failed", "notice_send_failed"],
      timing: "digest",
    }),
  },
];

/**
 * 키마다 "언제부터 이 규칙이 보냈나"(0300a `key_since`) — 유실 대조가 이 시각 이후의 사건만 되살린다.
 * 켜진 채 고친 규칙은 원래 있던 키의 시각을 그대로 두고 새 키만 지금(고쳐도 기준이 밀리지 않게, codex 3차).
 * 새 규칙·꺼져 있던 규칙·끄는 저장은 전부 지금부터(꺼 둔 동안의 사건을 켠 뒤 되살리지 않게, codex 4차).
 */
export function nextKeySince(
  prev: { since: Record<string, string>; enabled: boolean } | null,
  rule: Pick<SlackRule, "typeKeys" | "enabled">,
  now: string,
): Record<string, string> {
  const keep = prev && prev.enabled && rule.enabled ? prev.since : {};
  return Object.fromEntries(rule.typeKeys.map((k) => [k, keep[k] ?? now]));
}
