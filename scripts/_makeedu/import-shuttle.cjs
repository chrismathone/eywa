/**
 * scripts/_makeedu/import-shuttle.cjs — makeedu 노랑버스 → eywa 셔틀(0225a) 이관.
 *
 * 원장 2026-08-19 지시로 makeedu 셔틀을 eywa로 가져온다. 범위는 **현재 편성 + 정류장 통합**
 * (과거 탑승 이력은 안 가져온다 — 원장 선택).
 *
 * 🔑 이 스크립트의 진짜 일은 복사가 아니라 **정류장 통합**이다. makeedu는 행선지가 노선마다 자유
 *    텍스트라 실측 38개 문자열이 실제로는 22~26곳이었다("서대구 센트럴 자이 112동상가" 5벌 등).
 *    STOP_ALIASES가 그 통합표이고, 여기 없는 이름은 **그대로 새 정류장**이 된다(임의 추측 금지).
 *
 * 🔴 기본은 **드라이런**(아무것도 안 쓴다). 실제 반영은 `--apply`.
 *    (원장 2026-08-05: *"드라이런 안해도 되나?"* → 진짜 오류 2건을 그때 잡았다.)
 * 멱등: 같은 이름의 정류장·차량·회차가 있으면 다시 만들지 않고 재사용한다. 여러 번 돌려도 안전.
 *
 * 사용:
 *   node --env-file=.env.local scripts/_makeedu/import-shuttle.cjs --from=<bus.json>          # 드라이런
 *   node --env-file=.env.local scripts/_makeedu/import-shuttle.cjs --from=<bus.json> --apply  # 반영
 *
 * 입력 JSON 모양(makeedu 차량관리 엑셀 내보내기 `/bus/busRegist_excel.do`를 파싱한 것):
 *   [{ bus: "1호차", stops: [{ no, name: "3 힐스테이트…", time: "15:57", inn: ["김나연A(월수목)"], out: [] }] }]
 *   · name 앞 숫자 = 회차번호, "-------" 행 = 회차 구분선, "학원 출발/도착" = 양 끝
 *   · 이름 뒤 괄호 = **요일**(학년이 아니다 — 화면 조회는 학년이지만 엑셀은 요일이다)
 *   · 차량 이름에 "_방학중"이 붙은 것 = 시즌(별도 차량이 아니라 season='vacation'으로 들어간다)
 */
const fs = require("fs");
const path = require("path");
const postgres = require("postgres");
const L = require("./lib.cjs");

const APPLY = process.argv.includes("--apply");
const FROM = (process.argv.find((a) => a.startsWith("--from=")) || "").slice("--from=".length);
const TENANT_SLUG = process.env.EYWA_TENANT_SLUG || "injaewon";

/**
 * 정류장 통합표 — 왼쪽(makeedu 표기)을 오른쪽(대표 이름)으로 합친다.
 *
 * ⚠️ **확실한 것만** 넣었다. 물리적으로 다를 수 있는 쌍은 일부러 뺐다(합치는 건 되돌리기 어렵다):
 *    · "힐스테이트 대구역 앞" ↔ "힐스테이트 대구역 오페라 동상 앞" — '오페라 동상'이 다른 지점일 수 있음
 *    · "서희스타힐스 앞(cu건너)" ↔ "서희스타힐스앞(칠성고맞은편)" — **반대편 정류장일 가능성**
 *    · "북구청" ↔ "북구청역 에듀포레(미크로앞)"
 *    합쳐야 한다고 확인되면 화면(정류장 관리)에서 이름을 맞추거나 여기에 줄을 더한다.
 */
const STOP_ALIASES = {
  // 침산오페라 코오롱하늘채 빽다방
  "칠성 오페라 코오롱 하늘채 빽다방 앞": "침산오페라 코오롱하늘채 빽다방 앞",
  빽다방: "침산오페라 코오롱하늘채 빽다방 앞",
  // 서대구 센트럴자이 112동 상가
  "서대구 센트럴 자이 112동 상가": "서대구 센트럴자이 112동 상가",
  "서대구 센트럴 자이 112동상가": "서대구 센트럴자이 112동 상가",
  "서대구 센트럴자이 112동상가": "서대구 센트럴자이 112동 상가",
  "서대구 센트럴 자이": "서대구 센트럴자이 112동 상가",
  // 오페라W 태양부동산 앞
  "오페라 W 태양부동산 앞": "오페라W 태양부동산 앞",
  "오페라W 태양부동산": "오페라W 태양부동산 앞",
  "오페라w 태양부동산": "오페라W 태양부동산 앞",
  "오페라 스위첸": "오페라W 태양부동산 앞",
  // 대구오페라 스위첸아파트 봄날부동산 앞
  "대구오페라 스위첸 봄날부동산 앞": "대구오페라 스위첸아파트 봄날부동산 앞",
  // (달성초 입구) 유진식당 앞
  "(달성초입구) 유진식당 앞": "(달성초 입구) 유진식당 앞",
  "(달성초에서100m) 유진식당 앞": "(달성초 입구) 유진식당 앞",
  // 대구역한라하우젠트센텀 CU앞 (공백만 차이)
  "대구역한라하우젠트센텀CU앞": "대구역한라하우젠트센텀 CU앞",
  // 달성파크 푸르지오 힐스테이트 203동 앞
  "달성파크 푸르지오": "달성파크 푸르지오 힐스테이트 203동 앞",
};

const DAY_BY_KO = { 월: "mon", 화: "tue", 수: "wed", 목: "thu", 금: "fri", 토: "sat", 일: "sun" };
const DAY_ORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

const isSeparator = (name) => /^-+$/.test(String(name || "").replace(/\s/g, ""));
const isCampus = (bare) => /^학원\s*(출발|도착)$/.test(String(bare || "").replace(/\s+/g, " ").trim());

/** "김나연A(월수목)" → { name: "김나연A", weekdays: ["mon","wed","thu"] } */
function parseRider(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;
  const m = s.match(/^(.*?)\s*\(([^)]*)\)\s*$/);
  const name = (m ? m[1] : s).trim();
  if (!name) return null;
  const days = [];
  if (m) {
    for (const ch of m[2]) if (DAY_BY_KO[ch] && !days.includes(DAY_BY_KO[ch])) days.push(DAY_BY_KO[ch]);
  }
  // 요일 표기가 없으면 평일로 본다(makeedu 실측상 요일 없는 항목은 없지만, 있으면 안전한 기본값).
  const weekdays = days.length ? DAY_ORDER.filter((d) => days.includes(d)) : ["mon", "tue", "wed", "thu", "fri"];
  return { name, weekdays };
}

/** 차량 이름에서 시즌을 뽑는다. "1호_방학중" → { vehicle: "1호차", season: "vacation" } */
function parseVehicle(busName) {
  const raw = String(busName || "").trim();
  const vacation = /방학/.test(raw);
  let vehicle = raw.replace(/[_\s]*방학중?/g, "").trim();
  // "1호" → "1호차"(학기중 차량 이름과 맞춰야 같은 차량으로 합쳐진다)
  if (/^\d+호$/.test(vehicle)) vehicle += "차";
  return { vehicle: vehicle || raw, season: vacation ? "vacation" : "term" };
}

/** makeedu JSON → { vehicles: Map<name, {season → runs}> } 중간 표현. */
function buildPlan(input) {
  const stopNames = new Set();
  const vehicles = new Map(); // name → { seasons: Map<season, Map<runNo, run>> }

  for (const bus of input) {
    const { vehicle, season } = parseVehicle(bus.bus);
    if (!vehicles.has(vehicle)) vehicles.set(vehicle, new Map());
    const seasons = vehicles.get(vehicle);
    if (!seasons.has(season)) seasons.set(season, new Map());
    const runs = seasons.get(season);

    for (const row of bus.stops || []) {
      if (isSeparator(row.name)) continue;
      const m = String(row.name || "").match(/^(\d+)\s+(.*)$/);
      if (!m) continue;
      const runNo = Number(m[1]);
      const bare = m[2].replace(/\s+/g, " ").trim();
      if (!runs.has(runNo)) runs.set(runNo, { runNo, stops: [], inn: 0, out: 0 });
      const run = runs.get(runNo);

      const riders = [];
      for (const raw of row.inn || []) {
        const r = parseRider(raw);
        if (r) riders.push({ ...r, ioKind: "in" });
      }
      for (const raw of row.out || []) {
        const r = parseRider(raw);
        if (r) riders.push({ ...r, ioKind: "out" });
      }
      run.inn += riders.filter((r) => r.ioKind === "in").length;
      run.out += riders.filter((r) => r.ioKind === "out").length;

      let kind = "stop";
      let stopName = null;
      if (isCampus(bare)) kind = /출발/.test(bare) ? "depart" : "arrive";
      else {
        stopName = STOP_ALIASES[bare] || bare;
        stopNames.add(stopName);
      }
      run.stops.push({ kind, stopName, atTime: row.time || null, riders });
    }
  }

  // 회차 성격(등원/하원) = 그 회차에서 승차가 더 많으면 등원.
  for (const seasons of vehicles.values())
    for (const runs of seasons.values())
      for (const run of runs.values()) run.direction = run.inn >= run.out ? "in" : "out";

  return { vehicles, stopNames: [...stopNames].sort() };
}

async function main() {
  if (!FROM) throw new Error("--from=<makeedu 버스 JSON 경로>가 필요합니다.");
  const abs = path.resolve(FROM);
  if (!fs.existsSync(abs)) throw new Error(`입력 파일이 없습니다: ${abs}`);
  const input = JSON.parse(fs.readFileSync(abs, "utf8"));
  if (!Array.isArray(input)) throw new Error("입력 JSON은 배열이어야 합니다(차량별 { bus, stops }).");

  const plan = buildPlan(input);

  console.log(`\n=== 이관 계획 (${APPLY ? "실제 반영" : "드라이런 — 아무것도 안 씀"}) ===`);
  console.log(`정류장 마스터: ${plan.stopNames.length}곳`);
  let totalRuns = 0;
  let totalRiders = 0;
  for (const [vehicle, seasons] of plan.vehicles) {
    for (const [season, runs] of seasons) {
      totalRuns += runs.size;
      const riders = [...runs.values()].reduce(
        (n, r) => n + r.stops.reduce((m, s) => m + s.riders.length, 0),
        0,
      );
      totalRiders += riders;
      console.log(`  ${vehicle} · ${season === "term" ? "학기중" : "방학중"} — 회차 ${runs.size} · 배정 ${riders}`);
    }
  }
  console.log(`합계: 차량 ${plan.vehicles.size} · 회차 ${totalRuns} · 배정 ${totalRiders}`);

  const sql = postgres(process.env.DATABASE_URL, { ssl: "require", max: 3 });
  try {
    const [tenant] = await sql`select id from tenants where slug = ${TENANT_SLUG}`;
    if (!tenant) throw new Error(`테넌트를 찾지 못했습니다: ${TENANT_SLUG}`);
    const tenantId = tenant.id;

    // ── 학생 매칭 검증 (드라이런에서도 항상 돈다) ──────────────────────────────
    const students = await sql`
      select id, name, name_normalized, status from students where tenant_id = ${tenantId}
    `;
    const byNorm = new Map();
    for (const r of students) {
      const k = r.name_normalized || L.normalizeName(r.name);
      if (!byNorm.has(k)) byNorm.set(k, []);
      byNorm.get(k).push(r);
    }

    const wanted = new Set();
    for (const seasons of plan.vehicles.values())
      for (const runs of seasons.values())
        for (const run of runs.values())
          for (const s of run.stops) for (const r of s.riders) wanted.add(r.name);

    const miss = [];
    const ambiguous = [];
    const studentIdByName = new Map();
    for (const name of wanted) {
      const hits = byNorm.get(L.normalizeName(name));
      if (!hits || hits.length === 0) {
        miss.push(name);
        continue;
      }
      // 🔴 동명이인은 **자동으로 고르지 않는다** — 엉뚱한 아이를 셔틀에 태우는 것보다 빠지는 게 낫다.
      //    재원생이 정확히 하나면 그것으로 확정, 아니면 사람이 화면에서 배정한다.
      const enrolled = hits.filter((h) => h.status === "enrolled");
      if (hits.length > 1 && enrolled.length !== 1) {
        ambiguous.push(`${name} (후보 ${hits.length})`);
        continue;
      }
      studentIdByName.set(name, (enrolled[0] || hits[0]).id);
    }

    console.log(`\n학생 매칭: ${studentIdByName.size}/${wanted.size}`);
    if (miss.length) console.log(`  ⚠️ 미매칭 ${miss.length}: ${miss.join(", ")}`);
    if (ambiguous.length) console.log(`  ⚠️ 동명이인 보류 ${ambiguous.length}: ${ambiguous.join(", ")}`);

    if (!APPLY) {
      console.log("\n드라이런 종료 — 반영하려면 --apply를 붙이세요.\n");
      return;
    }

    // ── 정류장 마스터 (멱등 upsert) ────────────────────────────────────────────
    const stopIdByName = new Map();
    for (const name of plan.stopNames) {
      const [row] = await sql`
        insert into shuttle_stops (tenant_id, name)
        values (${tenantId}, ${name})
        on conflict do nothing
        returning id
      `;
      if (row) stopIdByName.set(name, row.id);
      else {
        const [ex] = await sql`
          select id from shuttle_stops
          where tenant_id = ${tenantId} and btrim(name) = btrim(${name}) and not archived
        `;
        if (ex) stopIdByName.set(name, ex.id);
      }
    }
    console.log(`정류장 확보: ${stopIdByName.size}/${plan.stopNames.length}`);

    // ── 차량 → 회차 → 노선 → 배정 ─────────────────────────────────────────────
    let madeRuns = 0;
    let madeRiders = 0;
    for (const [vehicleName, seasons] of plan.vehicles) {
      let [vehicle] = await sql`
        select id from shuttle_vehicles where tenant_id = ${tenantId} and name = ${vehicleName}
      `;
      if (!vehicle) {
        [vehicle] = await sql`
          insert into shuttle_vehicles (tenant_id, name) values (${tenantId}, ${vehicleName}) returning id
        `;
      }

      for (const [season, runs] of seasons) {
        for (const run of [...runs.values()].sort((a, b) => a.runNo - b.runNo)) {
          const [existing] = await sql`
            select id from shuttle_runs
            where vehicle_id = ${vehicle.id} and season = ${season} and run_no = ${run.runNo}
          `;
          // 🔑 이미 있는 회차는 **건드리지 않는다** — 사람이 화면에서 고친 편성을 스크립트가 덮으면
          //    "고쳤는데 원복됐다"가 된다(멱등의 의미: 다시 만들지 않는다, 다시 쓰지 않는다).
          if (existing) continue;

          const [created] = await sql`
            insert into shuttle_runs (tenant_id, vehicle_id, season, run_no, direction)
            values (${tenantId}, ${vehicle.id}, ${season}, ${run.runNo}, ${run.direction})
            returning id
          `;
          madeRuns += 1;

          let order = 0;
          for (const s of run.stops) {
            const stopId = s.kind === "stop" ? stopIdByName.get(s.stopName) : null;
            if (s.kind === "stop" && !stopId) continue; // 정류장을 못 만든 경우는 조용히 건너뛰지 않고 아래에서 보고
            // 같은 회차에 같은 정류장이 두 번 오면(실측 0건이지만) 스크립트가 중간에 죽지 않게 넘어간다 —
            // 절반만 들어간 편성이 남는 것이 최악이다.
            const [rs] = await sql`
              insert into shuttle_run_stops (tenant_id, run_id, kind, stop_id, sort_order, at_time)
              values (${tenantId}, ${created.id}, ${s.kind}, ${stopId}, ${order}, ${s.atTime})
              on conflict do nothing
              returning id
            `;
            if (!rs) {
              console.log(`  ⚠️ 같은 회차에 중복 정류장 — 건너뜀: ${vehicleName} ${season} ${run.runNo}회차 "${s.stopName}"`);
              continue;
            }
            order += 1;

            for (const rider of s.riders) {
              const studentId = studentIdByName.get(rider.name);
              if (!studentId) continue; // 미매칭·동명이인은 사람이 화면에서 붙인다
              await sql`
                insert into shuttle_riders (tenant_id, run_stop_id, student_id, io_kind, weekdays)
                values (${tenantId}, ${rs.id}, ${studentId}, ${rider.ioKind}, ${sql.array(rider.weekdays)}::text[]::day_of_week[])
                on conflict (run_stop_id, student_id, io_kind) do update set weekdays = excluded.weekdays
              `;
              madeRiders += 1;
            }
          }
        }
      }
    }

    console.log(`\n반영 완료 — 새 회차 ${madeRuns} · 배정 ${madeRiders}`);
    if (miss.length || ambiguous.length) {
      console.log("⚠️ 미매칭·동명이인은 배정되지 않았습니다 — 셔틀 화면에서 드래그로 붙이세요.");
    }
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error("실패:", e.message);
  process.exit(1);
});
