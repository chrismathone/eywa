// 가상 시드로 이탈 방어 명단을 콘솔에 출력하는 데모. 실DB 불필요.
// 실행: pnpm tsx scripts/retention-demo.ts
import { buildRoster, summarizeRoster } from "../src/features/retention/roster";
import { generateRetentionFixture } from "../src/features/retention/fixtures";

const today = new Date("2026-06-15T00:00:00Z");
const { data } = generateRetentionFixture(10, today);
const roster = buildRoster(data, today);
const s = summarizeRoster(roster);

const won = (n: number) => `${Math.round(n / 10000)}만`;
const mark = { risk: "🔴위험", warn: "🟠관심", ok: "🟢안정" } as const;

console.log("\n================ 가상 시드 · 이탈 방어 명단 (위험도순) ================\n");
for (const r of roster) {
  console.log(
    `${mark[r.risk.level]} ${String(r.risk.score).padStart(3)}점  ` +
      `${r.name}(${r.grade})  ${r.teacherName} 강사  월${won(r.monthlyFee)}  재등록:${r.risk.renewal.label}`,
  );
  console.log(`        조치: ${r.primaryAction}`);
  console.log(`        사유: ${r.risk.reasons.slice(0, 3).join(" · ")}`);
  if (r.nextContactDate) console.log(`        다음 연락: ${r.nextContactDate}`);
  console.log("");
}
console.log("---------------------------------------------------------------------");
console.log(
  `요약  위험 ${s.risk} · 관심 ${s.warn} · 안정 ${s.ok}  |  ` +
    `상담예약 ${s.scheduled} · 재등록위험 ${s.renewalRisk} · 매출위험 ${won(s.revenueRisk)}`,
);
console.log("=====================================================================\n");
