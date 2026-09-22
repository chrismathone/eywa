import "server-only";

/**
 * 인재원 학습 프로그램 읽기 API **호출부**(서버 전용 — 열쇠가 브라우저로 새면 안 된다, 설명서 ②).
 *
 * 🔑 인재원 데이터는 **한 학원(injaewon)의 것**이다 — aywa는 여러 학원을 담는 구조라, 설정된 학원(IJW_TENANT_ID)이
 *    아닌 요청은 부르지 않는다(오늘의수학 연계 TODAYS_MATH_TENANT_ID와 같은 규약).
 * 🔑 실패는 종류로 돌려준다 — 화면이 "설정 없음"과 "서버 꺼짐"과 "열쇠 틀림"을 한 문장으로 뭉개지 않게.
 *    원문(HTTP·오류)은 `detail`로만 싣고 화면엔 title 툴팁으로만 보인다(raw 노출 금지). 단 400은 인재원이 적어 준
 *    한국어 문장이 원인을 가장 잘 말해서 본문으로 쓴다(ijwFailMessage).
 * ⚠️ 응답은 부를 때마다 새로 계산된다(no-store). 학부모에게 나가는 글에 쓸 땐 **보낼 때 받은 값을 보고서와
 *    함께 저장**할 것(설명서 ⑤) — 그 저장은 발송 레일 몫이다.
 */
import type { z } from "zod";
import { IJW_FAIL_TEXT, failKindOfStatus, ijwFailMessage, type IjwFailKind } from "../contract";

export type IjwFailure = { ok: false; kind: IjwFailKind; message: string; detail?: string };
export type IjwResult<T> = { ok: true; data: T } | IjwFailure;

/** 인재원 한 번 부르는 상한 — 화면 렌더 중에 부르므로 오래 매달리지 않는다(설명서 실측: 반 묶음 0.2~0.4초). */
const TIMEOUT_MS = 8000;
/**
 * 연결 실패(시간 초과·네트워크)가 **연달아** `PAUSE_AFTER_FAILURES`번이면 이 시간 동안은 부르지 않고 바로 실패한다 —
 * 인재원이 멈춘 동안 일괄 저장이 보고서마다 8초씩 매달리지 않게(적대 재리뷰 2026-09-11). 한 번의 일시 실패로
 * 모든 JJ 화면을 막지 않으려고 연속 횟수를 본다. 응답을 한 번이라도 받으면(4xx·5xx 포함 — 서버는 살아 있다) 셈을 지운다.
 * 서버 인스턴스 안에서만 공유된다(최선 노력).
 */
const PAUSE_AFTER_UNREACHABLE_MS = 30_000;
const PAUSE_AFTER_FAILURES = 2;
let pausedUntil = 0;
let consecutiveFailures = 0;
/** 마지막 연결 실패 시각 — 그보다 **먼저 시작한** 요청의 실패는 같은 한 번으로 친다(Promise.all로 함께 나간 요청들). */
let lastFailAt = 0;

function fail(kind: IjwFailKind, detail?: string): IjwFailure {
  return { ok: false, kind, message: IJW_FAIL_TEXT[kind], detail };
}

/** 이 학원이 인재원 연동을 쓰는가 — 주소·열쇠·학원이 모두 맞을 때만. */
export function ijwConfigFor(tenantId: string): { url: string; secret: string } | null {
  const url = (process.env.IJW_API_URL ?? "").trim().replace(/\/+$/, "");
  const secret = (process.env.IJW_API_SECRET ?? "").trim();
  const tenant = (process.env.IJW_TENANT_ID ?? "").trim();
  if (!url || !secret || !tenant || tenant !== tenantId) return null;
  return { url, secret };
}

const enc = encodeURIComponent; // 아이디에 한글이 있다(설명서 '설정')
const qs = (p: Record<string, string | undefined>) => {
  const s = new URLSearchParams(Object.entries(p).filter((e): e is [string, string] => !!e[1])).toString();
  return s ? `?${s}` : "";
};

/** 입구 주소(설명서 '입구 8개'). 날짜는 YYYY-MM-DD — 시험은 KST 달력, 학습은 학습일로 해석된다. */
export const IJW_PATHS = {
  students: () => "/ext/eywa/students",
  studentExams: (ijwId: string) => `/ext/eywa/students/${enc(ijwId)}/exams`,
  examResult: (attemptId: string) => `/ext/eywa/exams/${enc(attemptId)}`,
  study: (ijwId: string, from?: string, to?: string) => `/ext/eywa/students/${enc(ijwId)}/study${qs({ from, to })}`,
  examSummary: (from?: string, to?: string) => `/ext/eywa/exams${qs({ from, to })}`,
  deckResults: (deckId: string) => `/ext/eywa/exams/deck/${enc(deckId)}`,
  studySummary: (from?: string, to?: string, className?: string) => `/ext/eywa/study${qs({ from, to, className })}`,
  /** 5번 하루치 — `date`는 꼭 넣는다(시험 = 그 KST 달력 날짜 전부, 학습 = 그날까지 30학습일). */
  day: (ijwId: string, date: string) => `/ext/eywa/students/${enc(ijwId)}/day${qs({ date })}`,
} as const;

export async function ijwGet<S extends z.ZodTypeAny>(
  tenantId: string,
  path: string,
  schema: S,
): Promise<IjwResult<z.infer<S>>> {
  const conf = ijwConfigFor(tenantId);
  if (!conf) return fail("not_configured");
  if (Date.now() < pausedUntil) return fail("unreachable", "최근 연결 실패 — 잠시 뒤 다시 부른다");
  const startedAt = Date.now();
  let res: Response;
  try {
    res = await fetch(`${conf.url}${path}`, {
      headers: { authorization: `Bearer ${conf.secret}` },
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    // 함께 나간 요청들(학생 상세의 두 입구 등)이 한꺼번에 실패하면 한 번으로 센다 — 일시 실패 한 번에 멈추지 않게.
    // 🔴 `lastFailAt`은 **센 실패에서만** 옮긴다 — 안 센 실패까지 옮기면 겹치는 요청이 계속 들어오는 동안 연속 실패가
    //    영영 2가 안 돼 멈춤이 안 걸린다(적대 재리뷰).
    if (startedAt > lastFailAt) {
      consecutiveFailures += 1;
      lastFailAt = Date.now();
    }
    if (consecutiveFailures >= PAUSE_AFTER_FAILURES) pausedUntil = Date.now() + PAUSE_AFTER_UNREACHABLE_MS;
    return fail("unreachable", e instanceof Error ? e.message : String(e));
  }
  // 응답을 받았다 = 서버는 살아 있다 — 셈과 멈춤을 함께 푼다(멈춘 뒤 늦게 온 성공도 멈춤을 푼다).
  consecutiveFailures = 0;
  pausedUntil = 0;
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
    const said = typeof body?.error === "string" ? body.error : "";
    const kind = failKindOfStatus(res.status, said);
    return { ok: false, kind, message: ijwFailMessage(kind, said), detail: `HTTP ${res.status}${said ? ` · ${said}` : ""}` };
  }
  const json: unknown = await res.json().catch(() => null);
  const parsed = schema.safeParse(json);
  if (!parsed.success) return fail("bad_response", parsed.error.message.slice(0, 200));
  return { ok: true, data: parsed.data };
}
