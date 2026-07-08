/**
 * 인라인 번호 나열("1.함수의 극한 2.좌극한과 우극한 3.극한값의 계산")을 항목별 줄로 분리 — 순수 함수.
 * 시간표 학생 hover의 진도(수업 리포트) 같은 한 줄 run-on 텍스트의 스마트 줄바꿈용.
 *
 * 규칙(오탐 방지가 우선 — 확신 없으면 원문 그대로):
 * - 마커 = 문자열 시작/공백 뒤 "N." 또는 "N)"(N은 1~2자리). 마커 뒤가 숫자면 소수점("3.5")이라 제외.
 * - 마커가 2개 이상이고 번호가 연속 오름차순(n, n+1, …)일 때만 분리. 아니면 1줄 유지.
 * - 이미 줄바꿈(\n)이 있으면 그 줄바꿈을 그대로 사용(추가 분리 안 함).
 * - 첫 마커 앞 서두("교과 진도 1.…")는 별도 첫 줄로 보존. 번호 마커는 항목에 남긴다(의미 보존).
 */
export function splitNumberedItems(text: string): string[] {
  const byNewline = text
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (byNewline.length !== 1) return byNewline;

  const line = byNewline[0];
  const re = /(^|\s)(\d{1,2})[.)](?!\d)/g;
  const marks: { start: number; num: number }[] = [];
  for (let m = re.exec(line); m; m = re.exec(line)) {
    marks.push({ start: m.index + m[1].length, num: Number(m[2]) });
  }
  if (marks.length < 2) return [line];
  for (let i = 1; i < marks.length; i++) {
    if (marks[i].num !== marks[i - 1].num + 1) return [line];
  }

  const out: string[] = [];
  const head = line.slice(0, marks[0].start).trim();
  if (head) out.push(head);
  for (let i = 0; i < marks.length; i++) {
    const end = i + 1 < marks.length ? marks[i + 1].start : line.length;
    const seg = line.slice(marks[i].start, end).trim();
    if (seg) out.push(seg);
  }
  return out;
}
