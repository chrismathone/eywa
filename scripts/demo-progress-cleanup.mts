// 진도 컨테이너 데모 정리 — '진도데모_*' 학생 통째 삭제(FK cascade가 보고서·컨테이너·엔트리·이벤트 제거).
//   실행: node_modules/.bin/tsx scripts/demo-progress-cleanup.mts
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!.trim(), process.env.SUPABASE_SERVICE_ROLE_KEY!.trim(), {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: demos } = await sb.from("students").select("id, name").like("name", "진도데모_%");
if (!demos || demos.length === 0) {
  console.log("삭제할 데모 학생이 없습니다.");
  process.exit(0);
}
const ids = demos.map((s) => s.id);
const { error } = await sb.from("students").delete().in("id", ids);
if (error) {
  console.error("삭제 실패:", error.message);
  process.exit(1);
}
console.log(`데모 학생 ${demos.length}명 삭제 완료(보고서·진도 컨테이너/엔트리/이벤트 cascade):`, demos.map((s) => s.name).join(", "));
process.exit(0);
