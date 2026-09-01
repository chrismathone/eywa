/**
 * scripts/_oneoff/normalize-school-names.cjs — 학교 표기 일괄 정규화(실데이터).
 *
 * 원장 2026-09-01: *"~초등학교도 -> ~초 로 변경해야함. db에서 수정하고 이런경우도 저장할때 강제
 * 변경시키고 저장."* + *"지금 일중 -> 대구일중으로 전부 db 변경"*.
 * 저장 시 강제 변환은 앱 쪽([`school-name.ts`](../../src/features/schools/school-name.ts)
 * `canonicalSchoolName`)이 이미 한다 — 이 스크립트는 **이미 쌓인 행**을 같은 규칙으로 맞춘다.
 *
 * 🔴 **드라이런이 기본**이다(`--apply` 없으면 아무것도 안 쓴다). 원장 지시: 데이터 마이그레이션은
 *    드라이런 먼저.
 * 🔴 **students는 자연키(부분 유니크 인덱스: tenant_id, name_normalized, school, grade WHERE
 *    status<>'withdrawn')를 쓴다.** 정규화하면 `옥산초등학교`와 `옥산초`가 같은 키가 되어 **충돌**할 수
 *    있다 → 드라이런이 충돌을 먼저 찾아 목록으로 알리고, 적용 때는 그 행을 **건너뛴다**(합치는 판단은
 *    사람 몫 — 학생 병합은 되돌릴 수 없다).
 *
 * 사용:
 *   node --env-file=.env.local scripts/_oneoff/normalize-school-names.cjs           # 드라이런(기본)
 *   node --env-file=.env.local scripts/_oneoff/normalize-school-names.cjs --apply   # 실제 적용
 * env: DATABASE_URL.
 */
const path = require("path");
const postgres = require("postgres");

const APPLY = process.argv.includes("--apply");

// ── 앱과 **같은 규칙**(src/features/schools/school-name.ts canonicalSchoolName)의 CJS 사본. ────────
// ⚠️ 한 벌로 합치지 못하는 이유: 이 스크립트는 TS 빌드 없이 node로 도는 일회성 도구다.
//    규칙을 바꾸면 **두 곳을 함께** 고칠 것(앱 쪽에 Vitest가 있다).
const SUFFIX_RULES = [
  [/여자상업고등학교$/, "여상"],
  [/여자정보고등학교$/, "여고"],
  [/여자중학교$/, "여중"],
  [/여자고등학교$/, "여고"],
  [/여자초등학교$/, "여초"],
  [/초등학교$/, "초"],
  [/중학교$/, "중"],
  [/고등학교$/, "고"],
  [/초등$/, "초"],
  [/중등$/, "중"],
  [/고등$/, "고"],
];
const SAVE_ALIASES = { 일중: "대구일중" };

// 🔴 양끝 trim만 — 가운데 공백을 지우면 `칠성초2 7세` → `칠성초27세`가 된다(드라이런에서 실측).
function canonicalSchoolName(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  let out = s;
  for (const [re, to] of SUFFIX_RULES) {
    if (re.test(out)) {
      out = out.replace(re, to);
      break;
    }
  }
  return SAVE_ALIASES[out] ?? out;
}

/** 학생 자연키 — DB 인덱스와 같은 축(이름 정규화는 소문자+공백제거로 근사). */
const naturalKey = (name, school, grade) =>
  `${String(name ?? "").toLowerCase().replace(/\s+/g, "")}|${school ?? ""}|${grade ?? ""}`;

(async () => {
  const sql = postgres(process.env.DATABASE_URL, { prepare: false });
  try {
    console.log(`모드: ${APPLY ? "APPLY(실제 UPDATE)" : "DRY-RUN(쓰기 없음)"}\n`);

    // ── 1) 등록상담 ────────────────────────────────────────────────
    const consults = await sql`
      select id, tenant_id, prospect_school
        from enrollment_consultations
       where prospect_school is not null and prospect_school <> ''`;
    const consultChanges = [];
    for (const c of consults) {
      const next = canonicalSchoolName(c.prospect_school);
      if (next && next !== c.prospect_school) consultChanges.push({ ...c, next });
    }
    summarize("enrollment_consultations.prospect_school", consults.length, consultChanges, "prospect_school");

    // ── 2) 학생 ────────────────────────────────────────────────────
    const students = await sql`
      select id, tenant_id, name, school, grade, status
        from students
       where school is not null and school <> ''`;
    // 자연키 충돌 검사 — 활성(status<>'withdrawn') 행만 인덱스 대상이다.
    const activeKeys = new Map(); // key -> [id]
    for (const s of students) {
      if (s.status === "withdrawn") continue;
      const k = naturalKey(s.name, s.school, s.grade);
      activeKeys.set(k, [...(activeKeys.get(k) ?? []), s.id]);
    }
    const studentChanges = [];
    const collisions = [];
    for (const s of students) {
      const next = canonicalSchoolName(s.school);
      if (!next || next === s.school) continue;
      if (s.status !== "withdrawn") {
        const k = naturalKey(s.name, next, s.grade);
        const owners = (activeKeys.get(k) ?? []).filter((id) => id !== s.id);
        if (owners.length > 0) {
          collisions.push({ ...s, next, owners });
          continue; // 🔴 충돌 행은 건드리지 않는다(합치기는 사람이 판단)
        }
        // 옮겨 간 키를 예약해 같은 배치 안에서 두 행이 같은 키로 몰리는 것도 막는다.
        activeKeys.set(k, [...(activeKeys.get(k) ?? []), s.id]);
      }
      studentChanges.push({ ...s, next });
    }
    summarize("students.school", students.length, studentChanges, "school");
    if (collisions.length) {
      console.log(`  🔴 자연키 충돌로 **건너뛴** 학생 ${collisions.length}명 — 같은 사람이 두 행일 수 있다:`);
      for (const c of collisions) {
        console.log(`     · ${c.name} ${c.grade ?? ""} : "${c.school}" → "${c.next}" (충돌 상대 ${c.owners.join(", ")})`);
      }
      console.log("     → 사람이 확인해 병합하거나 한쪽을 퇴원 처리한 뒤 다시 돌릴 것.\n");
    }

    if (!APPLY) {
      console.log("드라이런 끝 — 실제 적용은 --apply.");
      return;
    }

    // ── 적용 ───────────────────────────────────────────────────────
    let n1 = 0;
    for (const c of consultChanges) {
      await sql`update enrollment_consultations set prospect_school = ${c.next}, updated_at = now() where id = ${c.id}`;
      n1 += 1;
    }
    let n2 = 0;
    for (const s of studentChanges) {
      await sql`update students set school = ${s.next}, updated_at = now() where id = ${s.id}`;
      n2 += 1;
    }
    console.log(`\n적용 완료 — 상담 ${n1}행 · 학생 ${n2}행 (충돌 건너뜀 ${collisions.length})`);
  } finally {
    await sql.end();
  }
})().catch((e) => {
  console.error("ERR", e.message);
  process.exit(1);
});

/** 바뀌는 값들을 "옛 표기 → 새 표기 × 건수"로 접어 보여 준다(행 목록은 길어서 못 읽는다). */
function summarize(label, total, changes, col) {
  const byPair = new Map();
  for (const c of changes) {
    const k = `${c[col]} → ${c.next}`;
    byPair.set(k, (byPair.get(k) ?? 0) + 1);
  }
  console.log(`▷ ${label} — 전체 ${total}행 중 **${changes.length}행** 변경 예정`);
  for (const [k, n] of [...byPair.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`   ${k}  (${n}행)`);
  }
  if (byPair.size === 0) console.log("   (변경 없음)");
  console.log("");
}

void path;
