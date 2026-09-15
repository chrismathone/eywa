import "server-only";
import { createClient } from "@/lib/supabase/server";
import { fetchInChunks } from "@/lib/supabase/batch";
import { reportError } from "@/lib/observability/report-error";
import { isMissingHelpBoard } from "../missing";
import {
  isHelpPostStatus,
  type HelpBoardList,
  type HelpPostDetail,
  type HelpPostStatus,
} from "../types";

const PAGE_SIZE_MAX = 50;

export async function getHelpPostsPage(opts: {
  q?: string;
  page?: number;
  pageSize?: number;
}): Promise<HelpBoardList> {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(PAGE_SIZE_MAX, Math.max(5, opts.pageSize ?? 20));
  const from = (page - 1) * pageSize;
  const supabase = await createClient();
  let qb = supabase
    .from("help_posts")
    .select("id, title, status, author_id, created_at", { count: "exact" });
  const q = (opts.q ?? "").replace(/[%_,]/g, " ").trim();
  if (q) qb = qb.or(`title.ilike.%${q}%,body.ilike.%${q}%`);
  const { data, error, count } = await qb.order("created_at", { ascending: false }).range(from, from + pageSize - 1);
  if (error) {
    if (isMissingHelpBoard(error)) return { ready: false, rows: [], total: 0 };
    reportError(error, { scope: "help.board.list" });
    return {
      ready: false,
      rows: [],
      total: 0,
      error: { summary: "게시판을 불러오지 못했습니다", raw: error.message },
    };
  }
  const rows = data ?? [];
  const ids = rows.map((r) => r.id as string);
  const authorIds = [...new Set(rows.map((r) => r.author_id as string))];
  const [names, counts] = await Promise.all([
    loadNames(supabase, authorIds).catch(() => new Map<string, string>()),
    loadAnswerCounts(supabase, ids).catch(() => new Map<string, number>()),
  ]);
  return {
    ready: true,
    total: count ?? 0,
    rows: rows.map((r) => ({
      id: r.id as string,
      title: r.title as string,
      status: asStatus(r.status),
      authorId: r.author_id as string,
      authorName: names.get(r.author_id as string) ?? "직원",
      createdAt: r.created_at as string,
      answerCount: counts.get(r.id as string) ?? 0,
    })),
  };
}

export async function getHelpPost(id: string): Promise<
  | { ready: false; missingTable: boolean; error?: { summary: string; raw: string } }
  | { ready: true; post: HelpPostDetail | null }
> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("help_posts")
    .select("id, title, body, status, author_id, created_at")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    if (isMissingHelpBoard(error)) return { ready: false, missingTable: true };
    reportError(error, { scope: "help.board.detail" });
    return {
      ready: false,
      missingTable: false,
      error: { summary: "글을 불러오지 못했습니다", raw: error.message },
    };
  }
  if (!data) return { ready: true, post: null };
  const { data: answers, error: aErr } = await supabase
    .from("help_answers")
    .select("id, author_id, body, created_at")
    .eq("post_id", id)
    .order("created_at", { ascending: true });
  if (aErr && !isMissingHelpBoard(aErr)) {
    reportError(aErr, { scope: "help.board.answers" });
  }
  const answerRows = aErr ? [] : (answers ?? []);
  const nameIds = [data.author_id as string, ...answerRows.map((a) => a.author_id as string)];
  const names = await loadNames(supabase, nameIds).catch(() => new Map<string, string>());
  return {
    ready: true,
    post: {
      id: data.id as string,
      title: data.title as string,
      body: data.body as string,
      status: asStatus(data.status),
      authorId: data.author_id as string,
      authorName: names.get(data.author_id as string) ?? "직원",
      createdAt: data.created_at as string,
      answers: answerRows.map((a) => ({
        id: a.id as string,
        authorId: a.author_id as string,
        authorName: names.get(a.author_id as string) ?? "직원",
        body: a.body as string,
        createdAt: a.created_at as string,
      })),
    },
  };
}

function asStatus(v: unknown): HelpPostStatus {
  return typeof v === "string" && isHelpPostStatus(v) ? v : "open";
}

async function loadNames(
  supabase: Awaited<ReturnType<typeof createClient>>,
  ids: string[],
): Promise<Map<string, string>> {
  const uniq = [...new Set(ids.filter(Boolean))];
  if (uniq.length === 0) return new Map();
  const rows = await fetchInChunks(uniq, (chunk) =>
    supabase.from("users").select("id, display_name").in("id", chunk),
  );
  return new Map(rows.map((u) => [u.id as string, (u.display_name as string) || "직원"]));
}

async function loadAnswerCounts(
  supabase: Awaited<ReturnType<typeof createClient>>,
  postIds: string[],
): Promise<Map<string, number>> {
  if (postIds.length === 0) return new Map();
  const rows = await fetchInChunks(postIds, (chunk) =>
    supabase.from("help_answers").select("post_id").in("post_id", chunk),
  );
  const map = new Map<string, number>();
  for (const r of rows) {
    const id = r.post_id as string;
    map.set(id, (map.get(id) ?? 0) + 1);
  }
  return map;
}
