import "server-only";

/**
 * 인재원 학습 프로그램 읽기 API **호출부**(서버 전용 — 열쇠가 브라우저로 새면 안 된다, 설명서 ②).
 *
 * 🔑 인재원 데이터는 **한 학원(injaewon)의 것**이다 — eywa는 여러 학원을 담는 구조라, 설정된 학원(IJW_TENANT_ID)이
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
} as const;

export async function ijwGet<S extends z.ZodTypeAny>(
  tenantId: string,
  path: string,
  schema: S,
): Promise<IjwResult<z.infer<S>>> {
  const conf = ijwConfigFor(tenantId);
  if (!conf) return fail("not_configured");
  let res: Response;
  try {
    res = await fetch(`${conf.url}${path}`, {
      headers: { authorization: `Bearer ${conf.secret}` },
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    return fail("unreachable", e instanceof Error ? e.message : String(e));
  }
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
