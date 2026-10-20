import "server-only";
import { createClient } from "@/lib/supabase/server";
import { fetchInChunks } from "@/lib/supabase/batch";
import type { TextbookOrderRow } from "./textbook-queries";

/**
 * 강사 교재 요청 목록에 **발송 연결(0174a `classnote_notice_id`)** 을 덧붙인다 — 목록의 '발송함' 표시용.
 *
 * 강사 목록 조회(`getTextbookOrdersForStudents`·`getTextbookOrdersCreatedBy`)는 원스크린 로스터와 같은 경로라
 * 새 컬럼을 넣지 않는 규약(#95)이다. 그래서 이 화면에서만 따로 읽어 합친다.
 * 같은 줄이 둘일 때 어느 쪽이 학부모에게 나간 요청인지 몰라 발송한 쪽을 지운 9건(2026-10-20)이 계기.
 * 🔴 실패해도 화면을 세우지 않는다(표시만 빠진다) — 로그는 남긴다.
 */
export async function withTextbookNoticeLinks(rows: TextbookOrderRow[]): Promise<TextbookOrderRow[]> {
  const ids = rows.map((r) => r.id);
  if (!ids.length) return rows;
  try {
    const supabase = await createClient();
    const links = await fetchInChunks<{ id: string; classnote_notice_id: string | null }>(ids, (chunk) =>
      supabase.from("textbook_orders").select("id, classnote_notice_id").in("id", chunk).not("classnote_notice_id", "is", null),
    );
    const byId = new Map(links.map((l) => [l.id, l.classnote_notice_id]));
    return rows.map((r) => ({ ...r, classnoteNoticeId: byId.get(r.id) ?? r.classnoteNoticeId ?? null }));
  } catch (e) {
    console.error("[textbook] 발송 연결 조회 실패 — '발송함' 표시 없이 보여 줍니다", e instanceof Error ? e.message : e);
    return rows;
  }
}
