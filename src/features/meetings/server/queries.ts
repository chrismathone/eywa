import "server-only";
import { createClient } from "@/lib/supabase/server";

export type MeetingRow = {
  id: string;
  title: string;
  heldAt: string;
  attendees: string[];
  authorName: string | null;
  excerpt: string;
};

export type MeetingActionItem = {
  action: string;
  assignee?: string;
  due?: string;
};

export type MeetingDetail = MeetingRow & {
  content: string;
  aiSummary: string | null;
  aiActionItems: MeetingActionItem[] | null;
  aiModelVersion: string | null;
  aiGeneratedAt: string | null;
};

function excerpt(content: string, max = 140): string {
  const trimmed = content.trim().replace(/\s+/g, " ");
  return trimmed.length <= max ? trimmed : trimmed.slice(0, max) + "…";
}

export async function getMeetings(): Promise<MeetingRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("meeting_minutes")
    .select(
      `id, title, content, attendees, held_at,
       author:author_id ( display_name )`,
    )
    .order("held_at", { ascending: false });

  if (!data) return [];

  return data.map((r) => {
    const author = (Array.isArray(r.author) ? r.author[0] : r.author) as
      | { display_name?: string }
      | undefined;
    return {
      id: r.id,
      title: r.title,
      heldAt: r.held_at,
      attendees: Array.isArray(r.attendees) ? (r.attendees as string[]) : [],
      authorName: author?.display_name ?? null,
      excerpt: excerpt(r.content),
    };
  });
}

export async function getMeetingById(id: string): Promise<MeetingDetail | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("meeting_minutes")
    .select(
      `id, title, content, attendees, held_at,
       ai_summary, ai_action_items, ai_model_version, ai_generated_at,
       author:author_id ( display_name )`,
    )
    .eq("id", id)
    .single();

  if (!data) return null;

  const author = (Array.isArray(data.author) ? data.author[0] : data.author) as
    | { display_name?: string }
    | undefined;

  return {
    id: data.id,
    title: data.title,
    heldAt: data.held_at,
    attendees: Array.isArray(data.attendees) ? (data.attendees as string[]) : [],
    authorName: author?.display_name ?? null,
    excerpt: excerpt(data.content),
    content: data.content,
    aiSummary: data.ai_summary,
    aiActionItems: Array.isArray(data.ai_action_items)
      ? (data.ai_action_items as MeetingActionItem[])
      : null,
    aiModelVersion: data.ai_model_version,
    aiGeneratedAt: data.ai_generated_at,
  };
}
