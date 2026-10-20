// In-memory PostgreSQL only. Never loads application env files or opens a network database.
import { createRequire } from "node:module";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(resolve(process.env.MANAGEMENT_TEST_RUNTIME || here, "package.json"));
const { PGlite } = require("@electric-sql/pglite");
const { pgtap } = require("@electric-sql/pglite-pgtap");
const pg = new PGlite({ extensions: { pgtap } });
let failed = false;
try {
  await pg.exec(await readFile(resolve(here, "fixture.sql"), "utf8"));
  const migrations = resolve(here, "../../supabase/migrations");
  for (const file of (await readdir(migrations)).filter((n) => /^0377[a-e]_management_agent_/.test(n)).sort())
    await pg.exec(await readFile(resolve(migrations, file), "utf8"));
  await pg.exec("create extension pgtap; select no_plan();");
  for (const file of (await readdir(here)).filter((n) => n.endsWith(".test.sql")).sort()) {
    const results = await pg.exec(await readFile(resolve(here,file), "utf8"));
    for (const result of results) for (const row of result.rows) for (const value of Object.values(row)) {
      if (typeof value === "string" && /^(not ok|ok |#)/.test(value)) {
        console.log(value);
        if (/^not ok/.test(value)) failed = true;
      }
    }
  }
  const end = await pg.query("select * from finish()");
  for (const row of end.rows) console.log(Object.values(row)[0]);
} catch (error) {
  failed = true;
  console.error({ message: error.message, code: error.code, detail: error.detail, where: error.where, internalQuery: error.internalQuery });
} finally { await pg.close(); }
if (failed) process.exitCode = 1;
