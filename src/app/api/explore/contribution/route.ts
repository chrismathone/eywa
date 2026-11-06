import { NextResponse } from "next/server";
import { contributionEnabled, loadExploreContribution } from "@/features/explore/server/contribution";

/**
 * 연결 탐색 왼쪽 '기여도·기록' 카드의 달 바꾸기 — `?student=<id>&month=YYYY-MM`. 같은 계산(`loadExploreContribution`)을 다시 부른다.
 * 열쇠는 원생 상세 '기여도' 탭과 같다(꺼졌으면 404 — 있었는지조차 모르게). 개인 열람이라 캐시하지 않는다.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const student = url.searchParams.get("student") ?? "";
  if (!/^[a-f0-9-]{36}$/i.test(student)) return NextResponse.json({ error: "잘못된 요청입니다" }, { status: 400 });
  if (!(await contributionEnabled())) return NextResponse.json({ error: "없는 주소입니다" }, { status: 404 });
  const data = await loadExploreContribution(student, url.searchParams.get("month"));
  return NextResponse.json(data, { headers: { "cache-control": "private, no-store" } });
}
