import "server-only";
import type { NotionPage } from "@/features/staff/notion-tasks";

// Notion REST 클라이언트(전역 토큰) — solapi.ts/gcs-client.ts 캐시팩토리 패턴 미러. 토큰은 env 전용(DB/jsonb 금지).
// SDK 없이 fetch로 최소 구현(week.ts·trend-graph '라이브러리 0' 에토스). 전건은 has_more/next_cursor 순회(B2 silent 절단 방지).
// ⚠️ 직접 호출은 features/staff/server/notion.ts에서만. 클라가 import하는 모듈에 넣지 말 것 [[#61]].

const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";
const TIMEOUT_MS = 15000;
const MAX_PAGES = 50; // 안전 상한(직원 1명·1달이면 1페이지) — 무한 순회 방지

export class NotionError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.code = code;
    this.name = "NotionError";
  }
}

export type NotionUser = {
  id: string;
  name?: string;
  type?: string;
  person?: { email?: string };
};

function readToken(): string {
  const t = process.env.NOTION_TOKEN?.trim(); // 배포 env 끝 개행 오염 방지 [[#72]]
  if (!t) throw new NotionError("no_token", "NOTION_TOKEN is not set");
  return t;
}

/** 업무 DB id(env). 비밀 아님(식별자) — 단일 운영 DB라 env로 관리. */
export function notionTasksDatabaseId(): string | null {
  return process.env.NOTION_TASKS_DATABASE_ID?.trim() || null;
}

/** 토큰 + DB id가 모두 있어야 연동 '설정됨'. Notion API를 호출하지 않는 저렴한 판별. */
export function isNotionConfigured(): boolean {
  return !!process.env.NOTION_TOKEN?.trim() && !!notionTasksDatabaseId();
}

async function notionFetch(path: string, init: RequestInit): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${NOTION_API}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${readToken()}`,
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });
  } catch (e) {
    throw new NotionError("network", e instanceof Error ? e.message : String(e));
  } finally {
    clearTimeout(timer);
  }
  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok) {
    const code = (json?.code as string) ?? String(res.status);
    const message = (json?.message as string) ?? res.statusText;
    throw new NotionError(code, message);
  }
  return json ?? {};
}

/** DB 쿼리 전건(페이지네이션 순회). filter/sorts는 Notion API 형식 그대로 전달.
 *  opts.maxPages: 왕복 상한(기본 MAX_PAGES) — 페이지당 수백ms~수초라 무거운 스캔은 반드시 낮게. */
export async function queryDatabaseAll(
  databaseId: string,
  body: { filter?: unknown; sorts?: unknown },
  opts: { maxPages?: number } = {},
): Promise<NotionPage[]> {
  const cap = Math.min(opts.maxPages ?? MAX_PAGES, MAX_PAGES);
  const out: NotionPage[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < cap; i++) {
    const json = await notionFetch(`/databases/${databaseId}/query`, {
      method: "POST",
      body: JSON.stringify({ ...body, start_cursor: cursor, page_size: 100 }),
    });
    out.push(...((json.results as NotionPage[]) ?? []));
    if (!json.has_more) return out;
    cursor = json.next_cursor as string;
  }
  console.warn(`[notion] queryDatabaseAll이 상한(${cap}페이지)에 도달 — 결과가 잘렸을 수 있음`);
  return out;
}

export type NotionComment = {
  id: string;
  created_time?: string;
  created_by?: { id?: string };
  rich_text?: { plain_text?: string }[];
};

/** 페이지(=block)의 댓글 전건. "댓글 읽기" 권한 필요. */
export async function listCommentsAll(blockId: string): Promise<NotionComment[]> {
  const out: NotionComment[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < MAX_PAGES; i++) {
    const qs = new URLSearchParams({
      block_id: blockId,
      page_size: "100",
      ...(cursor ? { start_cursor: cursor } : {}),
    });
    const json = await notionFetch(`/comments?${qs.toString()}`, { method: "GET" });
    out.push(...((json.results as NotionComment[]) ?? []));
    if (!json.has_more) return out;
    cursor = json.next_cursor as string;
  }
  return out;
}

/** 페이지에 댓글 추가. "댓글 삽입" 권한 필요. API 댓글은 통합(봇)으로 표기됨(작성자 접두는 호출부). */
export async function createComment(pageId: string, text: string): Promise<void> {
  await notionFetch(`/comments`, {
    method: "POST",
    body: JSON.stringify({ parent: { page_id: pageId }, rich_text: [{ text: { content: text } }] }),
  });
}

/** 워크스페이스 사용자 전건(사람/봇 구분은 호출부에서). */
export async function listUsersAll(): Promise<NotionUser[]> {
  const out: NotionUser[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < MAX_PAGES; i++) {
    const qs = new URLSearchParams({ page_size: "100", ...(cursor ? { start_cursor: cursor } : {}) });
    const json = await notionFetch(`/users?${qs.toString()}`, { method: "GET" });
    out.push(...((json.results as NotionUser[]) ?? []));
    if (!json.has_more) return out;
    cursor = json.next_cursor as string;
  }
  return out;
}
