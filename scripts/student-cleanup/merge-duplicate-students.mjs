/**
 * 같은 사람이 두 행으로 들어간 학생 중복 정리 (원장 승인 2026-07-29).
 *
 * 배경: 접미사 규칙이 수동 등록에만 있어 상담/임포트로 들어온 예비원생 행이 재원생과 같은 이름으로 남았다.
 * 동명이인처럼 보이지만 **학부모·학생 전화·학교·학년이 전부 같은 동일인**이다.
 *
 * ⚠️ 이 스크립트는 "병합"이라 부르지만 실제로는 **참조 0건인 빈 중복행 삭제**다 —
 * 대상 행이 21개 FK 테이블 어디에도 참조되지 않을 때만 지운다(하나라도 있으면 중단).
 * 데이터를 옮기지 않으므로 이관 로직이 없고, 그래서 안전하다.
 *
 * 🔴 동명이인 오삭제 방지 3중 가드(하나라도 어긋나면 그 쌍을 건너뛴다):
 *   ① id 고정 — 이름으로 찾지 않는다(같은 이름의 **다른 사람**이 실재한다: 칠성초 초3 전주원)
 *   ② 학교·학년 일치
 *   ③ 전화(숫자 정규화) 일치 — 학부모·학생 둘 다
 *
 * 사용: node merge-duplicate-students.mjs            (dry-run, 기본)
 *       node merge-duplicate-students.mjs --apply    (실행 + undo JSON 저장)
 */
import postgres from "postgres";
import { readFileSync, writeFileSync } from "node:fs";

const APPLY = process.argv.includes("--apply");
const ENV_PATH = process.env.EYWA_ENV ?? "D:/eywa_refactoring/.env.local";
const UNDO_PATH = process.env.UNDO_PATH ?? "D:/tmp/merge-duplicate-students-undo.json";

/** 지울 중복행(prospect) → 남길 본 행. id로 고정(이름 매칭 금지). */
const PAIRS = [
  {
    label: "김준우(침산중 중2)",
    dropId: "41598aff-f49a-477c-abe1-94d500517d94",
    keepId: "064c749d-a2ef-4038-9517-6e62bb89be4c",
  },
  {
    label: "전주원(성광중 중2)",
    dropId: "608a345f-115b-4340-b111-d985bce8798f",
    keepId: "0fb27512-f07f-4d3f-a0e0-f289a0eb1e8b",
  },
];

/** 숫자만 남기고 10자리 '10…'이면 앞 0 복원(저장 포맷이 하이픈·앞자리0 유실로 갈려 있다). */
function phoneKey(s) {
  let d = String(s ?? "").replace(/\D/g, "");
  if (d.length === 10 && d.startsWith("10")) d = `0${d}`;
  return d;
}

const url = readFileSync(ENV_PATH, "utf8").match(/^DATABASE_URL="?([^"\r\n]+)"?/m)?.[1]?.trim();
if (!url) throw new Error("DATABASE_URL을 찾지 못했습니다");
const sql = postgres(url, { prepare: false, max: 1, connect_timeout: 15 });

async function studentFkRefs() {
  const rows = await sql`
    select tc.table_name, kcu.column_name
    from information_schema.table_constraints tc
    join information_schema.key_column_usage kcu on kcu.constraint_name = tc.constraint_name
    join information_schema.constraint_column_usage ccu on ccu.constraint_name = tc.constraint_name
    where tc.constraint_type='FOREIGN KEY' and ccu.table_name='students' and ccu.column_name='id'
      and kcu.column_name like '%student%'`;
  return [...new Set(rows.map((r) => `${r.table_name}.${r.column_name}`))];
}

try {
  const refs = await studentFkRefs();
  console.log(`참조 테이블 ${refs.length}개 검사\n`);
  const undo = [];
  let ok = 0;
  let skip = 0;

  for (const p of PAIRS) {
    const rows = await sql`select * from students where id in (${p.dropId}, ${p.keepId})`;
    const drop = rows.find((r) => r.id === p.dropId);
    const keep = rows.find((r) => r.id === p.keepId);
    const fail = (why) => {
      console.log(`⏭  ${p.label} 건너뜀 — ${why}`);
      skip += 1;
    };
    if (!drop || !keep) {
      fail("행을 찾지 못함(이미 처리됐을 수 있음)");
      continue;
    }
    // 가드 ②③ — 같은 이름의 다른 사람을 지우는 사고 방지
    if ((drop.school ?? "") !== (keep.school ?? "") || (drop.grade ?? "") !== (keep.grade ?? "")) {
      fail(`학교·학년 불일치(${drop.school}/${drop.grade} vs ${keep.school}/${keep.grade})`);
      continue;
    }
    if (
      phoneKey(drop.parent_phone) !== phoneKey(keep.parent_phone) ||
      phoneKey(drop.student_phone) !== phoneKey(keep.student_phone)
    ) {
      fail("전화 불일치 — 동일인이 아닐 수 있음");
      continue;
    }
    // 가드 ① — 참조 0건일 때만(있으면 옮겨야 하므로 이 스크립트 범위 밖)
    const held = [];
    for (const ref of refs) {
      const [t, c] = ref.split(".");
      const [{ n }] = await sql.unsafe(`select count(*)::int as n from "${t}" where "${c}" = $1`, [p.dropId]);
      if (n > 0) held.push(`${t}=${n}`);
    }
    if (held.length > 0) {
      fail(`참조 데이터 있음(${held.join(", ")}) — 수동 확인 필요`);
      continue;
    }

    console.log(`✅ ${p.label}: "${drop.name}"(prospect, 참조 0) → "${keep.name}"에 흡수`);
    if (APPLY) {
      undo.push(drop);
      await sql`delete from students where id = ${p.dropId}`;
    }
    ok += 1;
  }

  console.log(`\n${APPLY ? "적용" : "DRY-RUN"} — 대상 ${ok}건 / 건너뜀 ${skip}건`);
  if (APPLY && undo.length) {
    writeFileSync(UNDO_PATH, JSON.stringify(undo, null, 2), "utf8");
    console.log(`undo JSON 저장: ${UNDO_PATH} (되돌리려면 이 행들을 students에 다시 insert)`);
  }
  if (!APPLY) console.log("실제 적용하려면 --apply");
} finally {
  await sql.end({ timeout: 3 });
}
