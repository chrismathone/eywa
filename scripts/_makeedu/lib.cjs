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
// 🔴🔴 makeedu는 목록에서 **원생 상태를 이름 뒤 괄호로 표시**한다 — `강윤서(퇴)` · `박수빈(퇴)`.
// 재원생만 보던 시절엔 이 접미사를 볼 일이 없었는데, 원생상태를 '전체'로 바꾼 순간 나타났고
// **eywa의 `강윤서`와 매칭이 깨졌다**(2026-07-31 실측: 3,459라인 중 350건 미매칭 = 10%).
// 매칭이 깨지면 그 학생의 청구가 "makeedu에 없다"로 읽혀 **삭제 후보가 된다** — 실제로 강윤서·박수빈·
// 김나율A·김경진의 청구가 그렇게 무효 처리됐다(makeedu엔 멀쩡히 있는데도).
// ⚠️ **괄호를 통째로 벗기면 안 된다** — eywa에 `박소선 (테스트)`·`원일(테스트)` 같은 실제 이름이 있어
//    벗기면 다른 사람과 충돌한다. **상태 표시로 알려진 것만** 지운다(allowlist).
const NAME_STATUS_SUFFIX = /\((?:퇴|퇴원|휴|휴원|졸|졸업)\)\s*$/;

function stripNameStatusSuffix(v) {
  const s = txt(v);
  if (!s) return "";
  return s.replace(NAME_STATUS_SUFFIX, "").trim();
}

// 매칭용 정규화 — 공백 제거 + 소문자 + **상태 접미사 제거**(표시용이 아니라 대조 키다).
function normalizeName(v) {
  const s = stripNameStatusSuffix(v);
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
 * 🔴🔴 **달력 월로 계산하면 안 된다** (2026-07-31 실측 사고). makeedu는 **선청구**라
 * 달력 7월 중순에 이미 청구월이 2026-08로 넘어가 있다. 달력 기준으로 `당월-2 ~ 당월`을 넣었더니
 * `2026-05~2026-07`이 되어 **정작 살아있는 2026-08이 통째로 빠졌고**, 그 달 360건이 한 번도
 * 갱신되지 않은 채 미수 ₩54M이 옛 스냅샷으로 굳었다.
 *
 * 그래서 **앵커는 makeedu가 말하는 현재 청구월**이다(목록 화면의 `fromYm` 기본값 = 실측 `2026-08`).
 * 화면에서 못 읽으면 달력 월로 폴백하되, **선청구를 감안해 한 달 더 넓게** 잡는다(빈 달은 무해).
 *
 * @param anchor 현재 청구월 `YYYY-MM`(화면에서 읽은 값). 없으면 달력 기준 폴백.
 * @param months 포함할 개월 수(앵커 포함). 1이면 앵커 달만.
 * @param today  달력 폴백 기준일(KST 'YYYY-MM-DD' 또는 Date). 테스트 결정성을 위해 주입.
 */
function billingMonthRange({ anchor, months = 3, today } = {}) {
  const n = Math.max(1, Math.floor(Number(months) || 1));
  const pad = (v) => String(v).padStart(2, "0");
  const iso =
    typeof today === "string"
      ? today
      : new Intl.DateTimeFormat("en-CA", {
          timeZone: "Asia/Seoul",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(today || new Date());
  const [cy, cm] = iso.split("-").map(Number);

  let ay, am;
  const m = /^(\d{4})[-.]?(\d{2})$/.exec(String(anchor || "").trim());
  if (m) {
    ay = Number(m[1]);
    am = Number(m[2]);
  } else {
    // 폴백: 달력 당월 +1 (선청구로 이미 다음 달이 열려 있을 수 있다 — 빈 달을 하나 더 보는 비용은 싸다).
    const nx = new Date(Date.UTC(cy, cm, 1));
    ay = nx.getUTCFullYear();
    am = nx.getUTCMonth() + 1;
  }
  // 앵커가 달력 당월보다 뒤면 달력 당월을 쓴다(화면 값이 과거로 굳어 있는 이상 상황 방어).
  if (ay * 12 + am < cy * 12 + cm) {
    ay = cy;
    am = cm;
  }
  const from = new Date(Date.UTC(ay, am - 1 - (n - 1), 1)); // 월 오버플로가 연도를 알아서 내려준다
  return {
    from: `${from.getUTCFullYear()}-${pad(from.getUTCMonth() + 1)}`,
    to: `${ay}-${pad(am)}`,
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
  stripNameStatusSuffix,
  parseAmount,
  gradeNorm,
  subjectFromName,
  paymentMethod,
  resolveTenantId,
  billingMonthRange,
};
