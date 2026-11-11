/**
 * 운영실(대시보드) 퇴원 줄 — 퇴원관리와 같은 규칙으로 **2026-10까지는 퇴원생 관리 차트**의 줄로 센다(순수 · Vitest).
 * 원장 2026-11-11 *"대시보드까지만 같이 맞춰서 반영해줘"*. 쓰는 곳 = '등록·퇴원 추이' 퇴원 칸 · '3개월 내 퇴원' · KPI '퇴원&수업종료'의
 * 앞 달로 센 줄(이번 달 숫자는 시트 달 밖이라 그대로).
 *
 * - 여기 줄은 **학생마다**(퇴원 = 학생이 나감) — 같은 달 같은 학생의 시트 줄(과목마다)을 한 묶음으로 잇는다. 잇기 규칙은 `sheet-match.ts`.
 * - 이어진 에이와 퇴원 줄은 시트의 달로 · 장부 정리 표시를 푼다(시트가 실제 퇴원으로 적었다).
 * - 못 이으면: 과목만 끊은 학생(지금 재원·휴원이거나 다른 달에 에이와 퇴원 줄이 있다)은 퇴원으로 세지 않고, 아니면 시트 글로 만든 줄.
 * - 시트를 쓰는 달·과목의 에이와 퇴원 줄 중 시트에 없는 것은 뺀다.
 */
import type { WindowWithdrawal } from "./server/window";
import { looksLikeSubjectEnd, matchSheet, monthEnd, monthOf, sheetCoverage, type StudentNames } from "./sheet-match";
import { nameKey, splitSchoolGrade, type SheetExitRecord } from "./sheet-teachers";

const subjectsOf = (r: WindowWithdrawal) => (r.exitClasses.length ? r.exitClasses.map((c) => c.subject) : r.lastClassSubject ? [r.lastClassSubject] : []);

export function mergeSheetWithdrawals(
  rows: readonly WindowWithdrawal[],
  records: readonly SheetExitRecord[] | null,
  opts: { today: string; from: string; names: StudentNames },
): WindowWithdrawal[] {
  if (!records?.length) return [...rows];
  const covers = sheetCoverage(records);
  const groups = new Map<string, SheetExitRecord[]>();
  for (const rec of records) {
    const k = `${rec.month}|${nameKey(rec.name)}`;
    groups.set(k, [...(groups.get(k) ?? []), rec]);
  }
  const heads = [...groups.values()];
  const pick = matchSheet(heads.map((g) => g[0]!), rows, {
    nameOf: (r) => r.name,
    monthsOf: (r) => [monthOf(r.exitDate), monthOf(r.withdrawnAt)],
    candidate: (r, rec) => {
      const subjects = groups.get(`${rec.month}|${nameKey(rec.name)}`)!.map((x) => x.subject);
      return subjects.some((s) => covers(s, monthOf(r.exitDate)));
    },
  });
  const used = new Set(pick.filter((i) => i >= 0));
  const out: WindowWithdrawal[] = [];
  heads.forEach((recs, i) => {
    const rec = recs[0]!;
    const hit = pick[i]! >= 0 ? rows[pick[i]!]! : null;
    const exitDate = [hit?.exitDate, hit?.withdrawnAt, rec.date].find((d) => monthOf(d) === rec.month) ?? monthEnd(rec.month, opts.today);
    if (hit) {
      out.push({ ...hit, exitDate, cleanup: false });
      return;
    }
    if (looksLikeSubjectEnd(rec, opts.names)) return; // 과목만 끊었다(퇴원 아님)
    if (exitDate < opts.from) return;
    const subjects = [...new Set(recs.map((r) => r.subject))];
    const eie = recs.some((r) => r.eie);
    out.push({
      id: `sheet|${rec.month}|${nameKey(rec.name)}`,
      name: rec.name,
      ...splitSchoolGrade(rec.schoolGrade),
      enrolledAt: null,
      // 🔴 퇴원일도 시트 달 안으로 — 다음 달 날짜면 그 달 KPI '앞 달로 센' 목록에 학생 연결 없는 줄이 선다(링크가 깨진다).
      withdrawnAt: exitDate,
      exitDate,
      lastClassName: rec.className,
      lastClassSubject: subjects[0]!,
      lastClassEnglishTrack: subjects[0] === "english" ? (eie ? "eie" : "injaewon") : null,
      exitClasses: subjects.map((s) => ({
        subject: s,
        englishTrack: s === "english" ? (eie ? "eie" : "injaewon") : null,
        className: recs.find((r) => r.subject === s)?.className ?? null,
        endedTogether: [],
      })),
      reason: rec.reason,
      memo: rec.memo,
      cleanup: false,
    });
  });
  rows.forEach((r, j) => {
    if (used.has(j)) return;
    const subjects = subjectsOf(r);
    // 그 달 과목이 전부 시트가 덮는 과목이면 뺀다(시트가 퇴원으로 적지 않았다). 과목을 모르는 줄은 학원 전체로 본다.
    const coveredAll = subjects.length ? subjects.every((s) => covers(s, monthOf(r.exitDate))) : covers(null, monthOf(r.exitDate));
    if (!coveredAll) out.push(r);
  });
  return out;
}
