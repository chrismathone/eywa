/**
 * "어디선가 데이터가 바뀌었다" 신호 — 창(iframe)·배경·다른 탭이 같은 origin **BroadcastChannel** 하나로 듣는다.
 *
 * 왜: 창은 별도 문서라([[#55]]) 한 창에서 저장해도 **숨어 있던 다른 창**(최소화·보관 BL3)은 옛 화면을 들고 있다가
 *     다시 열면 그대로 보였다. 부모(RouteWindow)가 이 신호로 "숨어 있는 동안 바뀐 게 있다"를 기억했다가
 *     그 창이 **다시 보일 때** 소프트 새로고침한다(use-window-signals.ts).
 *
 * 무엇을 "바뀜"으로 보나 — 이 문서의 `fetch`를 감싸 **응답을 본 뒤에** 판정한다(실패한 저장은 안 센다):
 *  · 서버 액션(`next-action` 헤더) 중 **Next가 재검증했다고 답한 것**(`x-action-revalidated` = 1|2, 303 리다이렉트 포함).
 *    조회용 서버 액션은 재검증을 안 하므로 안 걸린다 — aywa의 쓰기 액션은 revalidatePath/updateTag를 부른다.
 *    ⚠️ Next는 액션이 **쿠키만** 바꿔도(세션 갱신·보기 쿠키) 1을 단다 — 그땐 쓸데없는 새로고침이 한 번 더 돌 뿐이다.
 *  · 같은 origin `/api/*`에 GET·HEAD가 아닌 요청이 성공(업로드·가져오기 등 라우트 핸들러 쓰기).
 *  · Supabase REST(`/rest/v1/`, `rpc/` 제외)에 GET·HEAD가 아닌 요청이 성공(브라우저에서 직접 쓰는 곳).
 * ⚠️ 이 신호는 **보조**다 — 놓쳐도(네이티브 form 제출 등) 종전 동작(옛 화면)일 뿐 틀린 데이터를 만들지 않는다.
 *    그래서 판정은 넓지 않게, 거짓 양성(쓸데없는 새로고침)도 창이 다시 보일 때 한 번뿐이다.
 * ⚠️ client 전용 — `server-only` 금지([[#61]]).
 */
const CHANNEL_NAME = "eywa-mutations";

export type MutationMessage = { type: "mutated"; at: number };

let channel: BroadcastChannel | null | undefined;
/** 문서별 싱글턴. 미지원(SSR·구형)이면 null → 조용히 no-op. */
function getChannel(): BroadcastChannel | null {
  if (channel !== undefined) return channel;
  try {
    channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(CHANNEL_NAME) : null;
  } catch {
    channel = null;
  }
  return channel;
}

/**
 * 같은 문서 안의 구독자 — BroadcastChannel은 **보낸 객체 자신에게는 배달하지 않는다**. 배경(최상위 프레임)에서
 * 한 저장도 그 문서의 창들이 알아야 하므로 같은 문서 구독자에겐 직접 부른다.
 */
const local = new Set<(m: MutationMessage) => void>();

/** 데이터가 바뀌었음을 이 문서·같은 origin의 다른 문서(창·탭)에 알린다. */
export function publishMutation(): void {
  const msg: MutationMessage = { type: "mutated", at: Date.now() };
  for (const cb of local) cb(msg);
  getChannel()?.postMessage(msg);
}

/** "바뀜" 신호 구독(이 문서에서 난 것 포함). 반환 함수로 해제. */
export function subscribeMutations(cb: (m: MutationMessage) => void): () => void {
  local.add(cb);
  const ch = getChannel();
  const handler = (e: MessageEvent) => {
    const m = e.data as MutationMessage | undefined;
    if (m && m.type === "mutated") cb(m);
  };
  ch?.addEventListener("message", handler);
  return () => {
    local.delete(cb);
    ch?.removeEventListener("message", handler);
  };
}

function headerOf(headers: HeadersInit | undefined, name: string): string | null {
  if (!headers) return null;
  if (typeof Headers !== "undefined" && headers instanceof Headers) return headers.get(name);
  if (Array.isArray(headers)) {
    const hit = headers.find(([k]) => k.toLowerCase() === name);
    return hit ? hit[1] : null;
  }
  for (const [k, v] of Object.entries(headers)) if (k.toLowerCase() === name) return v;
  return null;
}

/** 요청 한 건이 "바뀜"인지 — 응답까지 보고 판정한다. 순수 함수(Vitest). */
export function isMutationResponse(
  req: { url: string; method: string; nextAction: boolean },
  res: { ok: boolean; revalidated: string | null },
  origin: string,
): boolean {
  const method = req.method.toUpperCase();
  if (method === "GET" || method === "HEAD") return false;
  // 🔴 서버 액션은 상태코드를 안 본다 — `redirect()`로 끝나는 저장(출석 저장·"새 X" 폼 등)은 **303**이라 `ok`가 false다.
  //    재검증 헤더는 그래도 실린다(Next action-handler가 finally에서 단다). 재검증을 했다 = 무언가 바꿨다.
  if (req.nextAction) return res.revalidated === "1" || res.revalidated === "2";
  if (!res.ok) return false;
  let url: URL;
  try {
    url = new URL(req.url, origin);
  } catch {
    return false;
  }
  if (url.origin === origin) return url.pathname.startsWith("/api/");
  return url.pathname.includes("/rest/v1/") && !url.pathname.includes("/rest/v1/rpc/");
}

const INSTALLED = "__eywaMutationFetch";

/**
 * 이 문서의 `fetch`를 한 번 감싼다(멱등). 응답은 **그대로** 돌려준다(본문을 읽지 않는다 — 헤더만 본다).
 * 판정·방송에서 무슨 일이 나도 요청 결과는 바뀌지 않는다(try로 격리).
 */
export function installMutationDetector(): void {
  if (typeof window === "undefined" || typeof window.fetch !== "function") return;
  const w = window as unknown as Record<string, unknown>;
  if (w[INSTALLED]) return;
  w[INSTALLED] = true;
  const original = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const res = await original(input, init);
    try {
      const isReq = typeof Request !== "undefined" && input instanceof Request;
      const url = isReq ? (input as Request).url : String(input);
      const method = init?.method ?? (isReq ? (input as Request).method : "GET");
      const nextAction =
        headerOf(init?.headers, "next-action") !== null ||
        (isReq && (input as Request).headers.get("next-action") !== null);
      if (
        isMutationResponse(
          { url, method, nextAction },
          { ok: res.ok, revalidated: res.headers.get("x-action-revalidated") },
          window.location.origin,
        )
      ) {
        publishMutation();
      }
    } catch {
      /* 판정 실패는 무시 — 요청 결과엔 영향 없음 */
    }
    return res;
  };
}
