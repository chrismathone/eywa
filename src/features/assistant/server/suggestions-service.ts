import "server-only";
/**
 * 추천 질문 서버 몫 — 비서 DB를 열어 신호를 세고(`suggestion-signals.ts`) 질문 6개를 만든다(`../suggestions.ts`).
 * 🔑 하루 한 번: 화면이 사람·날짜로 묶어 브라우저에 두고(`have`), 같은 날이면 서버는 세지 않고 "그대로"만 답한다.
 *    '새로 고침'(refresh)만 다시 센다. 같은 인스턴스에서 같은 지점은 잠깐 기억해 연타·여러 탭에 DB를 다시 두드리지 않는다.
 */
import { createHash } from "node:crypto";
import { requireAiLicense } from "@/lib/ai/generate";
import { reportWarning } from "@/lib/observability/report-error";
import { buildSuggestions, FALLBACK_SUGGESTIONS, haveKey, type SuggestionsResponse } from "../suggestions";
import { openAssistantDb } from "./executor";
import { ASSISTANT_FEATURE } from "./models";
import { countSignals, SIGNAL_SQL } from "./suggestion-signals";
import type { Owner } from "./store";

/** 같은 날 다시 세지 않고 돌려줄 시간 — 처음 받기(다른 브라우저·기기) 30분 · '새로 고침' 1분. */
const MEMO_MS = 30 * 60_000;
const REFRESH_MEMO_MS = 60_000;
const memo = new Map<string, { day: string; at: number; items: SuggestionsResponse["items"]; fallback: boolean; partial: boolean }>();
/** 같은 지점·날짜를 세는 중인 것 — 여러 탭·사람이 동시에 열어도 비서 DB를 한 번만 연다(연결 상한을 질문과 나눠 쓴다). */
const inflight = new Map<string, Promise<{ items: NonNullable<SuggestionsResponse["items"]>; fallback: boolean; partial: boolean }>>();

/** 사람·지점 표 — 브라우저 캐시가 다른 사람(같은 컴퓨터) 것인지 가린다. 비밀이 아니다(본인 id의 줄임). */
export function suggestionScope(owner: Owner): string {
  return createHash("sha256").update(`${owner.tenantId}:${owner.userId}`).digest("hex").slice(0, 16);
}

async function compute(tenantId: string, today: string): Promise<{ items: NonNullable<SuggestionsResponse["items"]>; fallback: boolean; partial: boolean }> {
  // 🔴 AI 라이선스가 꺼진 지점은 세지 않는다 — 질문(ask.ts)과 같은 문(꺼진 기능은 서버까지 · 적대 리뷰 2026-11-09). 고정 문장만.
  try {
    await requireAiLicense({ tenantId, feature: ASSISTANT_FEATURE });
  } catch {
    return { items: [...FALLBACK_SUGGESTIONS], fallback: true, partial: false };
  }
  let db: Awaited<ReturnType<typeof openAssistantDb>> | null = null;
  try {
    db = await openAssistantDb(tenantId);
    const { signals, failed } = await countSignals(db);
    if (failed.length) reportWarning("학원 비서 추천 신호 일부 실패", { scope: "assistant.suggestions", tenantId, failed: failed.join(",") });
    if (failed.length === Object.keys(SIGNAL_SQL).length) return { items: [...FALLBACK_SUGGESTIONS], fallback: true, partial: false };
    return { items: buildSuggestions(signals, today), fallback: false, partial: failed.length > 0 };
  } catch (error) {
    reportWarning("학원 비서 추천 질문 계산 실패", { scope: "assistant.suggestions", tenantId, error: error instanceof Error ? error.message : String(error) });
    return { items: [...FALLBACK_SUGGESTIONS], fallback: true, partial: false };
  } finally {
    await db?.close().catch(() => undefined);
  }
}

/**
 * 오늘 추천 질문. `have`가 이 사람·오늘 것이면 세지 않고 `{ scope, day }`만(화면은 가진 묶음을 쓴다).
 * 실패 묶음(고정 문장)·일부만 센 묶음은 1분만 기억한다 — DB가 돌아오면 곧 제대로 센다(일부만 센 묶음은 화면도 오늘 묶음으로 저장하지 않는다).
 */
export async function suggestionsFor(owner: Owner, today: string, opts: { have?: string | null; refresh?: boolean; now?: number } = {}): Promise<SuggestionsResponse> {
  const scope = suggestionScope(owner);
  if (!opts.refresh && opts.have === haveKey(scope, today)) return { scope, day: today };
  const now = opts.now ?? Date.now();
  const hit = memo.get(owner.tenantId);
  const ttl = opts.refresh || hit?.fallback || hit?.partial ? REFRESH_MEMO_MS : MEMO_MS;
  if (hit && hit.day === today && now - hit.at < ttl && hit.items) {
    return { scope, day: today, items: hit.items, ...(hit.fallback ? { fallback: true } : {}), ...(hit.partial ? { partial: true } : {}) };
  }
  const flight = `${owner.tenantId}:${today}`;
  let pending = inflight.get(flight);
  if (!pending) {
    pending = compute(owner.tenantId, today).finally(() => inflight.delete(flight));
    inflight.set(flight, pending);
  }
  const { items, fallback, partial } = await pending;
  memo.set(owner.tenantId, { day: today, at: now, items, fallback, partial });
  return { scope, day: today, items, ...(fallback ? { fallback: true } : {}), ...(partial ? { partial: true } : {}) };
}
