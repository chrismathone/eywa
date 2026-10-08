// Real PostgreSQL concurrency tests. Connects ONLY to a labeled, loopback-published fixture container.
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");
const assert = require("node:assert/strict");
const postgres = require("postgres");

async function main() {
  const name = "eywa-worker-lease-test-20261008";
  const [container] = JSON.parse(execFileSync("docker", ["inspect", name], { encoding: "utf8", windowsHide: true }));
  assert.equal(container.Config.Labels["eywa.test"], "worker-lease");
  assert.equal(container.Config.Image, "postgres:17-alpine");
  const bindings = container.NetworkSettings.Ports["5432/tcp"];
  assert.equal(bindings.length, 1);
  assert.equal(bindings[0].HostIp, "127.0.0.1");
  const port = Number(bindings[0].HostPort);
  assert.ok(Number.isInteger(port) && port > 0 && port <= 65535);
  const options = { host: "127.0.0.1", port, username: "postgres", password: "local-fixture-only", ssl: false, prepare: false, connect_timeout: 10 };
  const admin = postgres({ ...options, database: "postgres", max: 1 });
  const database = `eywa_worker_test_${randomUUID().replaceAll("-", "")}`;
  let sql;
  const checks = [];
  const check = async (name, fn) => { console.error(`Checking: ${name}`); await fn(); checks.push({ name, passed: true }); };
  try {
    console.error("Creating isolated fixture database");
    await admin`create database ${admin(database)}`;
    sql = postgres({ ...options, database, max: 32 });
    await sql.unsafe("create table public.tenants(id uuid primary key)");
    for (const role of ["anon", "authenticated", "service_role"]) {
      if (!(await admin`select 1 from pg_roles where rolname=${role}`).length) await admin`create role ${admin(role)}`;
    }
    await sql.unsafe(fs.readFileSync(path.join(__dirname, "../../supabase/migrations/20261008073000_worker_execution_leases.sql"), "utf8"));
    const tenant = randomUUID(), other = randomUUID();
    await sql`insert into public.tenants(id) values (${tenant}), (${other})`;
    const { workerLeaseApi } = await import(pathToFileURL(path.join(__dirname, "../_classnote/worker-execution-lease.mjs")));
    const ids = Array.from({ length: 64 }, () => randomUUID());
    const apis = ids.map((id) => workerLeaseApi(sql, tenant, id));
    let winner, generation;
    await check("64 concurrent claims produce one owner", async () => {
      const results = await Promise.all(apis.map((api) => api.claim()));
      assert.equal(results.filter((rows) => rows.length).length, 1);
      winner = results.findIndex((rows) => rows.length);
      generation = String(results[winner][0].generation);
      assert.equal(generation, "1");
    });
    await check("same instance retry preserves generation after response loss", async () => {
      assert.equal(String((await apis[winner].claim())[0].generation), generation);
    });
    await check("heartbeat/display hostname does not select the owner", async () => {
      const results = await Promise.all(apis.map((api) => api.claim()));
      assert.equal(results.filter((rows) => rows.length).length, 1);
      assert.equal(results.findIndex((rows) => rows.length), winner);
    });
    await check("wrong instance and generation cannot renew or release", async () => {
      const loser = apis[(winner + 1) % apis.length];
      assert.equal((await loser.renew(generation)).length, 0);
      assert.equal((await apis[winner].renew("999")).length, 0);
      assert.equal((await loser.release(generation))[0].release_worker_execution_lease, false);
    });
    await check("different tenant has an independent owner", async () => {
      const next = workerLeaseApi(sql, other, ids[winner]);
      assert.equal((await next.claim()).length, 1);
      assert.equal((await apis[winner].renew(generation)).length, 1);
    });
    await check("expired lease cannot renew", async () => {
      await sql`update public.worker_execution_leases set expires_at = clock_timestamp() - interval '1 second' where tenant_id=${tenant}`;
      assert.equal((await apis[winner].renew(generation)).length, 0);
    });
    const successor = (winner + 1) % apis.length;
    let nextGeneration;
    await check("takeover increases generation and fences old holder", async () => {
      const next = await apis[successor].claim(); nextGeneration = String(next[0].generation);
      assert.equal(BigInt(nextGeneration), BigInt(generation) + 1n);
      assert.equal((await apis[winner].renew(generation)).length, 0);
      assert.equal((await apis[winner].release(generation))[0].release_worker_execution_lease, false);
      assert.equal((await apis[winner].claim()).length, 0);
    });
    await check("explicit release allows one successor without deleting generation", async () => {
      assert.equal((await apis[successor].release(nextGeneration))[0].release_worker_execution_lease, true);
      const results = await Promise.all(apis.map((api) => api.claim()));
      const accepted = results.filter((rows) => rows.length);
      assert.equal(accepted.length, 1);
      assert.equal(BigInt(accepted[0][0].generation), BigInt(nextGeneration) + 1n);
    });
    for (const role of ["anon", "authenticated"]) {
      await check(`${role} cannot invoke lease functions or read lease rows`, async () => {
        await assert.rejects(sql.begin(async (tx) => {
          await tx`set local role ${tx(role)}`;
          await workerLeaseApi(tx, tenant, randomUUID()).claim();
        }), (error) => error.code === "42501");
        await assert.rejects(sql.begin(async (tx) => {
          await tx`set local role ${tx(role)}`;
          await tx`select * from public.worker_execution_leases`;
        }), (error) => error.code === "42501");
      });
    }
    await check("service role can access only the explicitly granted API", async () => {
      await sql.begin(async (tx) => {
        await tx`set local role service_role`;
        const result = await workerLeaseApi(tx, randomUUID(), randomUUID()).claim().catch((error) => error);
        assert.equal(result.code, "23503"); // function is permitted; nonexistent tenant is not
        throw Object.assign(new Error("rollback fixture"), { code: "TEST_ROLLBACK" });
      }).catch((error) => { assert.equal(error.code, "TEST_ROLLBACK"); });
    });
    await check("transaction rollback does not leave a phantom execution owner", async () => {
      const id = randomUUID(); await sql`insert into public.tenants values (${id})`;
      await sql.begin(async (tx) => {
        assert.equal((await workerLeaseApi(tx, id, randomUUID()).claim()).length, 1);
        throw new Error("rollback fixture");
      }).catch((error) => { assert.equal(error.message, "rollback fixture"); });
      assert.equal((await workerLeaseApi(sql, id, randomUUID()).claim()).length, 1);
    });
    console.log(JSON.stringify({ scope: "isolated local PostgreSQL 17 fixture; production DB unused", checks, passed: checks.length }, null, 2));
  } finally {
    if (sql) await sql.end({ timeout: 2 });
    await admin`drop database if exists ${admin(database)} with (force)`;
    await admin.end({ timeout: 2 });
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
