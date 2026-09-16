/**
 * scripts/_makeedu/mirror-textbook-checks.cjs — makeedu 수납 → 교재 신청(textbook_orders) 자동 체크.
 * ijw functions/index.js `mirrorTextbookRequestsFromBilling` 이식 + 사용자 확정 기준(2026-07-06):
 *
 * 기준(2단계):
 * - **등록** = makeedu 수납에 그 교재의 수납명 라인이 **생성됨**(미납이어도 체크).
 * - **납부** = 그 수납 라인이 **납부 처리 완료**(라인 미납금액=0 — 완납 or 할인/적립 전액 충당).
 * - 입력자(마지막 변경자) = **"자동화"**.
 *
 * 데이터 소스 = **스크랩 원본**($MAKEEDU_OUT/invoices.json, 라인 단위) — eywa invoices 테이블이 아님.
 * (테이블은 (학생,청구월) additive라 이미 임포트된 달에 나중에 추가된 교재비 라인이 안 들어옴 +
 *  라인별 납부상태가 집계에서 소실됨.)
 * ⚠️ 스크랩 = makeedu 수납 목록 **기본 뷰(현재 청구월 슬라이스)** 스냅샷 — 당월 라인의 생성·완납은
 *    실시간 반영되나, **월이 넘어간 뒤 완납된 전월 라인은 관측 불가 → 그 건의 납부 체크는 자동 미탐**
 *    (수동 토글 필요, 실행 로그에 관측 청구월·창 밖 건수를 경고). 근본 해결 = scrape 청구월 폼 다개월 순회(백로그).
 * ⚠️ makeedu '수납여부' 컬럼은 드롭다운 DOM 텍스트라 신뢰 불가(미납인데 "완납"으로 찍힘) —
 *    납부 판정은 금액으로: 미납<=0 && (실납>0 || (청구액>0 && 할인+적립>=청구액)). 0원 placeholder 라인은 미완납 취급.
 *
 * 매칭(오탐 = 최악 결함 — 적대 리뷰 2026-07-06 확정 15건 반영):
 * - **'구분'=교재 라인만**(fail-closed): 수강료 라인('[EiE] PHONICS&ROOKIES 40,000', 구분=수업)이 교재
 *   '[EiE] PHONICS'와 부분일치하는 실충돌 확인 → 구분 미필터면 수강료 완납이 교재 납부로 오체크(금전 손실).
 * - **필수 헤더 전수 검증**: makeedu가 금액 컬럼명만 바꿔도 미납=0 오판 → 전건 완납 오탐 → 헤더 누락 시 throw(도메인 실패 격리).
 * - 학생 = 라인(이름·학년) → students tieredMatcher(모호=null=스킵) → 신청서 student_id와 대조.
 *   **동명(정규화 이름 비유일) 학생 라인은 스킵** — 학년 드리프트(연례 진급) 시 인접학년 동명이인 오귀속 차단.
 * - 교재명 = 양방향 부분 일치(공백 제거·소문자), 양쪽 정규화 길이 <3 스킵(일반어 오탐 방지).
 * - **기간 창**: 라인 청구월 ∈ [신청월, 신청월+1] — 옛 완납 라인/미래 재신청 라인의 교차 크레딧 차단.
 * - **소비 유니버스 = 전 신청(체크 완료 포함, 신청일 asc)**: 이미 체크된 신청이 자기 라인을 먼저
 *   소비(consumedBy)해 같은 교재 재신청이 남의 라인을 선취하는 오탐 차단. 라인 1개 = 신청 1건.
 *
 * 정책(ijw 계승):
 * - **ON만 자동, OFF(해제) 절대 안 함** — ijw에서 '매칭 실패=환불' 미러링이 수동 처리 건을 동기화마다
 *   롤백하던 버그 전력. 환불/취소는 수동 토글.
 * - **수동 해제 신청은 영구 제외**(`check_dismissed_at`, 0079a — toggleTextbookCheck가 등록/납부 해제 시 기록):
 *   해제 → 재체크 → 재해제 핑퐁(위 버그의 역방향) 방지. 해제 건도 라인은 소비(다른 신청 오크레딧 차단).
 * - **ordered_at(주문)은 수동 영역** — 안 건드림. status는 UPDATE 시점 SQL CASE로 파생(stale 스냅샷 레이스 회피).
 * - 멱등: 조치 = 등록/납부가 빈 신청만 + UPDATE는 계획-인지 WHERE 가드(수동 선체크 레이스 시 0행=건너뜀).
 *
 * 실행: node --env-file=.env.local scripts/_makeedu/mirror-textbook-checks.cjs [--apply] [--from=YYYY-MM]
 * (dry-run 기본 = DB write 0. --from 기본 = 3개월 전(조치 대상 신청일 창 — 매칭·소비는 전 신청).
 *  sync-all이 invoices 뒤 단계로 호출 — scrape 단계가 invoices.json을 먼저 갱신하므로 항상 신선.)
 */
const fs = require("fs");
const path = require("path");
const postgres = require("postgres");
const L = require("./lib.cjs");

const APPLY = process.argv.includes("--apply");
const OUT = process.env.MAKEEDU_OUT || path.resolve(__dirname, "..", "..", ".makeedu-tmp");
const fromArg = (process.argv.find((a) => a.startsWith("--from=")) || "").slice(7);

// KST 기준 N개월 전 'YYYY-MM'(조치 대상 신청일 창 기본값).
function defaultFromYm(monthsBack = 3) {
  const kst = new Date(Date.now() + 9 * 3600_000);
  const d = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth() - monthsBack, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
const FROM_YM = /^\d{4}-\d{2}$/.test(fromArg) ? fromArg : defaultFromYm();

const norm = (s) => String(s || "").replace(/\s+/g, "").toLowerCase();
const ym = (v) => { const s = L.txt(v) || ""; const m = s.match(/(\d{4})[.\-/]?(\d{2})/); return m ? `${m[1]}-${m[2]}` : null; };
const mn = (p) => { const [y, m] = String(p).split("-").map(Number); return y * 12 + m; }; // 'YYYY-MM' → 월 인덱스
const LAG_MONTHS = 1; // 청구는 신청월 당월~익월이 정상 — 그 밖 라인은 남의 것(교차 크레딧 차단)

(async () => {
  // 1) 스크랩 원본 라인 파싱(import-invoices와 동일 컬럼 규약) — 필수 헤더 전수 검증(fail-closed).
  const jsonPath = path.join(OUT, "invoices.json");
  if (!fs.existsSync(jsonPath)) throw new Error(`invoices.json 없음: ${jsonPath} — scrape 먼저(또는 sync-all 경유)`);
  const data = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  if (data.error) throw new Error(`수납 수집 실패 — ${String(data.error).slice(0, 500)}. 교재 자동 체크를 중단합니다.`);
  const H = (s) => data.headers.findIndex((h) => (h || "").includes(s));
  const REQUIRED = ["이름", "학년", "청구월", "구분", "수납명", "청구액", "할인액", "적립금", "실제낸금액", "미납"];
  const missingH = REQUIRED.filter((h) => H(h) < 0);
  if (missingH.length)
    throw new Error(
      `invoices.json 필수 헤더 누락/변경: [${missingH.join(", ")}] — makeedu 컬럼 리네임 의심. ` +
        `금액 컬럼 소실 시 미납 라인이 완납으로 오판되므로 자동 체크를 중단합니다(sync-all이 도메인 에러로 격리).`,
    );
  const ci = { name: H("이름"), grade: H("학년"), month: H("청구월"), gubun: H("구분"), item: H("수납명"),
    total: H("청구액"), disc: H("할인액"), point: H("적립금"), paid: H("실제낸금액"), unpaid: H("미납") };
  const lines = [];
  for (const r of data.rows) {
    // 구분=교재 라인만 — 수강료/차량비 라인이 교재 등록·납부로 오체크되는 것 차단
    // (실충돌: 수강료 "[EiE] PHONICS&ROOKIES 40,000" ⊃ 교재 "[EiE] PHONICS").
    if (L.txt(r[ci.gubun]) !== "교재") continue;
    const name = L.txt(r[ci.name]); const period = ym(r[ci.month]);
    if (!name || !period) continue;
    const total = L.parseAmount(r[ci.total]); const disc = L.parseAmount(r[ci.disc]);
    const point = L.parseAmount(r[ci.point]); const paid = L.parseAmount(r[ci.paid]);
    const unpaid = L.parseAmount(r[ci.unpaid]);
    lines.push({
      name, grade: L.gradeNorm(r[ci.grade]), period,
      item: L.txt(r[ci.item]) || "", normItem: norm(L.txt(r[ci.item]) || ""),
      total,
      // 납부 판정(금액 기준 — '수납여부' 드롭다운 텍스트 불신): 미납 0 + (실납>0 또는 청구액>0의 할인·적립 전액 충당).
      // 청구액>0 조건 = 0원 placeholder·환불성 음수 라인이 실납 없이 '완납'으로 뒤집히는 엣지 차단.
      settled: unpaid <= 0 && (paid > 0 || (total > 0 && disc + point >= total)),
    });
  }
  const periods = [...new Set(lines.map((l) => l.period))].sort();
  const mtime = fs.statSync(jsonPath).mtime.toISOString();
  console.log(
    `[mirror-textbook-checks] 교재 라인 ${lines.length} (invoices.json ${mtime}) | 조치 창 ${FROM_YM}~ ${APPLY ? "(APPLY)" : "(DRY-RUN)"}`,
  );
  console.log(`관측 청구월: ${periods.join(", ") || "(없음)"} — 이 창 밖에서 완납된 라인의 납부는 자동 미탐(수동 체크)`);

  const sql = postgres(process.env.DATABASE_URL, { prepare: false });
  try {
    const tenantId = await L.resolveTenantId(sql);

    // 2) 라인 학생 해석(이름+학년 → student_id, 모호=null=스킵).
    //    동명(정규화 이름 비유일) 학생은 자동화 대상에서 제외 — 학년 드리프트(makeedu=최신 진급 vs eywa=구학년) 시
    //    티어1(이름|학년) 키가 인접학년 동명이인에게 '유일' 적중해 남의 학생으로 오귀속될 수 있음(오탐>미탐 우선).
    const studs = await sql`select id, name, grade from students where tenant_id = ${tenantId}`;
    const dupNames = new Set();
    {
      const seen = new Set();
      for (const s of studs) {
        const k = L.normalizeName(s.name);
        if (seen.has(k)) dupNames.add(k); else seen.add(k);
      }
    }
    const matchStudent = L.tieredMatcher(studs, [
      (s) => `${L.normalizeName(s.name)}|${s.grade || ""}`,
      (s) => L.normalizeName(s.name),
    ]);
    const linesByStudent = new Map();
    let unresolved = 0, dupSkipped = 0;
    for (const l of lines) {
      if (dupNames.has(L.normalizeName(l.name))) { dupSkipped++; continue; }
      const sid = matchStudent({ name: l.name, grade: l.grade });
      if (!sid) { unresolved++; continue; }
      (linesByStudent.get(sid) ?? linesByStudent.set(sid, []).get(sid)).push(l);
    }

    // 3) 매칭 유니버스 = 전 신청(체크 완료·해제·창 밖 포함, 신청일 asc) — 자기 라인을 먼저 소비시켜
    //    같은 교재 재신청이 남의 라인을 선취하는 오탐을 차단. 조치(plans)는 아래 게이트로만.
    // ⚠️ request_date는 to_char로 'YYYY-MM-DD' 문자열 고정 — postgres-js가 date를 Date 객체로 돌려주면
    //    String()이 "Tue Jun 30 …"이 돼 slice(0,7) 월 파싱·창 비교가 조용히 전부 깨진다(실측).
    const orders = await sql`
      select id, student_id, student_name, book_name, price,
             to_char(request_date, 'YYYY-MM-DD') as request_date,
             registered_at, ordered_at, paid_at, check_dismissed_at
      from textbook_orders
      where tenant_id = ${tenantId} and student_id is not null
      order by request_date, created_at`;
    const fromDate = FROM_YM + "-01";
    const actionable = orders.filter(
      (o) => String(o.request_date) >= fromDate && !o.check_dismissed_at && (!o.registered_at || !o.paid_at),
    );
    console.log(`신청 유니버스 ${orders.length}건(소비용) / 조치 후보 ${actionable.length}건 | 라인 학생 미해석 ${unresolved}·동명 스킵 ${dupSkipped}`);

    // 관측 창 밖(전월 이전 청구가 정상인) 후보 — 스크랩이 당월 슬라이스라 영구 미탐 가능성 경고.
    const minPm = periods.length ? mn(periods[0]) : null;
    if (minPm != null) {
      const staleCnt = actionable.filter((o) => mn(String(o.request_date).slice(0, 7)) + LAG_MONTHS < minPm).length;
      if (staleCnt) console.log(`⚠️ 관측 청구월 이전 신청 ${staleCnt}건 — 그 청구·납부는 스크랩에 없어 자동 체크 불가(수동 확인).`);
    }

    // 4) 매칭 — 전 신청 순회(신청일 asc)로 라인 소비, 조치는 게이트 통과 건만.
    const plans = [];
    const noops = []; // 매칭은 됐지만 조치 없음(예: 등록은 수동 완료·라인은 아직 미납 → 납부 대기)
    let consumedByDone = 0; // 체크 완료/해제/창 밖 신청의 자기 라인 소비(정상 — 재신청 오크레딧 차단)
    for (const o of orders) {
      const nb = norm(o.book_name);
      if (nb.length < 3) continue; // 일반어·초단명 오탐 방지
      const rm = mn(String(o.request_date).slice(0, 7)); // 신청월 인덱스
      const cands = (linesByStudent.get(o.student_id) ?? []).filter(
        (l) =>
          !l.consumedBy &&
          l.normItem.length >= 3 && // 대칭 가드(일반어 라인이 교재명에 포함돼 오탐하는 것 방지)
          mn(l.period) >= rm && mn(l.period) - rm <= LAG_MONTHS && // 기간 창: 신청월~익월 청구만
          (l.normItem.includes(nb) || nb.includes(l.normItem)),
      );
      if (!cands.length) continue;
      // 청구월이 신청월에 가까운 라인 우선(동률 시 완납 우선) — 늦은 라인이 이른 신청에 선취되는 교차 오배정 방지.
      cands.sort((a, b) => (mn(a.period) - rm) - (mn(b.period) - rm) || (b.settled ? 1 : 0) - (a.settled ? 1 : 0));
      const pick = cands[0];
      pick.consumedBy = o.id; // 소비는 체크 완료·해제 신청 포함(자기 라인 선점)
      if (o.check_dismissed_at) { consumedByDone++; continue; } // 사람이 해제한 신청 = 사람 소유
      if (String(o.request_date) < fromDate) { consumedByDone++; continue; } // 조치 창 밖
      if (o.registered_at && o.paid_at) { consumedByDone++; continue; } // 이미 완전 체크
      const setRegistered = !o.registered_at;
      const setPaid = !o.paid_at && pick.settled;
      if (!setRegistered && !setPaid) {
        noops.push({ o, line: pick });
        continue;
      }
      plans.push({ o, line: pick, setRegistered, setPaid });
    }

    console.log(
      `\n체크 대상 ${plans.length}건 / 매칭-조치없음 ${noops.length}건 / 기존 체크·해제·창밖 소비 ${consumedByDone}건 / 미매칭 후보 ${actionable.length - plans.length - noops.length}건`,
    );
    for (const { o, line } of noops)
      console.log(
        `  · ${o.student_name} 「${o.book_name}」 매칭됨[${line.period} ${line.settled ? "완납" : "미납"}] "${line.item}" — 조치 없음(납부 대기 등)`,
      );
    for (const { o, line, setRegistered, setPaid } of plans) {
      const acts = [setRegistered ? "등록" : null, setPaid ? "납부" : null].filter(Boolean).join("·");
      console.log(
        `  ✓ ${String(o.student_name || "").padEnd(8)} 「${o.book_name}」 ← [${line.period}${line.settled ? " 완납" : " 미납"}] "${line.item}"` +
          ` (신청가 ${Number(o.price).toLocaleString()} / 청구 ${line.total.toLocaleString()}) → ${acts} 체크`,
      );
    }
    // 관측성(ijw unmatchedPaidSamples 계승): 조치 후보인데 매칭 안 된 표본 — 그 학생의 교재 라인 병기.
    const planned = new Set([...plans, ...noops].map((p) => p.o.id));
    for (const o of actionable.filter((o) => !planned.has(o.id)).slice(0, 10)) {
      const ls = (linesByStudent.get(o.student_id) ?? []).filter((l) => !l.consumedBy || l.consumedBy === o.id);
      if (ls.length)
        console.log(`  ? ${o.student_name} 「${o.book_name}」 미매칭 — 그 학생의 미소비 교재 라인: ${ls.map((l) => `"${l.item}"`).join(" / ")}`);
    }

    if (!APPLY) {
      console.log("\n[DRY-RUN] --apply 없이 종료 (DB write 0).");
      return;
    }

    // 5) 적용 — ON만(coalesce), 주문 불변, 입력자='자동화'.
    //    · WHERE = 계획-인지 가드: 계획된 쓰기가 전부 수동 선체크로 선점됐으면 0행(수동 입력자 기록 보존).
    //    · status = UPDATE 시점 SQL CASE 파생(조회 스냅샷이 아니라 쓰기 시점 행 값 — 동시 수동 토글과 원자 일치).
    //    · 실갱신(r.count)만 recordSync에 계상.
    let updated = 0;
    for (const { o, setRegistered, setPaid } of plans) {
      const guard =
        setRegistered && setPaid
          ? sql`(registered_at is null or paid_at is null)`
          : setRegistered
            ? sql`registered_at is null`
            : sql`paid_at is null`;
      const r = await sql`
        update textbook_orders set
          registered_at = ${setRegistered ? sql`coalesce(registered_at, now())` : sql`registered_at`},
          paid_at = ${setPaid ? sql`coalesce(paid_at, now())` : sql`paid_at`},
          status = ${setPaid
            ? sql`'paid'`
            : sql`case when paid_at is not null then 'paid'
                       when ordered_at is not null then 'ordered'
                       else 'requested' end`},
          status_by_name = ${"자동화"},
          status_at = now(),
          updated_at = now()
        where id = ${o.id} and tenant_id = ${tenantId}
          and check_dismissed_at is null
          and ${guard}`;
      if (r.count) updated++;
      else console.log(`  ~ ${o.student_name} 「${o.book_name}」 실행 중 수동 변경/해제/삭제됨 — 건너뜀`);
    }
    await L.recordSync(sql, tenantId, "textbook_checks", updated);
    console.log(`\n적용 완료: ${updated}건 (입력자='자동화').`);
  } finally {
    await sql.end();
  }
})().catch((e) => {
  console.error("ERR", e.message);
  process.exit(1);
});
