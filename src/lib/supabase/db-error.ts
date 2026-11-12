// Postgres/PostgREST 에러를 사용자용 한글 이유로 변환(판정은 순수, 로그는 explainDbError만).
// UI 규칙: 기술 에러 원문을 그대로 노출하지 말 것 — 한글 요약을 보여주고 원문은 title 툴팁으로만.
// 선례: humanizeClassnoteError([src/features/report-admin/classnote-error.ts]).
// ⚠️ `import "server-only"` 금지([[#61]]) — 클라이언트도 import할 수 있어야 한다. 서버 액션 파일이 아니라 동기 export 가능([[#119]]).
import { reportError, reportWarning } from "@/lib/observability/report-error";
import { CONSTRAINT_MESSAGES, checkConstraintMessage, type ConstraintMessage } from "./db-error-constraints";

/** @param action 사용자가 시도한 동작("저장"·"삭제"·"수정") — 문장에 그대로 들어간다. */
export function humanizeDbError(raw: string | null | undefined, action = "저장"): string {
  const r = (raw ?? "").trim();
  // ⚠️ **권한·입력 패턴보다 먼저.** 스키마/관계 오류는 사용자가 뭘 잘못한 게 아니라 **코드가 틀린 것**이라
  // "형식을 확인하세요"처럼 사용자를 탓하는 문장으로 흘러가면 안 된다(원장이 자기 입력을 계속 고치게 된다).
  // 2026-08-03 실사례: 0171a가 `makeup_class_id`를 더해 lesson_reports→classes FK가 2개가 되자
  // 보고서 목록의 `classes(...)` 임베드가 PGRST201로 실패 → 영문 원문이 그대로 토스트에 떴다.
  // ⚠️ 이건 새로고침으로 낫지 않으므로 "다시 시도" 안내를 하지 말 것 — 배포로만 고쳐진다.
  if (/PGRST(100|200|201|202|204)|more than one relationship|Could not embed|Could not find a relationship|does not exist|schema cache/i.test(r))
    return "화면을 구성하는 데이터 설정에 문제가 있어 불러오지 못했습니다 — 입력하신 값 때문이 아니니 관리자에게 알려 주세요";
  if (/row-level security|permission denied|insufficient privilege|not authorized/i.test(r))
    return `${action} 권한이 없습니다 — 이 문서를 다룰 수 있는 계정인지 확인하세요`;
  if (/JWT|token is expired|invalid claim|refresh_token/i.test(r))
    return "로그인이 만료되었습니다 — 새로고침한 뒤 다시 시도하세요";
  if (/duplicate key|unique constraint/i.test(r)) return "이미 같은 내용이 저장되어 있습니다";
  if (/violates foreign key|violates check constraint|invalid input syntax/i.test(r))
    return `입력한 값이 올바르지 않아 ${action}하지 못했습니다 — 각 칸의 형식을 확인하세요`;
  if (/timeout|ETIMEDOUT|canceling statement/i.test(r))
    return `${action} 시간이 초과되었습니다 — 잠시 후 다시 시도하세요`;
  if (/fetch failed|ECONNREFUSED|ENOTFOUND|network|ERR_/i.test(r))
    return "서버에 연결하지 못했습니다 — 인터넷 연결을 확인한 뒤 다시 시도하세요";
  return `${action}하지 못했습니다 — 자세한 내용은 마우스를 올려 확인하세요`;
}

// ───────────────────────── 코드·제약 이름 판정(2026-10-01) ─────────────────────────
// 배경: 반 이름 PL4→PL5 개명이 "저장에 실패했습니다"로만 실패했다 — 실제 원인은 23505(종강 반이 이름을 쥠)인데
// 액션이 모든 DB 오류를 같은 문구로 바꾸고 로그도 안 남겨 원장도 개발자도 이유를 몰랐다([[#138]]).
// 🔴 판정은 **오류 코드 + 제약 이름**으로만 한다(영문 문장의 단어를 보고 뜻을 짐작하지 않는다). 제약 이름은
//    PostgREST가 따로 주지 않아 원문의 따옴표 식별자(`constraint "이름"`)에서만 읽는다 — 식별자 추출일 뿐 문구 해석이 아니다.

export type DbErrorKind =
  | "duplicate" | "overlap" | "in_use" | "missing_ref" | "invalid" | "required" | "too_long"
  | "permission" | "guard" | "auth" | "busy" | "timeout" | "schema" | "format" | "unknown";

/**
 * message = 화면용 한글(모르면 fallback) · known=false = fallback을 돌려줬다 · specific = 제약 표의 맞춤 문구를 썼다(영역 번역기가
 * 자기 문구보다 앞세울 때) · field = 이유를 붙일 폼 칸 · raw = 원문(🔴 화면 본문 금지 — title 툴팁·로그용).
 */
export type DbErrorInfo = {
  message: string; kind: DbErrorKind; known: boolean; specific: boolean;
  code: string | null; constraint: string | null; field?: string; raw: string;
};

/** fallback = 모르는 오류일 때 지금 화면 문구 · op = 23503의 방향(지우기면 "delete", 기본 "write") · constraints = 이 호출만의 제약 문구(공용 표보다 우선). */
export type DescribeDbErrorOptions = { fallback: string; op?: "write" | "delete"; constraints?: Record<string, ConstraintMessage> };

function str(error: unknown, key: string): string {
  if (!error || typeof error !== "object") return "";
  const v = (error as Record<string, unknown>)[key];
  return typeof v === "string" ? v : "";
}

/** 원문의 `constraint "이름"`에서 제약 식별자만 꺼낸다(없으면 null). */
export function dbConstraintName(error: unknown): string | null {
  const m = str(error, "message").match(/constraint "([^"]+)"/);
  return m ? m[1] : null;
}

/**
 * 트리거·RPC가 RAISE한 문장을 화면에 그대로 보여도 되는가 — 우리 마이그레이션은 사람에게 보일 한글 문장으로
 * RAISE하는 곳이 많다(수납 배분·보호 계정·직원 권한 등). 함수명 접두(`merge_x: `)·괄호 속 영문 식별자는 걷고,
 * 그래도 영문이 남거나(`not_found`·`ECS_BAD_TERM`) 한글이 거의 없으면 원문으로 보고 null.
 */
function displayableRaise(message: string): string | null {
  const m = message.trim().replace(/^[a-z_][a-z0-9_]*:\s*/i, "").replace(/\s*\([A-Za-z_][\w.]*\)/g, "").trim();
  if (!m) return null;
  // 식별자 꼴(밑줄 · 낙타 표기 · 7자 넘는 영문 낱말)이 남으면 원문으로 본다(`invalid_move`·`ECS_BAD_TERM`·`violates`).
  // 짧은 대문자 약어·강의실 번호(JJ · LAB · B201)는 사람에게 보일 한글 문장 속 값이라 둔다(P1-E 리뷰 — '등록되지 않은 강의실입니다: B201').
  // 🔴 소문자로 시작하는 영문 낱말은 칸·표 이름일 수 있어 막는다('바꿀 수 없는 항목입니다: email').
  if (/[A-Za-z0-9]_|_[A-Za-z]/.test(m) || /[A-Za-z]{7,}/.test(m) || /[a-z][A-Z]/.test(m) || /\b[a-z]{2,}/.test(m)) return null;
  const latin = (m.match(/[A-Za-z]/g) ?? []).length;
  const hangul = (m.match(/[가-힣]/g) ?? []).length;
  return hangul >= 4 && hangul >= latin * 3 ? m : null;
}

const SCHEMA_CODES = new Set(["PGRST200", "PGRST201", "PGRST202", "PGRST204", "PGRST205", "42P01", "42703", "42883"]);
const FORMAT_CODES = new Set(["22P02", "22007", "22008", "22003", "22023"]);

export function describeDbError(error: unknown, opts: DescribeDbErrorOptions): DbErrorInfo {
  const code = str(error, "code") || null;
  const raw = str(error, "message");
  const constraint = dbConstraintName(error);
  const op = opts.op ?? "write";
  const base = { code, constraint, raw };
  const entry = constraint ? (opts.constraints?.[constraint] ?? CONSTRAINT_MESSAGES[constraint]) : undefined;
  const usable = entry && (!entry.op || entry.op === op) ? entry : undefined;
  const hit = (kind: DbErrorKind, message: string, field?: string): DbErrorInfo =>
    ({ ...base, kind, known: true, specific: !!usable && message === usable.message, message, ...(field ? { field } : {}) });

  switch (code) {
    case "23505":
      return hit("duplicate", usable?.message ?? "이미 같은 내용이 저장되어 있습니다 — 겹치는 항목이 있는지 확인해 주세요", usable?.field);
    case "23P01":
      return hit("overlap", usable?.message ?? "기간이 겹치는 기록이 이미 있습니다 — 날짜를 확인해 주세요", usable?.field);
    case "23503":
      if (op === "delete")
        return hit("in_use", usable?.message ?? "다른 기록이 이 항목을 쓰고 있어 지울 수 없습니다");
      return hit("missing_ref", usable?.message ?? "연결하려는 항목을 찾을 수 없습니다 — 이미 지워졌을 수 있으니 새로고침한 뒤 다시 시도해 주세요");
    case "23514": {
      // 트리거가 23514로 한글 사유를 RAISE하는 곳이 있다(퇴원보고서 환불 요청서 잠금 등 — 제약 이름 없음) → 그 문장을 살린다(P1-E 리뷰).
      const byName = usable?.message ?? checkConstraintMessage(constraint) ?? (constraint ? null : displayableRaise(raw));
      return hit("invalid", byName ?? "입력한 값이 허용 범위를 벗어났습니다 — 날짜·숫자·선택 값을 확인해 주세요", usable?.field);
    }
    case "23502":
      // NOT NULL 위반은 폼 검증을 지난 뒤라 대개 **코드 버그**다 — 사용자를 탓하지 않고 지금 문구 + 에러 로그([[#138]] 리뷰).
      return { ...base, kind: "required", known: false, specific: false, message: opts.fallback };
    case "22001":
      return hit("too_long", "입력한 글이 너무 깁니다 — 줄여서 다시 저장해 주세요");
    case "42501": {
      // 🔴 같은 코드, 다른 원인: RLS 거부도 42501이지만 users 표의 보호 트리거도 42501로 한글 이유를 RAISE한다.
      const said = displayableRaise(raw);
      return said ? hit("guard", said) : hit("permission", "이 작업을 할 권한이 없습니다 — 계정 권한을 확인해 주세요");
    }
    case "P0001": {
      const said = displayableRaise(raw);
      if (said) return hit("guard", said);
      break;
    }
    case "PGRST301":
    case "PGRST303":
      return hit("auth", "로그인이 만료되었습니다 — 새로고침한 뒤 다시 시도해 주세요");
    case "57014":
      return hit("timeout", "처리 시간이 초과되었습니다 — 잠시 후 다시 시도해 주세요");
    case "40001":
    case "40P01":
    case "55P03":
      return hit("busy", "다른 저장과 동시에 처리되어 실패했습니다 — 다시 시도해 주세요");
    default:
      // 형식 오류(uuid·날짜·숫자)도 서버 검증을 지난 뒤라 대개 코드 버그 — 지금 문구 + 에러 로그(원문의 입력값은 로그에서 가린다).
      if (code && FORMAT_CODES.has(code)) return { ...base, kind: "format", known: false, specific: false, message: opts.fallback };
      // 사용자를 탓하지 않는다 — 배포로만 고쳐지는 오류라 "다시 시도"도 권하지 않는다(humanizeDbError와 같은 규약).
      if (code && SCHEMA_CODES.has(code))
        return hit("schema", "화면을 구성하는 데이터 설정에 문제가 있습니다 — 입력하신 값 때문이 아니니 관리자에게 알려 주세요");
  }
  return { ...base, kind: "unknown", known: false, specific: false, message: opts.fallback };
}

/** 로그용 details — 키 값·실패 행(학생 이름·연락처가 들어간다)은 가린다. 컬럼 이름은 남긴다. */
export function maskDbDetails(details: string): string {
  const masked = details
    // (`s` 플래그는 tsconfig 대상이 ES2018 미만이라 못 쓴다 → 줄바꿈까지 `[\s\S]`로.)
    .replace(/Failing row contains \([\s\S]*\)\.?/, "Failing row contains (…).")
    // 값 묶음의 끝은 괄호 짝으로 못 찾는다(daterange 값 `[2026-01-01,infinity)`가 짝을 깬다) → 뒤따르는 Postgres 문구로 끊는다.
    .replace(/=\([\s\S]*?\)(?=\s+(?:already exists|is still referenced|is not present|conflicts with)|\.?$)/g, "=(…)");
  // 못 가린 값 묶음이 남으면 통째로 버린다(로그에 이름이 새는 것보다 details를 잃는 게 낫다).
  return /=\((?!…\))/.test(masked) ? "(값 생략)" : masked;
}

const USER_CAUSED: ReadonlySet<DbErrorKind> = new Set([
  "duplicate", "overlap", "in_use", "missing_ref", "invalid", "too_long", "guard",
]);

/** 로그용 원문 — 형식 오류(22xxx)는 원문 따옴표 안에 **입력값**이 들어간다(`invalid input syntax for type uuid: "값"`). */
function rawForLog(code: string | null, raw: string): string {
  return code && code.startsWith("22") ? raw.replace(/"[^"]*"/g, '"…"') : raw;
}

/**
 * 서버 액션의 `if (error)` 자리용 — 판정(describeDbError) + **로그 한 줄**.
 * 입력 때문에 생긴 오류(중복·겹침 등)는 경고로, 모르는 오류·권한·스키마는 에러로 남긴다(Vercel 로그에서 `scope`로 찾는다).
 * 🔴 로그엔 원문 메시지·코드·제약 이름만 — details의 값(학생 이름 등)은 maskDbDetails로 가린다.
 */
export function explainDbError(
  error: unknown,
  opts: DescribeDbErrorOptions & {
    scope: string;
    context?: Record<string, unknown>;
    /** 입력 원인이라도 에러로 남길 때(예: 로그인 계정은 지웠는데 직원 행 삭제가 막힌 치명적 불일치). */
    level?: "error";
  },
): DbErrorInfo {
  const info = describeDbError(error, opts);
  // 오류 객체가 없으면(`if (error || !data)`의 0행 쪽) DB 오류가 아니다 — "알 수 없는 DB 오류"를 지어 남기지 않는다.
  if (!error) return info;
  const details = maskDbDetails(str(error, "details"));
  const raw = rawForLog(info.code, info.raw);
  const ctx = { scope: opts.scope, ...opts.context, dbKind: info.kind, code: info.code, constraint: info.constraint };
  if (USER_CAUSED.has(info.kind) && opts.level !== "error") {
    reportWarning(raw || info.kind, { ...ctx, details: details || undefined });
  } else {
    const e = Object.assign(new Error(raw || "알 수 없는 DB 오류"), {
      code: info.code, details, hint: str(error, "hint"),
    });
    e.stack = undefined;
    reportError(e, ctx);
  }
  return info;
}

/**
 * 화면 문구는 그대로 두고 **로그만** 남긴다 — 이유를 보여 주기엔 이른 자리(조회 실패·공개 화면·부분 실패 안내 등)용.
 * error가 비어 있으면(0행·not found처럼 DB 오류가 아닌 실패) 아무것도 안 남긴다.
 */
export function logDbError(error: unknown, scope: string, context?: Record<string, unknown>): void {
  explainDbError(error, { scope, fallback: "", context });
}

// ───────────────────────── "아직 없음"(SQL 미적용) 판정 — 공용(수정 계획 P1-E · 리뷰 E2) ─────────────────────────
// #95(앱이 SQL보다 먼저 나간다) 때문에 "표·칸·함수가 아직 없으면 조용히 비켜 가는" 방어가 33곳에 손으로 있었는데 범위가 제각각이었다:
//  · 표 **이름만** 보는 곳 — 권한 거부·유니크 위반처럼 메시지에 표 이름이 들어가는 다른 오류도 "표 없음"으로 삼켰다(#138).
//  · `does not exist`**만** 보는 곳 — 다른 표·칸·함수가 없어도 이 기능을 꺼 버렸다(형제 연결이 칸 하나 때문에 숨음).
// 규칙(둘 다 필요): ① 원문에 **대상 식별자**가 있다 ② 코드가 그 "없음" 코드다 — 코드가 비어 있을 때(문자열로 감싼 오류)만 문구로 본다.
// 🔴 다른 코드(42501 권한·23505 유니크 등)가 붙어 있으면 문구가 뭐라든 "없음"이 아니다(코드가 이긴다).

function missingProbe(error: unknown): { code: string; text: string } {
  if (typeof error === "string") return { code: "", text: error };
  if (error instanceof Error && !str(error, "code")) return { code: "", text: error.message };
  return { code: str(error, "code"), text: [str(error, "message"), str(error, "details"), str(error, "hint")].join(" ") };
}
function mentions(text: string, idents: string | readonly string[]): boolean {
  const lower = text.toLowerCase();
  return (typeof idents === "string" ? [idents] : idents).some((id) => id && lower.includes(id.toLowerCase()));
}
function missingOf(codes: readonly string[], words: RegExp) {
  return (error: unknown, idents: string | readonly string[]): boolean => {
    if (!error) return false;
    const { code, text } = missingProbe(error);
    if (!mentions(text, idents)) return false;
    if (code) return codes.includes(code);
    return words.test(text);
  };
}

/** 표가 아직 없다(42P01 · PGRST205) — `table`(또는 후보 여럿)이 원문에 있어야 참. */
export const isMissingRelation = missingOf(["42P01", "PGRST205"], /does not exist|could not find the table|schema cache/i);
/** 칸이 아직 없다(42703 · PGRST204) — `column`이 원문에 있어야 참. */
export const isMissingColumn = missingOf(["42703", "PGRST204"], /does not exist|could not find the .*column|schema cache/i);
/** 함수(RPC)가 아직 없다(42883 · PGRST202) — `fn`이 원문에 있어야 참. */
export const isMissingFunction = missingOf(["42883", "PGRST202"], /does not exist|could not find the function|schema cache/i);
