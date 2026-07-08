import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getTextbookOrdersPage } from "@/features/billing/server/textbook-queries";
import { getQuotesPage } from "@/features/billing/server/tuition-quote-queries";
import { quoteDoc, textbookOrderDoc, type LinkedDocRow, type LinkedSourceKey } from "../linked";

// 연동 폴더 조회 — 기존 수납관리 페이지 쿼리(페이징·검색·count 내장, B2 충족)를 그대로 위임하고
// 표시용 링크 행으로만 매핑한다. ⚠️ 호출 전 billing 접근권한 게이트 필수(강사는 담당 학생 스코프 밖
// 전체 목록을 보면 안 됨 — 페이지가 canAccessTenant("billing")로 폴더 자체를 숨긴다).

export async function getLinkedPage(
  source: LinkedSourceKey,
  opts: { q?: string } = {},
  page = 1,
  pageSize = 50,
): Promise<{ rows: LinkedDocRow[]; total: number }> {
  if (source === "textbooks") {
    const { rows, total } = await getTextbookOrdersPage({ q: opts.q }, page, pageSize);
    return { rows: rows.map(textbookOrderDoc), total };
  }
  const { rows, total } = await getQuotesPage({ q: opts.q }, page, pageSize);
  return { rows: rows.map(quoteDoc), total };
}

/** 폴더 팬 카운트 — 행 미fetch(count head:true, B2), 두 테이블 병렬(B4). */
export async function getLinkedCounts(): Promise<Record<LinkedSourceKey, number>> {
  const supabase = await createClient();
  const countOf = async (table: "textbook_orders" | "tuition_quotes") => {
    const { count } = await supabase.from(table).select("*", { count: "exact", head: true });
    return count ?? 0;
  };
  const [textbooks, quotes] = await Promise.all([countOf("textbook_orders"), countOf("tuition_quotes")]);
  return { textbooks, quotes };
}
