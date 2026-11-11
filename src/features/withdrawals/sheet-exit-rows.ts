/**
 * 퇴원관리 명단·통계 — **시트를 쓰는 달(과목마다 시트에 처음 나온 달 ~ `SHEET_LAST_MONTH`)은 퇴원생 관리 차트의 줄을 그대로 쓴다**(순수 · Vitest).
 * 원장 2026-11-11 *"어차피 통계라서 연계데이터 없지않나? … 시트에 맞게 맞춰서 뿌리면 되는거아님?"* — 학생 데이터는 바꾸지 않고
 * 화면에서만 맞춘다. 그 뒤 달은 에이와 줄 그대로(퇴원보고서·수강 기록으로 잰다).
 *
 * - 시트 한 줄 = 명단 한 줄(과목마다). 잇기 규칙은 `sheet-match.ts`(운영실과 한 벌). 이어진 에이와 줄은 그 줄의 자세한 값(학생 연결·반·사유·
 *   상담)을 쓰고 달만 시트의 달로 센다. 못 이으면 시트 글로 줄을 만든다(학생 연결 없음 · `fromSheet`) — 그 학생이 지금 다니거나 다른 달에
 *   에이와 줄이 있으면 과목만 끊은 '수강종료', 아니면 '퇴원'.
 * - 시트를 쓰는 달·과목의 에이와 줄 중 시트에 없는 것은 뺀다(7/15 폐강 반처럼 시트가 퇴원으로 적지 않은 것). 다른 과목은 그대로.
 */
import type { ExitRow } from "./exit-rows";
import { EMPTY_STUDENT_NAMES, looksLikeSubjectEnd, matchSheet, monthEnd, monthOf, sheetCoverage, type StudentNames } from "./sheet-match";
import { nameKey, splitSchoolGrade, type SheetExitRecord } from "./sheet-teachers";

/** 시트 달로 세는 날짜 — 그 달 안의 날짜가 있으면 그것, 아니면 그 달 말일(오늘을 넘지 않게). */
const countDateIn = (month: string, candidates: readonly (string | null | undefined)[], today: string) =>
  candidates.find((d) => monthOf(d) === month) ?? monthEnd(month, today);

export function mergeSheetExits(
  rows: readonly ExitRow[],
  records: readonly SheetExitRecord[] | null,
  today: string,
  names: StudentNames = EMPTY_STUDENT_NAMES,
): ExitRow[] {
  if (!records?.length) return [...rows];
  const covers = sheetCoverage(records);
  const monthOfRow = (r: ExitRow) => monthOf(r.countDate ?? r.date);
  // 과목마다 한 단위 — 두 과목 퇴원 줄은 과목마다 따로 잇는다.
  const units = rows.flatMap((row, r) => row.subjects.map((subject) => ({ row, r, subject })));
  const pick = matchSheet(records, units, {
    nameOf: (u) => u.row.name,
    monthsOf: (u) => [monthOf(u.row.countDate), monthOf(u.row.date)],
    // 🔴 시트 달에 센 줄만 잇는다 — 11월에 센 줄을 10월 시트 줄이 끌어가면 '이번 달'에서 사라진다.
    candidate: (u, rec) => u.subject === rec.subject && covers(u.subject, monthOfRow(u.row)),
  });
  // 줄 번호 → 시트 줄에 쓰인 과목.
  const usedSubjects = new Map<number, Set<string>>();
  for (const i of pick) if (i >= 0) {
    const u = units[i]!;
    (usedSubjects.get(u.r) ?? usedSubjects.set(u.r, new Set()).get(u.r)!).add(u.subject);
  }
  const out: ExitRow[] = [];

  records.forEach((rec, i) => {
    const hit = pick[i]! >= 0 ? units[pick[i]!]!.row : null;
    if (hit) {
      out.push({
        ...hit,
        key: hit.subjects.length > 1 ? `${hit.key}|${rec.subject}` : hit.key,
        subjects: [rec.subject],
        countDate: countDateIn(rec.month, [hit.countDate, hit.date, rec.date], today),
        // 시트가 실제 퇴원으로 적었다 — 날짜 미상(시스템 정리)·장부 정리 표시를 푼다(추이·강사 판정에서 빠지지 않게).
        systemBulk: false,
        ...(hit.cleanup ? { cleanup: false, ...(rec.reason ? { reasonKey: null, reasonLabel: rec.reason, detail: null, memo: rec.memo ?? hit.memo } : {}) } : {}),
      });
      return;
    }
    const countDate = countDateIn(rec.month, [rec.date], today);
    out.push({
      key: `sheet|${rec.month}|${rec.subject}|${nameKey(rec.name)}`,
      studentId: "",
      kind: looksLikeSubjectEnd(rec, names) ? "subject-ended" : "withdrawn",
      name: rec.name,
      ...splitSchoolGrade(rec.schoolGrade),
      // 보이는 날짜도 시트 달 안으로 — 다음 달 날짜로 적힌 줄이 '앞 달로 셈' 꼬리표를 달지 않게.
      date: countDate,
      countDate,
      subjects: [rec.subject],
      className: rec.className,
      programSubject: rec.subject,
      englishTrack: rec.subject === "english" ? (rec.eie ? "eie" : "injaewon") : null,
      systemBulk: false,
      reasonKey: null,
      reasonLabel: rec.reason,
      detail: null,
      // 학생 연결이 없어 상담을 적을 수 없다 — 상담 카드·필터는 이 줄을 세지 않는다(page.tsx `consultRows`).
      consulted: null,
      memo: rec.memo,
      cleanup: false,
      tenureDays: null,
      fromSheet: true,
    });
  });

  // 시트를 쓰지 않는 달·과목의 에이와 줄은 그대로 — 시트 줄에 쓰인 과목과 시트가 덮는 과목은 뺀다.
  // 과목을 모르는 줄은 운영실과 같이 '어느 과목이든 시트가 덮는 달'이면 뺀다.
  rows.forEach((r, j) => {
    if (!r.subjects.length) {
      if (!covers(null, monthOfRow(r))) out.push(r);
      return;
    }
    const used = usedSubjects.get(j);
    const left = r.subjects.filter((s) => !used?.has(s) && !covers(s, monthOfRow(r)));
    if (left.length === r.subjects.length) out.push(r);
    else if (left.length) out.push({ ...r, subjects: left });
  });
  // 같은 키가 둘이면(시트에 같은 학생·과목이 두 달에 걸쳐 적힘) 뒤엣것에 번호를 붙인다 — React 키·강사 판정 키가 겹치지 않게.
  const seen = new Map<string, number>();
  return out.map((r) => {
    const n = seen.get(r.key) ?? 0;
    seen.set(r.key, n + 1);
    return n ? { ...r, key: `${r.key}#${n}` } : r;
  });
}
