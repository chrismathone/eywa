/** Read-only owner preview. Personal names and source links are written only under gitignored work/. */
import postgres from "postgres";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import { execFileSync } from "node:child_process";
import { checkedConnection } from "../backfill-source";
import { readEventDatabase } from "./snapshot";
import { hash } from "./source-values";
import { previewEventImpact } from "./preview-impact";
import type { EventBundle } from "./bundle";
import { REVIEW_REASON_LABELS } from "./review-labels";
const clean = (text: unknown) => String(text ?? "").replace(/[|\r\n]/g, " ");
async function main() {
  const [input, output] = process.argv.slice(2);
  if (!input || !output || !resolve(output).startsWith(resolve("work") + sep)) throw new Error("Use report.ts <private-bundle.json> <work/owner-report.md>");
  execFileSync("git", ["check-ignore", "--quiet", "--", resolve(output)], { stdio: "ignore" });
  const report = JSON.parse(readFileSync(input, "utf8")) as EventBundle;
  const db = postgres(checkedConnection(), { ssl: "require", prepare: false, max: 1, onnotice: () => {} });
  try {
    const result = await db.begin("isolation level repeatable read read only", async sql => {
      const database = await readEventDatabase(sql, report.tenantId);
      if (hash(database) !== report.databaseHash) throw new Error("The database changed; prepare a new candidate report");
      return { database, impact: await previewEventImpact(sql, report) };
    });
    const sum = (key: "cumulativeDelta" | "recent12Delta" | "currentMonthDelta") => result.impact.reduce((n, r) => n + r[key], 0);
    const lines = ["# 설명회 참석 기여도 — 원장 확인용", "", `${report.today} 읽기 전용 드라이런. 운영 반영·배점 활성화는 하지 않았습니다.`, "",
      `Drive 원문 전체 재확인: ${report.driveVerifiedAt ?? "확인 전 — 실행 승인용으로 사용하지 마세요"}.`, "",
      `후보: **행사 ${report.summary.events}개 · 학생 ${report.summary.students}명 · 학생별 인정 ${report.summary.studentEvents}건 · 행사별 가족 ${report.summary.familyEvents}건**.`, "",
      `원장 확정 배점: 운영 기여 1회당 ${report.summary.pointsPerEvent}점, 상한 없음. 취소되지 않은 신청과 검증된 직접 형제를 포함합니다.`, "",
      `${report.summary.pointsPerEvent}점 적용 시 전체 누적 +${sum("cumulativeDelta")}점, 최근 12개월 +${sum("recent12Delta")}점, 이번 달 +${sum("currentMonthDelta")}점.`,
      `마감된 달의 기존 수치는 ${result.impact.every(r => r.frozenMonthsPreserved) ? "모두 보존됩니다" : "추가 검토가 필요합니다"}. 과거 참석은 행사일의 근거로 보이며, 추가 점수는 다음 집계의 열린 달에 정정됩니다.`, "",
      `프로필 등록일보다 앞선 참석 ${report.summary.enrollmentTiming.beforeProfileEnrollment}건, 프로필 퇴원일 이후 ${report.summary.enrollmentTiming.afterProfileWithdrawal}건. 수강 이력에서 행사 당일 수강이 확인되는 건은 ${report.summary.enrollmentTiming.insideEnrollmentHistory}건입니다. 등록일은 최초 입학일과 다를 수 있어 이 비교만으로 인정 여부를 바꾸지 않았습니다.`,
      `앱의 기여도 조회 대상에서 제외되는 인정 ${report.summary.outsideRoster}건은 점수 후보에서 제외했습니다.`, "",
      `전화번호 재점검: 번호가 있는 ${report.summary.phoneAudit.rowsWithPhone}행 중 학생 DB의 번호와 일치하는 행은 ${report.summary.phoneAudit.matchingRows}개입니다. 일치한 행 중 인정 ${report.summary.phoneAudit.matchedStates.recognized ?? 0}개, 보류 ${report.summary.phoneAudit.matchedStates.review ?? 0}개입니다. 번호 일치만으로 인정하지 않으며, 중복 명단을 포함한 행 수로 학생·참석 건수와 다릅니다.`, "", "## 행사별 인정", "",
      "| 날짜 | 행사 | 학생별 인정 | 행사별 가족 |", "|---|---|---:|---:|",
      ...report.events.sort((a, b) => a.date.localeCompare(b.date)).map(e => { const c = report.credits.filter(c => c.eventId === e.id); return `| ${e.date} | ${clean(e.title)} | ${c.length} | ${new Set(c.map(c => c.familyKey)).size} |`; }),
      "", `## 학생별 변화 (${report.summary.pointsPerEvent}점/회)`, "", "| 학생 | 현재 상태 | 참석 | 누적 증가 | 최근 12개월 증가 | 이번 달 정정 |", "|---|---|---:|---:|---:|---:|",
      ...result.impact.map(i => { const s = result.database.students.find(s => s.id === i.studentId)!; const status = ({ enrolled: "재원", on_hold: "휴원", withdrawn: "퇴원", prospect: "등록 전" } as Record<string, string>)[s.status] ?? s.status;
        return `| [${clean(s.name)}](https://www.aywa.co.kr/students/${s.id}?tab=contribution) | ${status} | ${i.events} | +${i.cumulativeDelta} | +${i.recent12Delta} | +${i.currentCorrection} |`; }),
      "", "## 인정 근거 표본", "", "| 행사일 | 인정 방식 | 원본 위치 |", "|---|---|---|",
      ...["direct", "household", "sibling"].flatMap(basis => report.credits.filter(c => c.basis === basis).slice(0, 3).map(c => { const r = report.registrations.find(r => c.sourceIds.includes(r.sourceId))!;
        return `| ${c.eventDate} | ${{ direct: "학생 직접 대조", household: "보호자 기준 가족 확인", sibling: "직접 형제 연결" }[basis]} | [명단 ${r.row}행](${r.sourceRef}) |`; })),
      "", "## 보류 범위", "", `반영 대상 자료 ${report.summary.files}개 파일·${report.summary.sources}개 시트에서 ${report.summary.parsedRows}행을 확인했습니다. 인정 ${report.summary.states.recognized ?? 0}행, 보류 ${report.summary.states.review ?? 0}행, 제외 ${report.summary.states.excluded ?? 0}행입니다. 보류 사유는 중복될 수 있습니다.`,
      `취소 표시 자체는 ${report.summary.attendanceStates.cancelled ?? 0}행입니다. 신원·일자 확인이 남으면 최종 상태는 보류로 분류하므로 취소가 없다는 뜻이 아닙니다.`, "",
      "2026년 7월 27일/28일 날짜 충돌, 5월 7일 명단의 3월 6일 표제, 다른 시트의 8월 참석 X, 보호자 이름이 부족한 동일 전화번호, 확인되지 않은 지점·회차를 자동 확정하지 않았습니다.",
      `이 중 해당 학원 범위의 미확정 명단은 ${report.summary.pendingRows}행입니다. 지점 미상·행사 종류 미확정 자료는 화면의 보류 건수에서 제외합니다.`,
      "보류 자료를 수정·확정하는 앱 화면과 증분 가져오기는 이번 최초 반영 도구에 포함되지 않습니다. 이 도구만으로는 미확정 건수가 줄지 않으며, 별도 대조 도구로 확인·연결해야 합니다. 원문 연락처와 전체 신청 행은 이 보고서에 표시하지 않았습니다.", "",
      "## 실행 전 확인", "", `1. 운영 ${report.summary.pointsPerEvent}점/회는 원장 확정 사항입니다. 검증을 통과한 명단만 적용합니다.`, "2. 0456a 마이그레이션만 적용하고, 같은 지문의 자료를 첫 가져오기로 연결합니다. Drive와 DB가 바뀌었으면 실행을 멈추고 새 드라이런을 만듭니다.", "3. 저장 결과 대조 후 배점을 켜고 기존 집계를 실행합니다. 그 전에는 점수가 바뀌지 않습니다.", "",
      `승인 대상 지문: \`${report.fingerprint}\``, "", "범위: 최초 가져오기 1회. 재실행은 중복 저장하지 않습니다. 되돌리기는 원본과 감사 기록을 보존하며, 되돌린 뒤 다시 가져오거나 명단을 갱신하려면 별도 대조 도구가 필요합니다.", "",
      "## 미확정 명단 확인 목록", "", "이 목록은 자동 인정 대상이 아닙니다. 사유와 원본 위치를 확인한 뒤 별도 대조합니다. 개인정보가 있어 로컬 work/ 안에만 보관합니다.", "",
      "| 범위 | 행사일 | 행사 | 명단의 학생 | 보류 사유 | 원본 |", "|---|---|---|---|---|---|",
      ...report.reviewRows.map(r => `| ${r.inScope ? "해당 학원" : "범위 미확정"} | ${clean(r.eventDate)} | ${clean(r.eventTitle)} | ${clean(r.studentName) || "학생명 없음"} | ${r.reasons.map(reason => clean(REVIEW_REASON_LABELS[reason] ?? reason)).join(", ")} | [${r.row}행](${r.sourceRef}) |`), ""];
    writeFileSync(output, lines.join("\n"), { flag: "wx", mode: 0o600 });
    console.log(JSON.stringify({ readOnly: true, students: result.impact.length, cumulativeDelta: sum("cumulativeDelta"), recent12Delta: sum("recent12Delta"), currentMonthDelta: sum("currentMonthDelta"), frozenMonthsPreserved: result.impact.every(r => r.frozenMonthsPreserved), output }));
  } finally { await db.end({ timeout: 5 }); }
}
main().catch(error => { console.error(String(error.message).replace(/postgres(?:ql)?:\/\/\S+/gi, "[database-url]")); process.exitCode = 1; });
