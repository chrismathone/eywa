import { EXPENSE_CATEGORIES, INCOME_CATEGORIES } from "@/features/approvals/types";
import { formatMoney } from "@/features/billing/currencies";
import { scrubSensitive } from "./render";
import { shortDate } from "./short-date";

/**
 * 슬랙 활동 **'자세히'에 싣는 내용**(원장 2026-09-29 *"내용을 알 수 있는 메시지들은 내용까지 첨부하도록 '자세히' 일 경우.
 * 필요한 정보들은 전부"*) — `activityChange`가 다루지 않는 액션의 `action × 키` 허용 목록. 순수 함수(Vitest).
 * 첫 줄(`brief`)은 짧게, 내용은 `rows`(자세히의 인용 줄)에. 🔴 라벨은 등록된 값만 · 모르는 키·원문 enum은 싣지 않는다.
 * 감사로그의 옛 행은 빈 값을 문자열 `"null"`로 들고 있다 — `blank`가 빈칸으로 읽는다.
 */
export type Detail = { brief: string[]; rows: { label: string; value: string }[] };
const NONE: Detail = { brief: [], rows: [] };

export const blank = (v: unknown) => v === null || v === undefined || (typeof v === "string" && (v.trim() === "" || v === "null"));
const text = (v: unknown, max: number) => {
  if (blank(v) || typeof v !== "string") return null;
  const t = v.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};
const count = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null);
/** JSON 문자열로 저장된 배열도 읽는다(`changed: "[\"비고\"]"`). */
const list = (v: unknown): unknown[] => {
  if (Array.isArray(v)) return v;
  if (typeof v !== "string") return [];
  try {
    const p = JSON.parse(v);
    return Array.isArray(p) ? p : [];
  } catch {
    return [];
  }
};
const hangul = (v: unknown, max: number) => {
  const t = text(v, max);
  return t && /[가-힣]/.test(t) ? t : null; // 한글 라벨만 — 영문 내부 키는 싣지 않는다
};
const dateOrNone = (v: unknown) => (blank(v) ? "(없음)" : shortDate(v));
const won = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? formatMoney(v, "KRW") : null);

const DATE_FIELD: Record<string, string> = { start: "시작일", end: "종료일" };
const UUID_LIKE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

export function activityDetail(action: string, m: Record<string, unknown>): Detail {
  switch (action) {
    case "enrollment_dates_update": {
      const field = typeof m.field === "string" && Object.hasOwn(DATE_FIELD, m.field) ? DATE_FIELD[m.field]! : null;
      const from = dateOrNone(m.from);
      const to = dateOrNone(m.to);
      if (!field || !from || !to) return NONE;
      const v = `${field} ${from} → ${to}`;
      return { brief: [v], rows: [{ label: "수강일", value: v }] };
    }
    case "enrollment_assign": {
      const d = shortDate(m.startDate);
      return d ? { brief: [`${d}부터`], rows: [{ label: "시작일", value: d }] } : NONE;
    }
    // enrollment_end는 날짜가 `date`라 activityFacts가 이미 첫 줄·'날짜' 줄에 싣는다(두 번 찍지 않는다).
    case "class_update": {
      // changes = [{field(한글), from, to}] — 값이 있는 것만 전후를 싣고, 없으면 무엇을 바꿨는지만.
      const changes = list(m.changes).filter((c): c is Record<string, unknown> => !!c && typeof c === "object");
      const fields = changes.map((c) => hangul(c.field, 40)).filter((x): x is string => !!x);
      const rows = changes.flatMap((c) => {
        const f = hangul(c.field, 40);
        if (!f) return [];
        // 🔴 예약 적용 cron은 담임·강의실을 **id 그대로** 적는다 — uuid 모양 값은 싣지 않는다(raw 코드 노출 금지).
        const fromId = UUID_LIKE.test(String(c.from ?? ""));
        const toId = UUID_LIKE.test(String(c.to ?? ""));
        const from = fromId ? null : text(c.from, 80);
        const to = toId ? null : text(c.to, 80);
        if (!from && !to) return [];
        // 값이 id였던 쪽은 '빈칸'이 아니라 '(이전 값)'/'(새 값)' — 있었는데 없었다고 말하지 않는다.
        return [{ label: f, value: `${from ?? (fromId ? "(이전 값)" : "(빈칸)")} → ${to ?? (toId ? "(새 값)" : "(빈칸)")}` }];
      });
      // 값이 전부 id라 전후를 못 적으면 무엇을 바꿨는지 한 줄 — 이 줄이 있어야 감사로그 설명(uuid 포함)으로 넘어가지 않는다.
      const hadIds = changes.some((c) => UUID_LIKE.test(String(c.from ?? "")) || UUID_LIKE.test(String(c.to ?? "")));
      if (!rows.length && hadIds && fields.length) rows.push({ label: "바꾼 칸", value: fields.join(", ") });
      const eff = shortDate(m.effectiveDate) ?? shortDate(m.scheduledFrom);
      if (eff) rows.push({ label: "적용일", value: eff });
      return fields.length ? { brief: [`${fields.join("·")} 수정`], rows } : NONE;
    }
    case "inventory_asset_update": {
      const fields = list(m.changed).map((f) => hangul(f, 20)).filter((x): x is string => !!x);
      return fields.length ? { brief: [`${fields.join("·")} 수정`], rows: [{ label: "바꾼 칸", value: fields.join(", ") }] } : NONE;
    }
    case "ecs_plan_copy": {
      const src = shortDate(m.sourceDate);
      const n = count(m.copied);
      if (!src) return NONE;
      const v = `${src} 계획에서${n !== null ? ` ${n}줄` : ""} 복사`;
      return { brief: [v], rows: [{ label: "복사", value: v }] };
    }
    case "ecs_plan_line_add":
      return { brief: ["줄 추가"], rows: [] };
    case "ecs_plan_line_delete":
      return { brief: ["줄 삭제"], rows: [] };
    case "textbook_order_check": {
      const f = hangul(m.fieldLabel, 12);
      if (!f || typeof m.checked !== "boolean") return NONE;
      const v = `${f} ${m.checked ? "체크" : "해제"}`;
      return { brief: [v], rows: [{ label: "체크", value: v }] };
    }
    case "student_consultation_create": {
      const rows = [
        ...(shortDate(m.consultedAt) ? [{ label: "상담일", value: shortDate(m.consultedAt)! }] : []),
        ...(shortDate(m.followUpDate) ? [{ label: "후속 예정", value: shortDate(m.followUpDate)! }] : []),
      ];
      return { brief: [], rows };
    }
    case "mcs_learning_goal_save": {
      const book = text(m.textbook, 40);
      const s = shortDate(m.startDate);
      const e = shortDate(m.endDate);
      const rows = [
        ...(book ? [{ label: "교재", value: book }] : []),
        ...(s || e ? [{ label: "기간", value: `${s ?? "?"} ~ ${e ?? "?"}` }] : []),
      ];
      return { brief: [], rows };
    }
    case "approval_submit": {
      // 전자결재 지출·수입결의서(원장 2026-09-29 ③ 분류·지출일·금액). 휴가 기안 등 다른 양식은 이 키가 없다.
      const cats: readonly string[] = [...EXPENSE_CATEGORIES, ...INCOME_CATEGORIES];
      const cat = typeof m.category === "string" && cats.includes(m.category) ? m.category : null;
      const spend = shortDate(m.spendDate);
      const income = shortDate(m.incomeDate);
      const amount = won(m.amount);
      const rows = [
        ...(cat ? [{ label: "분류", value: cat }] : []),
        ...(spend ? [{ label: "지출일", value: spend }] : []),
        ...(income ? [{ label: "수입일", value: income }] : []),
        ...(amount ? [{ label: "금액", value: amount }] : []),
      ];
      const brief = [cat, spend ? `지출일 ${spend}` : income ? `수입일 ${income}` : null, amount].filter((x): x is string => !!x);
      return { brief, rows };
    }
    case "slack_rule_save": {
      // 첫 줄에 켜짐·꺼짐(바뀌었으면 전 → 후) — 나머지 바뀐 것은 자세히의 '내용' 줄(감사로그 설명)이 말한다.
      const onOff = (v: unknown) => (v === false ? "꺼짐" : v === true ? "켜짐" : null);
      const after = onOff(m.enabled);
      const b = m.before && typeof m.before === "object" ? onOff((m.before as Record<string, unknown>).enabled) : null;
      if (!after) return NONE;
      return { brief: [b && b !== after ? `${b} → ${after}` : m.created === true ? `새 규칙 · ${after}` : after], rows: [] };
    }
    default:
      return NONE;
  }
}

const UUID_ANY = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/**
 * 감사로그 설명(`auditDetail`) → 슬랙 '자세히'의 **내용** 줄. 설명은 ` · `로 이은 조각이다 —
 *  · uuid가 든 조각은 통째로 뺀다(예약 적용 cron의 담임·강의실 id 등 — raw 코드 노출 금지, 재리뷰 2026-09-29)
 *  · 이미 첫 줄·다른 줄에 있는 조각(학생·반 이름·같은 날짜)은 다시 안 싣는다
 *  · `2026-09-29` 날짜는 `9/29(화)`로 · 가리기는 **자르기 전에**(`scrubSensitive`) · 500자.
 */
export function contentLine(detail: string | null, shown: { brief: readonly string[]; rows: readonly { value: string }[] }): string | null {
  if (!detail) return null;
  const seen = new Set<string>([...shown.brief, ...shown.rows.map((r) => r.value)]);
  const known = [...seen];
  const parts = detail
    .replace(/\s+/g, " ")
    .split(" · ")
    .map((p) => p.trim().replace(/\b(\d{4}-\d{2}-\d{2})\b/g, (d) => shortDate(d) ?? d))
    .filter((p) => p && !UUID_ANY.test(p))
    .filter((p) => !seen.has(p) && !known.some((k) => k.startsWith(`${p} (`) || k.includes(` ${p} `)));
  if (!parts.length) return null;
  const t = scrubSensitive(parts.join(" · "));
  return t.length > 500 ? `${t.slice(0, 499)}…` : t;
}
