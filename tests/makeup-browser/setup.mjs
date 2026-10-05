/** Run only against the owned synthetic makeup_browser DB. Never loads dotenv. */
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import postgres from "postgres";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const db = postgres({ host: "127.0.0.1", port: 55444, database: "makeup_browser",
  username: "makeup_test", password: "makeup_local_only", max: 1, onnotice: () => {} });
const read = rel => readFile(path.join(root, rel), "utf8");
try {
  const [actual] = await db`select current_database() as name`;
  assert.equal(actual.name, "makeup_browser");
  await db.unsafe("drop schema if exists makeup_private cascade; drop schema if exists mt cascade; drop schema if exists auth cascade; drop schema public cascade; create schema public;");
  await db.unsafe(await read("tests/makeup-db/fixture.sql"));
  await db.unsafe(await read("supabase/migrations/0264a_makeup_reservations.sql"));
  const files = (await readdir(path.join(root, "supabase/migrations"))).filter(file => /^(?:034[3-9]|0350)[a-z]_makeup_.*\.sql$/.test(file)).sort();
  for (const file of files) await db.unsafe(await read(`supabase/migrations/${file}`));
  await db.unsafe(await read("tests/makeup-db/seed.sql"));
  await db.unsafe(await read("tests/makeup-browser/shell-fixture.sql"));
  await db`select mt.seed_on()`;
  await db.unsafe("notify pgrst, 'reload schema';");
  console.log(`PASS synthetic browser fixture (${files.length} migrations)`);
} finally { await db.end(); }
