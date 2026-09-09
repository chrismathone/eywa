/**
 * 상담 본문에 붙어 온 **화면 코드 조각**을 걷어낸다(원장 2026-09-09 *"그 조각만 걷어내"*).
 *
 * 🔴 규칙은 앱과 **같은 한 벌**이어야 한다 — 여기서 정규식을 새로 쓰면 다음 임포트에서 되살아난다.
 *    그래서 [`src/features/consultations/paste-cleanup.ts`](../../src/features/consultations/paste-cleanup.ts)의
 *    규칙을 그대로 옮겨 적고, 앱 쪽 Vitest가 그 규칙을 잠근다(실데이터 문자열을 픽스처로 박아 뒀다).
 * ⚠️ 드라이런이 기본. 실제 반영은 `--apply`.
 *
 * 실행: node --env-file=.env.local scripts/_oneoff/clean-pasted-markup.mjs [--apply]
 */
import postgres from "postgres";

const APPLY = process.argv.includes("--apply");
const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 });

const MARKUP_MARKERS = [
  /data-(?:turn-id|turn|testid|scroll-anchor)\s*=/i,
  /\btabindex\s*=\s*"/i,
  /\bdir\s*=\s*"(?:auto|ltr|rtl)"/i,
  /pointer-events-(?:auto|none)/i,
  /scroll-mt-\[/i,
  /\bclass\s*=\s*"[^"]*\b(?:flex|grid|text-|bg-)/i,
];

function looksLikeAttributeSoup(line) {
  if (/[가-힣]/.test(line)) return false;
  const pairs = line.match(/[a-zA-Z-]+\s*=\s*"[^"]*"/g);
  return (pairs?.length ?? 0) >= 2;
}
const isMarkupLine = (line) => MARKUP_MARKERS.some((re) => re.test(line)) || looksLikeAttributeSoup(line);

function cleanLine(line) {
  if (!isMarkupLine(line)) return line;
  const close = line.lastIndexOf(">");
  if (close >= 0) {
    const tail = line.slice(close + 1).trim();
    return tail === "" ? null : tail;
  }
  return /[가-힣]/.test(line) ? line : null;
}

function stripPastedMarkup(value) {
  if (typeof value !== "string" || value === "") return value ?? null;
  if (!value.split(/\r?\n/).some(isMarkupLine)) return value;
  const eol = value.includes("\r\n") ? "\r\n" : "\n";
  return value
    .split(/\r?\n/)
    .map(cleanLine)
    .filter((line) => line !== null)
    .join(eol);
}

try {
  const rows = await sql`
    select c.id, s.name as student_name, c.summary
    from student_consultations c
    left join students s on s.id = c.student_id
    where c.summary is not null`;
  const changes = rows
    .map((row) => ({ ...row, next: stripPastedMarkup(row.summary) }))
    .filter((row) => row.next !== row.summary);

  console.log(`상담 ${rows.length}건 중 조각이 섞인 것 ${changes.length}건`);
  for (const row of changes) {
    const removed = row.summary.split(/\r?\n/).filter((line) => isMarkupLine(line));
    console.log(`  ${row.student_name ?? "?"} — ${removed.length}줄 제거`);
    for (const line of removed) console.log(`      ${line.slice(0, 90)}…`);
  }

  if (!APPLY) {
    console.log("\n드라이런입니다. 실제 반영은 --apply");
  } else if (changes.length > 0) {
    await sql.begin(async (tx) => {
      for (const row of changes) {
        await tx`update student_consultations set summary = ${row.next}, updated_at = now() where id = ${row.id}`;
      }
    });
    console.log(`\n반영 완료 — ${changes.length}건.`);
  } else {
    console.log("\n걷어낼 것이 없습니다.");
  }
} finally {
  await sql.end();
}
