import "server-only";
// AI 비서 대화 조회 — 사용자 세션(own-row RLS, 0117a) 경유. 최근 대화 1건만(패널 초기 표시용).

import { createClient } from "@/lib/supabase/server";
import { parseStoredTurns, type StoredTurn } from "../turns";

export type AssistantConversation = { id: string; turns: StoredTurn[] };

export async function getLatestAssistantConversation(): Promise<AssistantConversation | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("assistant_conversations")
    .select("id, messages")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`getLatestAssistantConversation: ${error.message}`);
  if (!data) return null;
  return { id: data.id as string, turns: parseStoredTurns(data.messages) };
}
