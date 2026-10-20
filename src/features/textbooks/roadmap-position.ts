/** 로드맵 보조 — 기준일이 든 창 · 시리즈의 최근 진도 위치(순수 함수, book-roadmap.ts가 쓴다). */
import { bookPosition, catalogBookKey, type CatalogBook, type ReportLine } from "./math-book-match";
import { keyOrdinal, seriesOfKey } from "./book-sequence";
import type { PlacedBook } from "./roadmap-calendar";
import type { RoadPosition } from "./book-roadmap-types";

export function windowAt(books: readonly PlacedBook[], ref: string): number {
  // 뒤에서부터 — 재계산으로 끝난 권들이 오늘에 겹쳐 있으면 마지막(= 지금 권)이 이긴다.
  const hit = books.findLast((b) => b.startDate <= ref && ref <= b.finishDate);
  if (hit) return hit.window;
  return ref < books[0]!.startDate ? 0 : books[books.length - 1]!.window;
}

/** 시리즈 교재 중 진도가 걸린 **가장 최근** 기록(같은 날이면 뒤 권). */
export function latestPosition(series: string, catalog: readonly CatalogBook[], reports: readonly ReportLine[]): RoadPosition | null {
  let best: RoadPosition | null = null;
  for (const b of catalog) {
    const key = catalogBookKey(b.title);
    if (!key || seriesOfKey(key) !== series) continue;
    const p = bookPosition(b, reports, catalog);
    if (!p) continue;
    if (!best || p.date > best.date || (p.date === best.date && keyOrdinal(key) > keyOrdinal(best.key))) {
      best = { key, title: b.title, lessonNo: p.lessonNo, total: p.total, date: p.date, unit: p.unit };
    }
  }
  return best;
}
