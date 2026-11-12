/**
 * scripts/_makeedu/import-students-list.cjs
 *
 * makeedu **재원생 목록 DOM 스크래핑**(scrape.cjs --list=students → students.json) → aywa `students` additive 동기화.
 * Phase 2 cron 전용 — 부트스트랩의 import-students.cjs(엑셀 47컬럼)는 헤드리스에서 못 쓰므로, 컬럼 적은 DOM
 * 목록을 **header-driven**으로 소비한다. 자연키(이름+학교+학년)로 기존 학생에 매칭 → 없으면 신규 추가(ijw 값 불변).
 *
 * ⚠️ DOM 목록의 첫 셀(No)은 표시용 순번이라 안정 PK가 아니다 → 헤더에 '고유번호'가 있을 때만 makeedu_id 백필,
 *    없으면 자연키 매칭만(makeedu_id 안 건드림). import-students.cjs(엑셀)와 동일한 additive·자연키 가드 사용.
 *
 * 사용: node --env-file=.env.local scripts/_makeedu/import-students-list.cjs [--apply]
 * 입력: $MAKEEDU_OUT/students.json  = { headers, rows:[[...cells]] }
 */
const fs = require("fs");
const path = require("path");
const postgres = require("postgres");
const L = require("./lib.cjs");
const { notifySeatLimitExceeded } = require("./seat-limit-alert.cjs");

const APPLY = process.argv.includes("--apply");
const OUT = process.env.MAKEEDU_OUT || path.resolve(__dirname, "..", "..", ".makeedu-tmp");
const idx = (H) => (sub) => H.findIndex((h) => (h || "").includes(sub));

// 학교 core(접미사 정규화) — "달성초"·"달성초등학교" 동일 취급(상담 임포터와 동일 규약).
const schoolCore = (v) => (L.txt(v) || "").replace(/(초등학교|중학교|고등학교|초|중|고)$/, "");
const phoneDigits = (v) => (L.normPhone(v) || "").replace(/[^0-9]/g, "") || null;

// 엑셀 컬럼식 알파벳 접미사: 1→A, 26→Z, 27→AA, … (한바퀴 돌면 AA). 동명이인 구분용.
function excelSuffix(n) {
  let s = "";
  while (n > 0) {
    n--;
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26);
  }
  return s;
}
// base 이름이 이미 있으면(taken=정규화 이름 집합) 다음 미사용 접미사 부여: 테스트→테스트A→테스트B…
// 사용자 규칙(2026-07-06): makeedu에서 새 학생인데 이름이 aywa에 이미 있으면(퇴원 포함) 뒤에 알파벳.
function uniqueName(base, taken) {
  if (!taken.has(L.normalizeName(base))) return base;
  for (let i = 1; ; i++) {
    const cand = base + excelSuffix(i);
    if (!taken.has(L.normalizeName(cand))) return cand;
  }
}

// DOM 상태 텍스트 → aywa status. 재원생 목록이라 미상이면 enrolled 가정.
function statusFrom(v) {
  const s = L.txt(v) || "";
  if (/퇴원/.test(s)) return "withdrawn";
  if (/휴원/.test(s)) return "on_hold";
  return "enrolled";
}

(async () => {
  const file = path.join(OUT, "students.json");
  if (!fs.existsSync(file)) throw new Error(`no students.json in ${OUT} (scrape.cjs --list=students 먼저 실행)`);
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  const H = idx(data.headers);
  const ci = {
    name: H("원생명") >= 0 ? H("원생명") : H("이름"), // 재원생 목록=원생명, 예비/기타 목록=이름
    school: H("학교"),
    grade: H("학년"),
    gender: H("성별"),
    stud: H("원생연락처"),
    parentPhone: H("보호자연락처"),
    parentName: H("보호자이름"),
    code: H("출결"),
    status: H("상태"),
    birth: H("생년월일"),
    enrolled: H("입학일"),
    uid: H("고유"), // 원생고유번호(있으면 안정 PK) — 없으면 -1
  };

  const rows = [];
  for (const r of data.rows) {
    const name = L.txt(r[ci.name]);
    if (!name || name === "신규") continue;
    rows.push({
      // 안정 고유번호 컬럼이 있을 때만 makeedu_id로 사용(없으면 null = 자연키 매칭만).
      makeedu_id: ci.uid >= 0 ? L.txt(r[ci.uid]) : null,
      name,
      school: ci.school >= 0 ? L.txt(r[ci.school]) : null,
      grade: ci.grade >= 0 ? L.gradeNorm(r[ci.grade]) : null,
      gender: ci.gender >= 0 ? L.gender(r[ci.gender]) : null,
      student_phone: ci.stud >= 0 ? L.normPhone(r[ci.stud]) : null,
      parent_phone: ci.parentPhone >= 0 ? L.normPhone(r[ci.parentPhone]) : null,
      parent_name: ci.parentName >= 0 ? L.txt(r[ci.parentName]) : null,
      attendance_code: ci.code >= 0 ? L.txt(r[ci.code]) : null,
      birth_date: ci.birth >= 0 ? L.parseDate(r[ci.birth]) : null,
      enrolled_at: ci.enrolled >= 0 ? L.parseDate(r[ci.enrolled]) : null,
      status: ci.status >= 0 ? statusFrom(r[ci.status]) : "enrolled",
    });
  }
  console.log("file: students.json  parsed:", rows.length, "| makeedu_id 컬럼:", ci.uid >= 0 ? "있음" : "없음(자연키만)");
  console.log("status dist:", rows.reduce((a, r) => ((a[r.status] = (a[r.status] || 0) + 1), a), {}));

  const sql = postgres(process.env.DATABASE_URL, { prepare: false });
  try {
    const tenantId = await L.resolveTenantId(sql);
    const existing = await sql`
      select id, makeedu_id, name, school, grade, status, student_phone, parent_phone from students where tenant_id = ${tenantId}`;
    const byMakeedu = new Map(existing.filter((e) => e.makeedu_id).map((e) => [e.makeedu_id, e.id]));
    // 매칭 = **강한 키만**(이름+학교core+학년 → 이름+학생전화 → 이름+보호자전화). 이름 단독·이름+학년(느슨)
    // 티어는 제거 — 동명이인(다른 학교/학년)이 같은 이름 1명에 잘못 붙어 스킵되던 갭 차단. 학교 표기 드리프트는
    // schoolCore가, 학년 드리프트는 전화가 흡수. 모호/미매칭 = 신규로 보고 아래에서 알파벳 접미사로 구분.
    const nkey = (x) => L.normalizeName(x.name);
    const gkey = (x) => L.gradeNorm(x.grade) || "";
    const strict = L.tieredMatcher(existing, [
      (x) => (x.name && schoolCore(x.school) ? `${nkey(x)}|${schoolCore(x.school)}|${gkey(x)}` : null),
      (x) => { const p = phoneDigits(x.student_phone); return x.name && p ? `${nkey(x)}|s|${p}` : null; },
      (x) => { const p = phoneDigits(x.parent_phone); return x.name && p ? `${nkey(x)}|p|${p}` : null; },
    ]);
    // 🔴 마지막 티어 = **접미사를 뗀 이름 + 전화**(2026-10-20 권민서·김지유) — 에이와 `권민서A` ↔ 메이크에듀 `권민서`처럼 두 시스템이
    //    접미사를 따로 매기면 위 티어가 전부 놓쳐 `권민서B`를 새로 만들었다(그 뒤 병합이 번호를 버려 연결까지 끊겼다).
    //    대상은 **아직 메이크에듀와 안 이어진 재원·휴원 학생만**(이미 다른 원생에 이어진 학생·퇴원생에 붙이지 않는다) · 전화가 같아야 한다
    //    (이름만으론 진짜 동명이인을 합친다) · 둘 이상 걸리면 모호로 보고 붙이지 않는다(tieredMatcher).
    const linkable = existing.filter((e) => !e.makeedu_id && e.status !== "withdrawn");
    const bkey = (x) => L.baseNameKey(x.name);
    const loose = L.tieredMatcher(linkable, [
      (x) => { const p = phoneDigits(x.student_phone); return x.name && p ? `${bkey(x)}|s|${p}` : null; },
      (x) => { const p = phoneDigits(x.parent_phone); return x.name && p ? `${bkey(x)}|p|${p}` : null; },
    ]);
    // 고유번호 칸이 없는 목록이어도 loose로 찾으면 '이미 있음'으로 건너뛴다(중복 학생을 만들지 않는 것이 목적이다).
    const match = (r) => strict(r) || loose(r);
    // 이름 충돌 집합 = 전 상태(퇴원 포함) 정규화 이름. 신규 추가 때마다 확정 이름을 넣어 순차(A,B,…) 부여.
    const takenNames = new Set(existing.map((e) => L.normalizeName(e.name)));

    const toLink = []; // 기존 학생에 makeedu_id 백필(고유번호 있을 때만)
    const toInsert = []; // aywa에 없는 신규 학생(이름 충돌 시 접미사 붙인 finalName 포함)
    let alreadyLinked = 0, suffixed = 0, skippedDup = 0; // skippedDup = insert 제약 백스톱 카운트
    for (const r of rows) {
      if (r.makeedu_id && byMakeedu.has(r.makeedu_id)) { alreadyLinked++; continue; }
      const id = match(r);
      if (id) {
        if (r.makeedu_id) toLink.push({ id, makeedu_id: r.makeedu_id });
        else alreadyLinked++; // 강한 키로 이미 존재(makeedu_id 없어 백필 불가) = 멱등 스킵
        continue;
      }
      // 신규 = makeedu 기준 새 학생. 이름이 aywa에 이미 있으면(퇴원 포함) 다음 알파벳 접미사로 구분.
      const finalName = uniqueName(r.name, takenNames);
      if (finalName !== r.name) suffixed++;
      takenNames.add(L.normalizeName(finalName));
      toInsert.push({ ...r, name: finalName, baseName: r.name });
    }
    console.log(`\n[additive] aywa 기존 학생 ${existing.length} | makeedu DOM ${rows.length}`);
    console.log(`  이미 존재(멱등): ${alreadyLinked} | makeedu_id 백필: ${toLink.length} | 신규 추가: ${toInsert.length}` + (suffixed ? ` | 그중 동명이인 접미사: ${suffixed}` : ""));
    if (toInsert.length) console.log("  신규 표본:", toInsert.slice(0, 8).map((r) => `${r.baseName === r.name ? r.name : `${r.baseName}→${r.name}`}/${r.school || "?"}/${r.grade || "?"}`).join(", "));

    if (!APPLY) { console.log("\n[DRY-RUN] --apply 없이 종료 (DB write 0)."); return; }

    // "↻ 동기화" 배지 = "지난 동기화가 새로 추가한 학생". 이 실행(=성공한 동기화)이 시작되면
    // 먼저 지난 실행의 신규 표시를 전부 클리어한다 → 라벨이 "다음 동기화까지만" 유지되고 이번엔 사라진다(0061a).
    const cleared = await sql`update students set sync_added_at = null where tenant_id = ${tenantId} and sync_added_at is not null`;

    let linked = 0, inserted = 0, insertedEnrolled = 0;
    for (const t of toLink) {
      const res = await sql`update students set makeedu_id = ${t.makeedu_id}, updated_at = now() where id = ${t.id} and makeedu_id is null`;
      linked += res.count;
    }
    for (const r of toInsert) {
      try {
        // 신규 추가 학생만 sync_added_at=now() → 이번 동기화 라벨 대상(매칭 백필은 대상 아님).
        // dup_suspect = aywa가 이름 충돌로 접미사를 새로 붙인 경우만(사람 확인 필요). makeedu 원래 이름 그대로면 false.
        await sql`
          insert into students (tenant_id, makeedu_id, name, gender, attendance_code, school, grade,
            student_phone, parent_phone, parent_name, birth_date, enrolled_at, status, sync_added_at, dup_suspect)
          values (${tenantId}, ${r.makeedu_id}, ${r.name}, ${r.gender}, ${r.attendance_code}, ${r.school}, ${r.grade},
            ${r.student_phone}, ${r.parent_phone}, ${r.parent_name}, ${r.birth_date}, ${r.enrolled_at}, ${r.status}, now(), ${r.name !== r.baseName})`;
        inserted++;
        if (r.status === "enrolled") insertedEnrolled++;
      } catch (e) {
        if (/ux_students_active_natural_key|unique|duplicate/i.test(e.message)) { skippedDup++; continue; }
        throw e;
      }
    }
    await L.recordSync(sql, tenantId, "students", linked + inserted);
    // 외부 장부의 학생 반영은 완료하고, 좌석 초과 사실만 원장 알림에 남긴다.
    try {
      const notified = await notifySeatLimitExceeded(sql, tenantId, insertedEnrolled);
      if (notified) console.log(`  좌석 한도 초과 알림: 원장 ${notified}명`);
    } catch (e) {
      console.warn(`  좌석 한도 초과 알림 기록 실패(학생 가져오기는 완료): ${e.message}`);
    }
    console.log(`  라벨 클리어(지난 신규): ${cleared.count} → 이번 신규 라벨: ${inserted}`);
    console.log(`\nbackfilled makeedu_id: ${linked} | inserted new: ${inserted}` + (skippedDup ? ` | skipped(자연키 중복): ${skippedDup}` : ""));
  } finally {
    await sql.end();
  }
})().catch((e) => {
  console.error("ERR", e.message);
  process.exit(1);
});
