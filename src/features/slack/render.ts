import type { ActivityFacts } from "./activity-facts";
import { forwardEventLabel } from "./events";
import { escapeMrkdwn } from "./format";
import { kstClock, kstStamp } from "./schedule";

/**
 * 슬랙 메시지 조립 — 순수 함수. 알림·활동 사건 → 본문(`body`) + 묶음용 한 줄(`groupLabel`).
 * 🔴 활동은 감사로그 **metadata를 받지 않는다** — 호출부가 허용 키만 확인된 이름·한글 라벨로 바꾼 `facts`만 받는다
 *    ([`activityFacts`](./activity-facts), 원장 2026-09-28 '허용 항목만 풀기'). 민감값이 섞일 길을 타입으로 막는다.
 * 🔴 모든 출력은 `scrubSensitive`를 지난다 — 주민번호·계좌·전화번호 모양의 숫자열은 가린다.
 */
export type NotificationEvent = {
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  createdAt: Date;
};
export type ActivityEvent = {
  label: string; // 한글 액션 라벨(AUDIT_ACTIONS)
  opaque: boolean; // 대상 문구·facts를 싣지 않는다(돈 계열)
  targetLabel: string | null;
  /** 분류(activity-catalog) — 머리 이모지. */
  category?: string | null;
  facts?: ActivityFacts;
  actorName: string | null;
  createdAt: Date;
};
export type Rendered = { body: string; groupLabel: string };
type Style = { template: "short" | "detailed"; appUrl: string | null; ping: "none" | "here" | "channel" };

const MAX_BODY = 1200;
const MAX_MESSAGE = 3500;
const DIGEST_LINES = 20;
const AGGREGATE_LINES = 10;
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** 주민번호(6-7) · 하이픈으로 이은 긴 숫자열(계좌·전화, 숫자 10자리 이상)을 가린다. */
export function scrubSensitive(text: string): string {
  return text
    .replace(/\b\d{6}\s*-\s*[1-8]\d{6}\b/g, "******-*******")
    .replace(/\b\d{2,6}(?:-\d{2,8}){1,4}\b/g, (m) => (m.replace(/-/g, "").length >= 10 ? m.replace(/\d/g, "*") : m))
    .replace(/\b01[016789]\d{7,8}\b/g, (m) => "*".repeat(m.length)); // 하이픈 없는 휴대폰 번호(grok 2차)
}

function link(href: string | null, appUrl: string | null, text: string): string | null {
  if (!href) return null;
  const abs = /^https?:\/\//.test(href) ? href : appUrl && href.startsWith("/") ? `${appUrl}${href}` : null;
  return abs ? `<${abs.replace(/\|/g, "%7C").replace(/>/g, "%3E")}|${text}>` : null;
}

function withPing(text: string, ping: Style["ping"]): string {
  return ping === "none" ? text : `<!${ping}> ${text}`;
}

/** 본문 줄만 가린다 — 링크 줄(`<url|글자>`)은 건드리지 않는다(uuid 조각이 숫자열로 보여 주소가 깨지는 것 방지). */
function finish(text: (string | null)[], linkLine: string | null, style: Style): string {
  const body = scrubSensitive(clip(text.filter((l): l is string => !!l).join("\n"), MAX_MESSAGE));
  return withPing(linkLine ? `${body}\n${linkLine}` : body, style.ping);
}

/**
 * 알림 한 건. `recipients` = 채널에서 받는 사람 표시(이미 `<@U…>` 멘션이거나 이름) — 1:1에선 빈 배열.
 * 짧게 = 머리 + 링크 · 자세히 = 머리 + 본문 + 받는 사람 + 링크.
 */
export function renderNotification(ev: NotificationEvent, style: Style, recipients: readonly string[] = []): Rendered {
  const label = forwardEventLabel(ev.type);
  const head = `*[${label}] ${escapeMrkdwn(ev.title)}*`;
  const detailed = style.template === "detailed";
  const body = finish(
    [
      head,
      detailed && ev.body ? escapeMrkdwn(clip(ev.body, MAX_BODY)) : null,
      !detailed && ev.body ? escapeMrkdwn(clip(ev.body, 200)) : null,
      recipients.length ? `받는 사람: ${recipients.join(", ")}` : null,
      detailed ? `_${kstStamp(ev.createdAt)}_` : null,
    ],
    link(ev.link, style.appUrl, "에이와에서 열기"),
    style,
  );
  return { body, groupLabel: label };
}

/** 분류별 머리 표식 — 채널에서 한눈에 갈리게. 모르는 분류는 표식 없이. */
const CATEGORY_MARK: Record<string, string> = {
  students: "🧑‍🎓",
  consult: "📞",
  attendance: "✅",
  billing: "💳",
  classes: "🏫",
  reports: "📝",
  sheets: "📒",
  staff: "👥",
  comms: "📣",
  ops: "🚌",
  settings: "⚙️",
};

/**
 * 활동 한 건. 짧게 = `표식 *[라벨]* 대상 · 학생 · 반 · 날짜 — 누가`(한 줄) ·
 * 자세히 = 같은 첫 줄 + 학생·반·날짜·출결 줄 + `시각 · 에이와 링크`(학생 한 명이면 그 학생 화면, 아니면 감사로그).
 * 🔴 '누가' 줄을 따로 두지 않는다 — 첫 줄 끝에 이미 있어 같은 이름이 두 번 찍혔다(원장 2026-09-29 *"의미없는 이름이 중복 표기됨"*).
 * 🔑 첫 줄은 두 모양이 같다 — 여러 건 묶음·요약은 **첫 줄만** 싣는다(renderAggregate·renderDigest).
 */
export function renderActivity(ev: ActivityEvent, style: Style): Rendered {
  const actor = ev.actorName ? escapeMrkdwn(ev.actorName) : "시스템";
  const facts = ev.opaque ? undefined : ev.facts;
  const target = !ev.opaque && ev.targetLabel ? clip(ev.targetLabel, 200) : null;
  // 대상 칸이 이미 이름을 담는 액션이 많다(`학생 · 반`) — 대상에 든 조각은 다시 붙이지 않는다(두 번 찍힘 방지).
  const pieces = [target, ...(facts?.brief ?? []).filter((b) => !target?.includes(b))]
    .filter((p): p is string => !!p)
    .map(escapeMrkdwn);
  const mark = ev.category ? CATEGORY_MARK[ev.category] : undefined;
  const first = `${mark ? `${mark} ` : ""}*[${escapeMrkdwn(ev.label)}]*${pieces.length ? ` ${pieces.join(" · ")}` : ""} — ${actor}`;
  const detailed = style.template === "detailed";
  const rows = detailed ? (facts?.rows ?? []).map((r) => `>${r.label}  ${escapeMrkdwn(r.value)}`) : [];
  const open = detailed ? link(facts?.href ?? "/owner?tab=audit", style.appUrl, facts?.href ? "에이와에서 열기" : "감사로그에서 보기") : null;
  const body = finish(
    [first, ...rows],
    detailed ? `_${kstClock(ev.createdAt)}_${open ? ` · ${open}` : ""}` : null,
    style,
  );
  return { body, groupLabel: `${ev.label} — ${ev.actorName ?? "시스템"}` };
}

type Item = { body: string; groupLabel: string; createdAt: Date };

function countLines(items: readonly Item[]): string[] {
  const counts = new Map<string, number>();
  for (const i of items) counts.set(i.groupLabel, (counts.get(i.groupLabel) ?? 0) + 1);
  // 나머지 건수 줄도 본문과 같은 가리기를 지난다(codex 2026-09-29 — 11번째부터는 이 경로라 빠져 있었다).
  return [...counts].sort((a, b) => b[1] - a[1]).map(([g, n]) => `• ${scrubSensitive(escapeMrkdwn(g))} ${n}건`);
}

/** 한 번에 여러 건(일괄 배정·출결 한꺼번에) → 종류별 건수 한 통. */
export function renderAggregate(items: readonly Item[], ping: Style["ping"] = "none"): string {
  // 앞 10건은 한 줄씩(누가·무엇을이 보여야 체크할 수 있다 — grok 2차: 출결이 "N건"만 남으면 쓸모없다), 나머지는 종류별 건수.
  const lines = items.slice(0, AGGREGATE_LINES).map((i) => `• ${i.body.split("\n")[0].replace(/^<![a-z]+> /, "")}`);
  const rest = items.slice(AGGREGATE_LINES);
  const tail = rest.length ? [`외 ${rest.length}건`, ...countLines(rest)] : [];
  return withPing(clip([`*[에이와] ${items.length}건*`, ...lines, ...tail].join("\n"), MAX_MESSAGE), ping);
}

/** 요약(방해금지 동안 · 요약만 규칙) — 앞 20건은 시각과 첫 줄, 나머지는 종류별 건수. */
export function renderDigest(items: readonly Item[], ping: Style["ping"] = "none"): string {
  const sorted = [...items].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const from = sorted[0]?.createdAt;
  const to = sorted[sorted.length - 1]?.createdAt;
  const range = from && to ? ` (${kstStamp(from)} ~ ${kstStamp(to)})` : "";
  const lines = sorted.slice(0, DIGEST_LINES).map((i) => `• ${kstClock(i.createdAt)} ${i.body.split("\n")[0].replace(/^<![a-z]+> /, "")}`);
  const rest = sorted.slice(DIGEST_LINES);
  const tail = rest.length ? [`외 ${rest.length}건`, ...countLines(rest)] : [];
  return withPing(clip([`*[에이와] 요약 ${items.length}건*${range}`, ...lines, ...tail].join("\n"), MAX_MESSAGE), ping);
}
