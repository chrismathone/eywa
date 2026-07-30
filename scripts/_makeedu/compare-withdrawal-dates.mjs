/**
 * scripts/_makeedu/compare-withdrawal-dates.mjs — makeedu 퇴원일 ↔ eywa `withdrawn_at` **이중 대조**. 기본 dry-run.
 *
 * 왜(원장 지시 2026-07-30): *"메이크에듀와 퇴원날짜를 이중으로 비교해봐. 메이크에듀가 실제 퇴원날짜와 일치할
 * 확률이 높음. 실제 결제랑 환불을 진행하므로."* — 맞는 판단이다. eywa의 `withdrawn_at`은 일괄 처리로
 * 오염됐지만(2026-07-10 하루에 119명 = 장부 날짜), makeedu는 **돈이 오간 기록**이라 실제 시점에 가깝다.
 *
 * 두 가지를 한다:
 *   ① **채우기** — eywa에서 날짜를 끝내 알 수 없던 학생(수강 이력 0 + 일괄 날짜, 실측 42명)에 makeedu 퇴원일 주입
 *   ② **검증** — 이미 수강 종료일로 교정한 학생(실측 77명)의 날짜가 makeedu와 어긋나는지 대조(어긋나면 보고만)
 *
 * ⚠️ **매칭 키는 `makeedu_id`(원생고유번호)** — 이름은 동명이인·개명으로 틀린다. id가 없으면 **이름이 eywa에서
 *    유일할 때만** 폴백하고, 2명 이상이면 손대지 않는다(엉뚱한 학생 날짜를 바꾸는 게 최악).
 * ⚠️ 실행 전 **undo JSON**을 남긴다. `status`·퇴원 사유는 손대지 않고 **날짜만** 고친다.
 *
 * 선행: 연동 PC(신뢰 IP)에서
 *   node scripts/_makeedu/capture-session.cjs                 # 브라우저 로그인 → 세션 저장
 *   node --env-file=.env.local scripts/_makeedu/scrape.cjs --list=withdrawn
 * 실행:
 *   node --env-file=.env.local scripts/_makeedu/compare-withdrawal-dates.mjs            # dry-run
 *   node --env-file=.env.local scripts/_makeedu/compare-withdrawal-dates.mjs --apply
 */
import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";

const APPLY = process.argv.includes("--apply");
const FILE =
  process.argv.find((a) => a.startsWith("--file="))?.split("=")[1] ??
  path.resolve(process.env.MAKEEDU_OUT || path.resolve(process.cwd(), ".makeedu-tmp"), "withdrawn.json");
const UNDO_DIR = process.argv.find((a) => a.startsWith("--undo-dir="))?.split("=")[1] ?? path.dirname(FILE);

/** makeedu 날짜 셀 → `YYYY-MM-DD`. "2025-01-22(수)"·"2025.01.22"·"20250122" 형태를 흡수, 아니면 null. */
export function parseMakeeduDate(v) {
  const s = String(v ?? "").trim();
  let m = /(\d{4})[-.\/](\d{1,2})[-.\/](\d{1,2})/.exec(s);
  if (!m) m = /^(\d{4})(\d{2})(\d{2})$/.exec(s.replace(/\D/g, ""));
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

if (!fs.existsSync(FILE)) {
  console.error(`🔴 스크랩 파일이 없습니다: ${FILE}`);
  console.error("   먼저 연동 PC에서: node --env-file=.env.local scripts/_makeedu/scrape.cjs --list=withdrawn");
  process.exit(1);
}
const doc = JSON.parse(fs.readFileSync(FILE, "utf8"));
const H = doc.headers ?? [];
const col = (re) => H.findIndex((h) => re.test(String(h)));
// ⚠️ 퇴원 목록과 재원 목록의 **열 이름이 다르다**(퇴원=`원생번호`, 재원=`원생고유번호`) — 둘 다 받는다.
// 실측(2026-07-30): 퇴원 목록 4,427행 · 원생번호 5자리 · 퇴원일 `YYYY-MM-DD` 전건 파싱 성공.
const cId = col(/원생고유번호|원생번호/);
const cName = col(/원생명|이름/);
const cOut = col(/퇴원일/);
const cParentPhone = col(/보호자.*전화/);
const cStudentPhone = col(/원생.*전화/);
const cReason = col(/^사유$/);
if (cId < 0 || cName < 0 || cOut < 0) {
  console.error(`🔴 필요한 열을 못 찾았습니다 — headers: ${JSON.stringify(H)}`);
  console.error("   (원생번호(또는 원생고유번호) / 원생명 / 퇴원일 이 있어야 합니다)");
  process.exit(1);
}

/** 전화 정규화 — 숫자만, 뒤 11자리(대조 전용. 값을 저장·출력하지 않는다). */
const normPhone = (v) => {
  const d = String(v ?? "").replace(/\D/g, "");
  return d.length >= 9 ? d.slice(-11) : "";
};

const mk = [];
for (const r of doc.rows ?? []) {
  const id = String(r[cId] ?? "").trim();
  const name = String(r[cName] ?? "").trim();
  const out = parseMakeeduDate(r[cOut]);
  if (!name) continue;
  const phones = [cParentPhone >= 0 ? r[cParentPhone] : null, cStudentPhone >= 0 ? r[cStudentPhone] : null]
    .map(normPhone)
    .filter(Boolean);
  mk.push({ id, name, out, phones, reason: cReason >= 0 ? String(r[cReason] ?? "").trim() : "" });
}
const byId = new Map(mk.filter((x) => x.id).map((x) => [x.id, x]));
// 전화 → makeedu 행. 같은 번호가 여럿(형제)이면 **버린다**(형제를 뒤바꾸면 최악).
const byPhone = new Map();
for (const x of mk) for (const p of x.phones) byPhone.set(p, byPhone.has(p) ? null : x);
const nameCount = new Map();
for (const x of mk) nameCount.set(x.name, (nameCount.get(x.name) ?? 0) + 1);

const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 });
try {
  const tenants = await sql`select id from tenants`;
  if (tenants.length !== 1) throw new Error(`테넌트 ${tenants.length}개 — 대상 특정 불가`);
  const tenant = tenants[0].id;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

  const rows = await sql`
    select s.id, s.name, s.makeedu_id, s.parent_phone, s.student_phone,
      to_char(s.withdrawn_at,'YYYY-MM-DD') as wd,
      (select count(*) from enrollments e where e.student_id = s.id and e.tenant_id = ${tenant}) as enr
    from students s where s.tenant_id = ${tenant} and s.status = 'withdrawn'`;

  const eywaNameCount = new Map();
  for (const r of rows) eywaNameCount.set(r.name, (eywaNameCount.get(r.name) ?? 0) + 1);

  const fill = []; // 날짜 미상(수강 이력 0) → makeedu 날짜로 채움
  const mismatch = []; // 이미 날짜가 있는데 makeedu와 다름 → 보고만
  const unmatched = [];
  const via = { id: 0, phone: 0, name: 0 };
  for (const r of rows) {
    // 매칭 우선순위 — 강한 키부터. ① 원생번호 ② 전화(형제 중복 번호는 위에서 제거됨) ③ 이름(양쪽 모두 유일할 때만)
    let m = r.makeedu_id ? byId.get(String(r.makeedu_id).trim()) : null;
    let how = m ? "id" : null;
    if (!m) {
      for (const p of [r.parent_phone, r.student_phone].map(normPhone).filter(Boolean)) {
        const hit = byPhone.get(p);
        if (hit) {
          m = hit;
          how = "phone";
          break;
        }
      }
    }
    if (!m && nameCount.get(r.name) === 1 && eywaNameCount.get(r.name) === 1) {
      m = mk.find((x) => x.name === r.name);
      how = m ? "name" : null;
    }
    if (!m) {
      unmatched.push(r);
      continue;
    }
    via[how]++;
    if (!m.out || m.out > today) continue; // 날짜 없음·미래 = 손대지 않음
    if (Number(r.enr) === 0) {
      if (m.out !== r.wd) fill.push({ ...r, to: m.out, via: how });
    } else if (m.out !== r.wd) {
      mismatch.push({ ...r, mk: m.out });
    }
  }

  console.log(`\n════ makeedu 퇴원일 이중 대조 ${APPLY ? "실행(--apply)" : "DRY-RUN"} ════`);
  console.log(`makeedu 퇴원생 ${mk.length}행(퇴원일 파싱 ${mk.filter((x) => x.out).length}) · eywa 퇴원생 ${rows.length}`);
  console.log(`매칭 경로 — 원생번호 ${via.id} · 전화 ${via.phone} · 이름 ${via.name} · 미매칭 ${unmatched.length}`);
  console.log(`\n① 날짜 미상 → 채우기 대상: **${fill.length}건**`);
  fill.slice(0, 15).forEach((f) => console.log(`   · ${f.name} : ${f.wd} → ${f.to} (${f.via} 매칭)`));
  if (fill.length > 15) console.log(`   … 외 ${fill.length - 15}건`);
  console.log(`\n② 기존 날짜 ↔ makeedu 불일치(보고만, 자동 수정 안 함): ${mismatch.length}건`);
  mismatch.slice(0, 15).forEach((f) => console.log(`   · ${f.name} : eywa ${f.wd} / makeedu ${f.mk}`));
  console.log(`\n③ makeedu에서 못 찾은 eywa 퇴원생: ${unmatched.length}건(makeedu에 없거나 동명이인이라 보류)`);

  if (!APPLY) {
    console.log(`\n(dry-run) 아무것도 변경하지 않았습니다. 실행은 --apply.`);
  } else if (!fill.length) {
    console.log(`\n채울 대상이 없어 종료합니다.`);
  } else {
    const undo = path.join(UNDO_DIR, `undo-makeedu-withdrawal-${today.replace(/-/g, "")}.json`);
    fs.writeFileSync(undo, JSON.stringify({ tenant, rows: fill.map((f) => ({ id: f.id, name: f.name, from: f.wd, to: f.to })) }, null, 2));
    console.log(`\nundo 스냅샷: ${undo}`);
    let done = 0;
    for (const f of fill) {
      // 현재 값을 조건에 걸어 동시 변경을 덮어쓰지 않는다.
      const res = await sql`
        update students set withdrawn_at = ${f.to}::date
        where id = ${f.id} and tenant_id = ${tenant} and status='withdrawn'
          and ${f.wd === null ? sql`withdrawn_at is null` : sql`withdrawn_at = ${f.wd}::date`}`;
      if (res.count === 1) done++;
    }
    console.log(`채움 완료: ${done}/${fill.length}`);
  }
} finally {
  await sql.end({ timeout: 5 }).catch(() => {});
}
