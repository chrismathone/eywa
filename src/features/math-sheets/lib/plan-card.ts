/**
 * 학생 계획 카드(원장 2026-10-20, 카드 시안 채택)의 순수 계산 — 교재 3개월 창의 누적 차시를 권·차시로 접는다.
 * 화면은 그리기만 한다(같은 판정을 두 곳에서 하지 않는다).
 */
type Book = { title: string; lessons: number };

export const volumeOf = (title: string) => title.match(/(\d+)권/)?.[1] ?? "";

/** 누적 n차시(1부터) → `4권 7차시`. 0이면 null, 창 끝을 넘으면 마지막 차시. */
export function lessonLabelAt(books: readonly Book[], n: number): string | null {
  if (n <= 0 || books.length === 0) return null;
  let left = n;
  for (const b of books) {
    if (left <= b.lessons) return `${volumeOf(b.title)}권 ${left}차시`;
    left -= b.lessons;
  }
  const last = books[books.length - 1]!;
  return `${volumeOf(last.title)}권 ${last.lessons}차시`;
}

/** 권마다 나간 차시·계획인데 아직 못 나간 차시(밀린 차시). 누적값을 권 구간으로 자른다. */
export function bookSlices(books: readonly Book[], done: number, planned: number) {
  let offset = 0;
  return books.map((b) => {
    const clip = (v: number) => Math.max(0, Math.min(b.lessons, v - offset));
    const slice = { done: clip(done), late: Math.max(0, clip(planned) - clip(done)) };
    offset += b.lessons;
    return slice;
  });
}

/** `2026-10-22` → `10.22(목)`. */
export function shortDay(date: string): string {
  const day = "일월화수목금토"[new Date(`${date}T00:00:00Z`).getUTCDay()];
  return `${Number(date.slice(5, 7))}.${date.slice(8, 10)}(${day})`;
}

/**
 * 다음 수업 차시 — **실제 위치 다음 차시**(창 누적이 아니라). 창 앞 권에 아직 있으면 그 권의 다음 차시,
 * 그 권 마지막이면 창 안 다음 권 1차시, 창 끝이면 null.
 */
export function nextLessonLabel(
  books: readonly Book[],
  position: { title: string; lessonNo: number; total: number } | null,
): string | null {
  if (!position) return null;
  if (position.lessonNo < position.total) return `${volumeOf(position.title)}권 ${position.lessonNo + 1}차시`;
  const vol = Number(volumeOf(position.title));
  const after = books.find((b) => Number(volumeOf(b.title)) > vol);
  return after ? `${volumeOf(after.title)}권 1차시` : null;
}
