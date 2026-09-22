/**
 * scripts/_classnote/sync-child-map.mjs — ClassNote 원아 ID ↔ aywa 학생 매핑 1회 실행(점검·복구용).
 *
 * 상주 데몬이 하루 1회 자동 실행하므로 평소엔 필요 없다. 이 스크립트는 ① 최초 1회 채우기
 * ② 미확정(사람이 확인해야 하는) 명단 뽑기 ③ 데몬이 죽어 있을 때 수동 실행용.
 *
 * 실행:
 *   node --env-file=.env.local scripts/_classnote/sync-child-map.mjs           # 점검(기본) — DB 변경 없음
 *   node --env-file=.env.local scripts/_classnote/sync-child-map.mjs --apply   # classnote_child_links 채움
 *
 * ⚠️ ClassNote엔 **아무것도 쓰지 않는다**(GET만). --apply가 건드리는 것은 aywa classnote_child_links 한 표뿐이다.
 * 🔴 보호자 전화는 대조에만 쓰고 저장·출력하지 않는다(0184a·classnote-integration.md §11).
 */
import postgres from "postgres";
import { launchBrowser, resolveTenant } from "./classnote-core.mjs";
import { syncChildMapOnce } from "./classnote-childmap-core.mjs";

const APPLY = process.argv.includes("--apply");

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL 없음");
  if (!process.env.CLASSNOTE_UPLOAD_ID || !process.env.CLASSNOTE_UPLOAD_PW) {
    throw new Error("CLASSNOTE_UPLOAD_ID / CLASSNOTE_UPLOAD_PW env가 필요합니다(명부 조회에도 로그인 필요)");
  }
  const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 });
  const browser = await launchBrowser();
  try {
    const tenant = await resolveTenant(sql);
    console.log(`tenant=${tenant} · mode=${APPLY ? "APPLY(매핑 기록)" : "점검(변경 없음)"}`);
    const res = await syncChildMapOnce(sql, browser, { tenant, apply: APPLY, force: true, log: console.log });
    console.log("\n결과:", JSON.stringify({ ...res, samples: undefined }, null, 1));
    if (res.samples?.length) {
      console.log("\n=== 미확정(사람이 확인) 일부 ===");
      for (const s of res.samples) console.log(` · 원아 ${s.childId} — ${s.why}`);
      console.log("  ↳ 대개 aywa 학생 전화가 비었거나 이름 표기가 다른 경우다. 학생 정보를 채우면 다음 실행에 붙는다.");
    }
  } finally {
    await browser.close().catch(() => {});
    await sql.end({ timeout: 5 }).catch(() => {});
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
