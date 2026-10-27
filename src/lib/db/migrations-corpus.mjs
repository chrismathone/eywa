/**
 * **SQL 전체(시즌1 합본 + 시즌2)** — 원장 2026-10-27 *"이전 001~458번대까지 sql을 전부 하나로 정리해서 뭉쳐놔"* · *"시즌2 sql 느낌으로 시작해 새로"*.
 *
 * 시즌1(drizzle 0000~0027 + alpha 0001a~0458a, 낱개 568개)은 `supabase/migrations/s1_season1.sql` 하나로 합쳤다 — 구역마다 머리줄
 * `--@@s1 <원래 파일 이름>`, 새 DB에 적용하던 순서 그대로. 시즌2는 `supabase/migrations/s2_NNNN_설명.sql` 낱개.
 * 테스트·스크립트는 원래 파일 이름으로 읽는다(`readMigration("0349a_….sql")`) — 시즌1이면 합본의 그 구역, 시즌2면 그 파일.
 * `migrationFiles()` = 적용 순서 전체(시즌1 구역들 → 시즌2 이름순) — "마지막 정의"를 찾는 가드가 낱개 시절의 `readdirSync().sort()` 대신 쓴다.
 *
 * 🔴 순수 node(fs·path)만 — vitest(TS)와 node 스크립트(.mjs · require(esm))가 같은 파일을 쓴다. 서버 코드에서 부르지 않는다.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 저장소 뿌리 — 이 파일 자리에서 찾는다(스크립트를 어느 폴더에서 돌려도 같다 · 워크트리마다 자기 뿌리).
 * vitest의 happy-dom 환경은 `import.meta.url`이 file 주소가 아니다 — 그때는 작업 폴더(= 저장소 뿌리에서 돌린다).
 */
export const REPO_ROOT = (() => {
  try {
    const url = new URL("../../../", import.meta.url);
    if (url.protocol === "file:") return fileURLToPath(url);
  } catch {
    // 아래로
  }
  return process.cwd();
})();
export const MIGRATIONS_DIR = "supabase/migrations";
export const SEASON1_FILE = "s1_season1.sql";
/** 시즌2 파일 이름 규칙 — `s2_0001_설명.sql`(네 자리 번호 · 소문자·숫자·밑줄). */
export const SEASON2_NAME = /^s2_(\d{4})_[a-z0-9_]+\.sql$/;
const MARK = /^--@@s1 (\S+)\r?$/gm;

/** @type {Map<string, { name: string; sql: string }[]>} */
const cache = new Map();

/**
 * 시즌1 합본의 구역들(적용 순서).
 * @param {string} [root] 저장소 뿌리(기본 = REPO_ROOT)
 * @returns {{ name: string; sql: string }[]}
 */
export function season1Sections(root = REPO_ROOT) {
  const key = `s1|${root}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const text = readFileSync(join(root, MIGRATIONS_DIR, SEASON1_FILE), "utf8");
  const heads = [...text.matchAll(MARK)];
  const out = heads.map((m, i) => {
    const start = /** @type {number} */ (m.index) + m[0].length + 1;
    const end = i + 1 < heads.length ? /** @type {number} */ (heads[i + 1].index) : text.length;
    return { name: m[1], sql: text.slice(start, end) };
  });
  cache.set(key, out);
  return out;
}

/**
 * 시즌2 낱개 파일 이름(이름순 = 적용 순서).
 * @param {string} [root]
 * @returns {string[]}
 */
export function season2Names(root = REPO_ROOT) {
  const dir = join(root, MIGRATIONS_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => SEASON2_NAME.test(f)).sort();
}

/**
 * 폴더에 있는 **규칙 밖 `.sql`**(옛 `NNNNa_` · CLI 타임스탬프 · 그 밖) — 합본 · 시즌2 이름이 아닌 것.
 * @param {string} [root]
 * @returns {string[]}
 */
export function offConventionSql(root = REPO_ROOT) {
  const dir = join(root, MIGRATIONS_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(".sql") && f !== SEASON1_FILE && !SEASON2_NAME.test(f)).sort();
}

/**
 * 적용 순서 전체 — 시즌1 구역들 → 시즌2 파일들.
 * 🔴 폴더에 규칙 밖 `.sql`이 있으면 **던진다** — 조용히 빼면 `db:alphas`는 그 파일 없이 새 DB를 세우고 "마지막 정의" 가드들은 그 파일을
 *    못 본 채 통과한다(적대 리뷰 2026-10-27). 다른 브랜치가 옛 이름(`0459a_…`)으로 넣었으면 다음 빈 `s2_NNNN`으로 바꾼다.
 * @param {string} [root]
 * @returns {{ name: string; sql: string }[]}
 */
export function migrationFiles(root = REPO_ROOT) {
  const off = offConventionSql(root);
  if (off.length) {
    throw new Error(`규칙 밖 SQL 파일이 있습니다: ${off.join(", ")} — 새 SQL은 s2_NNNN_설명.sql(다음 빈 번호)로 바꿔 주세요(시즌1은 s1_season1.sql 합본 · 고치지 않음 · 방법은 docs/sql-season2.md)`);
  }
  return [
    ...season1Sections(root),
    ...season2Names(root).map((name) => ({ name, sql: readFileSync(join(root, MIGRATIONS_DIR, name), "utf8") })),
  ];
}

/**
 * 원래 파일 이름으로 SQL 한 벌(시즌1 = 합본의 그 구역 · 시즌2 = 그 파일). 없으면 던진다(이름 오타를 조용히 넘기지 않게).
 * @param {string} name 예: "0349a_makeup_legacy_guards.sql" · "s2_0001_x.sql"
 * @param {string} [root]
 * @returns {string}
 */
export function readMigration(name, root = REPO_ROOT) {
  if (SEASON2_NAME.test(name)) return readFileSync(join(root, MIGRATIONS_DIR, name), "utf8");
  const found = season1Sections(root).find((s) => s.name === name);
  if (!found) throw new Error(`SQL을 찾지 못했습니다: ${name}(시즌1 합본 구역 · 시즌2 파일 어디에도 없음)`);
  return found.sql;
}

/**
 * 그 이름의 SQL이 있나(시즌1 구역 · 시즌2 파일).
 * @param {string} name
 * @param {string} [root]
 */
export function hasMigration(name, root = REPO_ROOT) {
  if (SEASON2_NAME.test(name)) return existsSync(join(root, MIGRATIONS_DIR, name));
  return season1Sections(root).some((s) => s.name === name);
}
