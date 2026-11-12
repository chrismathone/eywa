import { NextResponse } from "next/server";
import { loadAcademyKnowledge } from "@/features/academy-knowledge/server";
import { entities, relations, metricDictionary, workbookCoverage, WORKBOOK, ONTOLOGY_VERSION } from "@/features/academy-knowledge/catalog";
import { blueprint } from "@/features/academy-knowledge/blueprint";
import { rules } from "@/features/academy-knowledge/rules";
import { attachmentFilename } from "@/lib/http/content-disposition";
import { knowledgeGate } from "@/features/academy-knowledge/studio-server";

/** 통합 지식그래프 JSON 내려받기 — 화면과 같은 조회(같은 문 · 같은 범위). 누를 때만 읽는다. */
export async function GET(request: Request) {
  const noStore = { "Cache-Control": "private, no-store" };
  try { await knowledgeGate(); } catch { return NextResponse.json({ error: "열람 권한을 확인해 주세요" }, { status: 403, headers: noStore }); }
  try {
    const p = new URL(request.url).searchParams;
    const d = await loadAcademyKnowledge({ month: p.get("month") ?? undefined, student: p.get("student") || undefined, teacher: p.get("teacher") || undefined });
    return NextResponse.json({ model: { version: ONTOLOGY_VERSION, reference: WORKBOOK, entities, relations, metricDictionary, rules, workbookCoverage, blueprint, changes: d.studio.rows, history: d.studio.history }, graph: d.graph, rules: d.ruleResults, sources: d.status },
      { headers: { ...noStore, "Content-Disposition": attachmentFilename(`aywa-ontology-${d.month}.json`), "X-Content-Type-Options": "nosniff" } });
  } catch (e) {
    console.error("[academy-knowledge] export", e);
    // 입력 검사에서 던진 한글 안내만 400 — 그 밖(조회 실패)은 500.
    const own = e instanceof Error && /[가-힣]/.test(e.message) ? e.message : null;
    return NextResponse.json({ error: own ?? "지식그래프를 만들지 못했습니다. 잠시 후 다시 내려받아 주세요" }, { status: own ? 400 : 500, headers: noStore });
  }
}
