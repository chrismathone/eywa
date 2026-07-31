/**
 * scripts/_makeedu/lib.cjs — makeedu → eywa 동기화 공유 유틸 (CommonJS).
 * 임포터(import-*.cjs)와 향후 Phase 2 크롤러가 공유. 순수 변환 + 작은 DB 헬퍼.
 */

// makeedu 날짜: 'YYYYMMDD' / 'YYYY-MM-DD' / 'YYYY.MM.DD(요일)' / 'YYYY-MM-DD HH:MM:SS' → 'YYYY-MM-DD'
function parseDate(v) {
  const s = txt(v);
  if (!s) return null;
  const d = s.replace(/[^0-9]/g, "");
  if (d.length >= 8) return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
  return null;
}

// makeedu 날짜+시각 → ISO timestamp(있으면), 없으면 자정.
function parseTimestamp(v) {
  const s = txt(v);
  if (!s) return null;
  const dpart = parseDate(s);
  if (!dpart) return null;
  const tm = s.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  const hh = tm ? tm[1].padStart(2, "0") : "00";
  const mm = tm ? tm[2] : "00";
  const ss = tm && tm[3] ? tm[3] : "00";
  return `${dpart}T${hh}:${mm}:${ss}+09:00`; // KST
}

function txt(v) {
  if (v == null) return null;
  if (typeof v === "object") return (v.text || v.result || "").toString().trim() || null;
  const s = String(v).trim();
  return s || null;
}

function normPhone(v) {
  const s = txt(v);
  if (!s) return null;
  const d = s.replace(/[^0-9]/g, "");
  if (d.length === 11) return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  return s; // 형식 모르면 원문 보존
}

function gender(v) {
  const s = txt(v);
  if (s === "남") return "male";
  if (s === "여") return "female";
  return null;
}

// eywa name_normalized 생성 규칙(0001a): lower(regexp_replace(name,'\s+','','g'))
function normalizeName(v) {
  const s = txt(v);
  if (!s) return "";
  return s.replace(/\s+/g, "").toLowerCase();
}

// 숫자 추출(금액): "270,000" / "23,500원" → 270000
function parseAmount(v) {
  const s = txt(v);
  if (!s) return 0;
  const n = parseInt(s.replace(/[^0-9-]/g, ""), 10);
  return Number.isFinite(n) ? n : 0;
}

// makeedu 학년 → eywa gradeLevels(초1~고3 1:1 일치). 유치원 등 미대응은 원문 보존(필터에서만 누락).
function gradeNorm(v) {
  return txt(v);
}

// Phase 2 cron(목록 수준)이 추가한 예비상담은 상세 본문을 안 가져오므로, enrollment 상세가 비어 보이지 않게
// parent_request에 이 안내문구를 채운다. **sentinel** — 나중에 sync-prospects가 실제 본문이 오면 이 값을 덮어쓴다
// (coalesce(nullif(parent_request, PROSPECT_LIST_NOTE), 실본문, parent_request))로 오염을 막는다. 양쪽이 같은 상수를 써야 함.
const PROSPECT_LIST_NOTE =
  "ℹ️ makeedu 목록 동기화로 자동 등록된 예비상담입니다. 상세 상담 내용은 makeedu 예비원생관리에서 확인하세요.";

// makeedu 수업목록엔 진짜 수업이 아닌 과금/관리용 가짜 항목이 섞여 있다(교재 단가·시스템 사용료·행사·설명회·미납조회용).
// 이들은 반(classes)으로 임포트하면 안 됨. 이름에 아래 키워드가 있으면 비-수업으로 차단.
// ⚠️ 향후 학원설정(makeedu 연동)에서 차단 문구를 편집 가능하게 외부화 검토(현재 하드코딩 기본값).
const NONCLASS_RE = /교재|사용료|행사|설명회|미납조회/;
function isNonClass(name) {
  const s = txt(name) || "";
  return NONCLASS_RE.test(s);
}

// makeedu 수업명(+담임) → eywa operations.subjects 키.
// 인재원 subjects = math / subject_1(수학심화) / english / science / korean.
// makeedu 접두/토큰: [EiE]·중등E·고등E·초등E=영어 / [강아]·중등M·고등M·초등M·…반=수학(강의하는아이들) / [과학]=과학 / 국어=국어.
function subjectFromName(name, teacher) {
  const s = `${name || ""} ${teacher || ""}`;
  if (/과학|science/i.test(s)) return "science";
  if (/국어|korean/i.test(s)) return "korean";
  if (/\beie\b|\[eie\]|영어|english|등e[_\s]|초등e|중등e|고등e/i.test(s)) return "english";
  if (/수학\s*\(?\s*심화/i.test(s)) return "subject_1";
  // 나머지(강아·M계열·…반·수학)는 math 폴백
  return "math";
}

// makeedu 결제수단 → eywa payment_method(card/transfer/cash/other). 원문은 호출부가 별도 보존 가능.
function paymentMethod(v) {
  const s = txt(v) || "";
  if (/카드|card/i.test(s)) return "card";
  if (/온라인|계좌|이체|transfer/i.test(s)) return "transfer";
  if (/현금|cash/i.test(s)) return "cash";
  if (!s || s === "선택") return null;
  return "other"; // 카카오페이·지역화폐 등
}

// makeedu→ijw additive 매칭용 티어드 맵. ijwRows=[{id, ...}], keyFns=정밀→느슨 순 키 함수 배열.
// 한 티어에서 같은 키가 2건 이상이면 그 키는 모호(null)로 표시 → 그 티어는 매칭 실패 처리(오매칭 방지).
// match(rec): 가장 정밀한 티어부터 유일 일치를 찾으면 그 id, 끝까지 없으면 null(=신규로 추가).
function tieredMatcher(ijwRows, keyFns) {
  const maps = keyFns.map(() => new Map());
  for (const r of ijwRows) {
    keyFns.forEach((kf, i) => {
      const k = kf(r);
      if (!k) return;
      maps[i].set(k, maps[i].has(k) ? null : r.id); // 첫 등장=id, 재등장=null(모호)
    });
  }
  return (rec) => {
    for (let i = 0; i < keyFns.length; i++) {
      const k = keyFns[i](rec);
      if (k) {
        const v = maps[i].get(k);
        if (v) return v; // 유일 일치(모호 null·미존재 undefined는 다음 티어로)
      }
    }
    return null;
  };
}

// 단일 테넌트 해석(현재 인재원 1개). 멀티테넌트면 env MAKEEDU_TENANT_ID로 고정 주입.
async function resolveTenantId(sql) {
  if (process.env.MAKEEDU_TENANT_ID) return process.env.MAKEEDU_TENANT_ID;
  const t = await sql`select id from tenants order by created_at limit 1`;
  if (!t.length) throw new Error("no tenant");
  return t[0].id;
}

// 동기화 성공 후 도메인별 마지막 시각 기록(makeedu_sync_state, 화면 'N분 전' 표시용). service_role로 호출.
async function recordSync(sql, tenantId, domain, rowCount, status = "ok", error = null) {
  await sql`
    insert into makeedu_sync_state (tenant_id, domain, synced_at, row_count, status, error, updated_at)
    values (${tenantId}, ${domain}, now(), ${rowCount ?? null}, ${status}, ${error}, now())
    on conflict (tenant_id, domain) do update set
      synced_at = now(), row_count = excluded.row_count, status = excluded.status, error = excluded.error, updated_at = now()`;
}

/**
 * 스크랩할 청구월 범위 — makeedu 상세수납의 `fromYm`/`toYm`(텍스트 `YYYY-MM`)에 넣을 값.
 *
 * 🔴 배경(2026-07-30 프로브 실측): 이 목록은 **가장 최근 청구월 한 달**만 기본으로 보여준다. 그래서 청구가
 * 다음 달로 넘어가는 순간(2026-07-16→17) 직전 달이 통째로 동결됐고, 그 뒤 26회 넘는 동기화가 2026-07을
 * 한 건도 만지지 못했다(미수 ₩12.86M이 그날 스냅샷으로 굳음). `fromYm`~`toYm`는 **범위**라
 * 한 번의 조회로 여러 달을 받을 수 있다(실측 857건 → 3,174건).
 *
 * @param today  기준일(KST 'YYYY-MM-DD' 또는 Date). 테스트 결정성을 위해 주입.
 * @param months 포함할 개월 수(당월 포함). 1이면 당월만.
 */
function billingMonthRange(today, months = 3) {
  const n = Math.max(1, Math.floor(Number(months) || 1));
  const iso =
    typeof today === "string"
      ? today
      : new Intl.DateTimeFormat("en-CA", {
          timeZone: "Asia/Seoul",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(today || new Date());
  const [y, m] = iso.split("-").map(Number);
  const pad = (v) => String(v).padStart(2, "0");
  // 월 산술은 Date의 월 오버플로에 맡긴다(1월에서 뒤로 갈 때 연도가 알아서 내려간다).
  const from = new Date(Date.UTC(y, m - 1 - (n - 1), 1));
  return {
    from: `${from.getUTCFullYear()}-${pad(from.getUTCMonth() + 1)}`,
    to: `${y}-${pad(m)}`,
  };
}

module.exports = {
  recordSync,
  tieredMatcher,
  isNonClass,
  NONCLASS_RE,
  PROSPECT_LIST_NOTE,
  txt,
  parseDate,
  parseTimestamp,
  normPhone,
  gender,
  normalizeName,
  parseAmount,
  gradeNorm,
  subjectFromName,
  paymentMethod,
  resolveTenantId,
  billingMonthRange,
};
