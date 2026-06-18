/**
 * scripts/assign-attendance-codes.ts
 *
 * 멱등 백필 — 재원(비퇴원) 학생에게 키오스크 출석번호(attendance_code)를 발급한다.
 * 정책은 src/features/attendance/kiosk/codes.ts(assignAttendanceCode) 단일 소스를 재사용:
 * 학생 휴대폰 뒷4자리 우선 → 없으면 학부모 → 충돌 시 5자리(0~9).
 *
 * ⚠️ db:seed 와 다르다. 데모는 POC 임포트본이라 seed 금지(전체 wipe). 이 스크립트는 attendance_code가
 *    null인 행만 채우므로 재실행 안전.
 *
 * 사용:
 *   pnpm exec tsx scripts/assign-attendance-codes.ts            # DRY-RUN (쓰기 없음)
 *   pnpm exec tsx scripts/assign-attendance-codes.ts --apply    # 실제 적용
 */
import { config } from "dotenv";
import postgres from "postgres";
import { assignAttendanceCode } from "../src/features/attendance/kiosk/codes";

config({ path: ".env.local" });

const APPLY = process.argv.includes("--apply");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL missing — make sure .env.local has it.");
  process.exit(1);
}

const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 3 });

type Row = {
  id: string;
  tenant_id: string;
  student_phone: string | null;
  parent_phone: string | null;
  attendance_code: string | null;
};

(async () => {
  try {
    // 비퇴원 학생 전수. 발급 순서 결정성 위해 created_at, id 정렬(형제 중 누가 4자리/5자리인지 안정).
    const rows = (await sql`
      select id, tenant_id, student_phone, parent_phone, attendance_code
      from students
      where status <> 'withdrawn'
      order by tenant_id, created_at, id
    `) as unknown as Row[];

    const byTenant = new Map<string, Row[]>();
    for (const r of rows) {
      const list = byTenant.get(r.tenant_id) ?? [];
      list.push(r);
      byTenant.set(r.tenant_id, list);
    }

    const updates: { id: string; code: string }[] = [];
    let skipped = 0;
    let fiveDigit = 0;
    let already = 0;

    for (const [, list] of byTenant) {
      const taken = new Set<string>();
      // 이미 코드가 있는 학생부터 takenCodes에 등록(기존 발급 보존, 충돌 회피).
      for (const r of list) if (r.attendance_code) taken.add(r.attendance_code);
      already += list.filter((r) => r.attendance_code).length;

      for (const r of list) {
        if (r.attendance_code) continue; // 이미 발급됨 — 멱등 유지
        let code: string | null;
        try {
          code = assignAttendanceCode({
            studentPhone: r.student_phone,
            parentPhone: r.parent_phone,
            takenCodes: taken,
          });
        } catch (e) {
          console.warn("  공간 소진 스킵:", r.id, (e as Error).message);
          skipped++;
          continue;
        }
        if (!code) {
          skipped++; // 전화번호 없음 → 발급 불가
          continue;
        }
        taken.add(code);
        if (code.length === 5) fiveDigit++;
        updates.push({ id: r.id, code });
      }
    }

    console.log("=== assign-attendance-codes", APPLY ? "[APPLY]" : "[DRY-RUN]", "===");
    console.log(
      `테넌트 ${byTenant.size} | 비퇴원 ${rows.length} | 기발급 ${already} | 신규발급 ${updates.length}` +
        ` (5자리 충돌 ${fiveDigit}) | 전화없음 스킵 ${skipped}`,
    );

    if (!APPLY) {
      console.log("[DRY-RUN] 쓰기 없음. --apply 로 적용.");
      return;
    }

    let done = 0;
    for (const u of updates) {
      await sql`update students set attendance_code = ${u.code}, updated_at = now() where id = ${u.id} and attendance_code is null`;
      if (++done % 100 === 0) console.log("  set", done, "/", updates.length);
    }
    console.log("APPLIED 출석번호 발급:", done);
  } catch (e) {
    console.error("ERR", (e as Error).message);
    process.exitCode = 1;
  } finally {
    await sql.end();
  }
})();
