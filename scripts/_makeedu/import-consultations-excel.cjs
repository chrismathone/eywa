/**
 * scripts/_makeedu/import-consultations-excel.cjs — makeedu 재원생 상담 엑셀(excel(댓글)) → student_consultations.
 *
 * makeedu 상담은 목록에 제목만 있고 본문은 상세 페이지라 자동 대량 fetch가 무겁다 → **초기 대량은 사용자가
 * makeedu에서 `excel(댓글)`로 1회 다운로드**(제목+내용 포함)해 이 임포터로 적재하고, 이후 증분만 자동 동기화.
 *
 * ⚠️ makeedu "엑셀"의 실체는 **HTML 테이블**(.xls 확장자만, <!DOCTYPE …) — xlsx 파서가 아니라 HTML 파싱.
 * ⚠️ 엑셀엔 counselSeq(안정 키)가 **없다** → makeedu_id는 null로 적재, 자연키(학생+상담일+내용head)로 멱등.
 *
 * 매칭·중복(오류 방지 배선):
 *  - 학생 매칭 3티어(tieredMatcher: ①이름+학교core+학년 ②이름+보호자전화 ③이름+학년), 모호=스킵(오매칭 방지).
 *  - 엄격 중복 = (학생, 상담일, 내용head 60자 정규화) 동일 → 스킵(재실행 멱등 + 엑셀 내 중복 행 차단).
 *  - 의심 중복 = 같은 학생·같은 날짜에 기존 상담 존재(내용은 다름) → 기본 임포트하되 건수·샘플 보고
 *    (`--skip-same-day`로 스킵 모드). ijw 이관분과 형식이 달라 텍스트로는 동일 상담 판별 불가.
 *  - 구분이 '재원생'이 아닌 행(예비원생 등)은 스킵 — 예비 상담은 enrollment_consultations 소관.
 *
 * 사용:
 *   node --env-file=.env.local scripts/_makeedu/import-consultations-excel.cjs --file="C:/.../상담내역.xls"          # dry-run
 *   node --env-file=.env.local scripts/_makeedu/import-consultations-excel.cjs --file=... --apply [--skip-same-day]
 *   (--file 생략 시 scripts/_makeedu/_incoming 의 최신 .xls)
 */
const fs = require("fs");
const path = require("path");
const postgres = require("postgres");
const L = require("./lib.cjs");
const { makeCounselorMatcher, loadSubjectLabels, resolveConsultationSubject, loadEnrolledSubjects } = require("./consultation-counselor.cjs");
// 반 매핑(0318a) — 앱·증분 동기화와 같은 판정 한 벌. 칸이 없으면(SQL 적용 전) 반 없이 적재([[#95]]).
const { assignClasses, hasClassColumns } = require("./consultation-class.cjs");

const APPLY = process.argv.includes("--apply");
const SKIP_SAME_DAY = process.argv.includes("--skip-same-day");
const FILE_ARG = (process.argv.find((a) => a.startsWith("--file=")) || "").slice("--file=".length).replace(/^"|"$/g, "");

// ── 입력 파일 결정 ─────────────────────────────────────────────────────────
function resolveFile() {
  if (FILE_ARG) return FILE_ARG;
  const dir = path.join(__dirname, "_incoming");
  const files = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((f) => /\.xls$/i.test(f)).map((f) => path.join(dir, f))
    : [];
  if (!files.length) throw new Error("--file=경로 를 지정하거나 scripts/_makeedu/_incoming/ 에 .xls 를 두세요.");
  return files.map((f) => ({ f, m: fs.statSync(f).mtimeMs })).sort((a, b) => b.m - a.m)[0].f;
}

// ── HTML(.xls) 파싱 ────────────────────────────────────────────────────────
function decode(buf) {
  const head = buf.slice(0, 2000).toString("utf8");
  const m = head.match(/charset=["']?([\w-]+)/i);
  const enc = m ? m[1].toLowerCase() : "utf-8";
  if (enc === "utf-8" || enc === "utf8") return buf.toString("utf8");
  try {
    return require("iconv-lite").decode(buf, enc); // 레거시 euc-kr 대비(현재 파일은 utf-8)
  } catch {
    throw new Error(`인코딩 ${enc} 디코딩 불가 — iconv-lite 필요`);
  }
}
const cleanCell = (s) =>
  s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\r/g, "")
    .trim();

function parseHtmlXls(file) {
  const html = decode(fs.readFileSync(file));
  if (!/<table/i.test(html)) throw new Error("HTML 테이블이 없습니다 — makeedu excel(댓글) 파일이 맞는지 확인.");
  // 가장 행이 많은 테이블 채택.
  let best = null;
  for (const t of html.match(/<table[\s\S]*?<\/table>/gi) || []) {
    const n = (t.match(/<tr/gi) || []).length;
    if (!best || n > best.n) best = { t, n };
  }
  const rows = (best.t.match(/<tr[\s\S]*?<\/tr>/gi) || []).map((r) =>
    (r.match(/<t[dh][\s\S]*?<\/t[dh]>/gi) || []).map(cleanCell),
  );
  if (rows.length < 2) throw new Error("데이터 행이 없습니다.");
  return { headers: rows[0], rows: rows.slice(1) };
}

// ── 정규화 헬퍼 ────────────────────────────────────────────────────────────
// 학교 core: 초등학교/중학교/고등학교/여중/여고 등 접미 제거(backfill-consultation-student-link와 동일 취지).
function schoolCore(v) {
  const s = L.txt(v);
  if (!s) return "";
  return s
    .replace(/\s+/g, "")
    .replace(/(초등학교|중학교|고등학교|여자중학교|여자고등학교)$/u, "")
    .replace(/(초|중|고|여중|여고)$/u, "")
    .toLowerCase();
}
const normText = (s) => (s || "").replace(/\s+/g, "").slice(0, 60);
const phoneDigits = (v) => ((L.txt(v) || "").replace(/[^0-9]/g, "") || null);

// makeedu 상담구분 → aywa category(코드 고정 enum — 운영 enum 아님).
function mapCategory(v) {
  const s = L.txt(v) || "";
  if (/학습|성적|학업/.test(s)) return "academic";
  if (/정서|심리/.test(s)) return "emotional";
  if (/진로|진학|입시/.test(s)) return "career";
  if (/교우|친구/.test(s)) return "social";
  if (!s) return "general";
  return "general";
}

(async () => {
  const file = resolveFile();
  const { headers, rows } = parseHtmlXls(file);
  console.log(`file: ${path.basename(file)} | 헤더 ${headers.length}개 | 데이터 ${rows.length}행`);

  // 헤더 검증(필수 헤더 없으면 전체가 어긋난 파일 — 파괴적 오적재 방지, timetable assertEditHeaders 정신).
  const idx = (name) => headers.findIndex((h) => (h || "").includes(name));
  const ci = {
    kind: idx("구분"), name: idx("이름"), school: idx("학교"), grade: idx("학년"),
    parentPhone: idx("보호자연락처"), studPhone: idx("원생연락처"),
    cat1: idx("상담구분"), writer: idx("등록자"), date: idx("상담일"),
    title: idx("제목"), body: idx("내용"),
  };
  for (const k of ["name", "date", "body"]) {
    if (ci[k] < 0) throw new Error(`필수 헤더 누락: ${k === "name" ? "이름" : k === "date" ? "상담일" : "내용"} — excel(댓글) 버전으로 다시 받으세요. 헤더=${JSON.stringify(headers)}`);
  }

  const sql = postgres(process.env.DATABASE_URL, { prepare: false });
  try {
    const tenantId = await L.resolveTenantId(sql);

    // 학생 매칭 풀(활성 우선 매칭을 위해 status 포함 로드 — postgres 직결이라 행수 제한 없음).
    const students = await sql`
      select id, name, school, grade, parent_phone, status from students where tenant_id = ${tenantId}`;
    // 활성(비퇴원) 우선 매칭 → 실패 시 전체(퇴원 포함— 과거 상담이 퇴원생일 수 있음).
    const tiers = [
      (r) => (r.name && r.schoolCore ? `${L.normalizeName(r.name)}|${r.schoolCore}|${r.grade || ""}` : null),
      (r) => (r.name && r.parentPhoneD ? `${L.normalizeName(r.name)}|${r.parentPhoneD}` : null),
      (r) => (r.name ? `${L.normalizeName(r.name)}|${r.grade || ""}` : null),
    ];
    const toKeyRow = (s) => ({
      id: s.id, name: s.name, schoolCore: schoolCore(s.school), grade: L.txt(s.grade),
      parentPhoneD: phoneDigits(s.parent_phone),
    });
    const matchActive = L.tieredMatcher(students.filter((s) => s.status !== "withdrawn").map(toKeyRow), tiers);
    const matchAll = L.tieredMatcher(students.map(toKeyRow), tiers);

    // 기존 상담(중복 판정용): 자연키 셋 + 학생·날짜 셋.
    // ⚠️ 날짜는 반드시 **KST 기준**으로 뽑는다 — bare `::date`는 세션 TZ(UTC)라 KST 자정(+09:00)으로
    // 저장한 상담이 전날로 계산돼 멱등 키가 어긋난다(재실행 시 중복 insert — 실측으로 잡은 버그).
    const existing = await sql`
      select student_id, to_char(consulted_at at time zone 'Asia/Seoul', 'YYYY-MM-DD') as d, summary
      from student_consultations where tenant_id = ${tenantId}`;
    const strictKeys = new Set(existing.map((e) => `${e.student_id}|${e.d}|${normText(e.summary)}`));
    const dayKeys = new Set(existing.map((e) => `${e.student_id}|${e.d}`));

    // 상담사 매칭(best-effort): "이지은(Amy)" → 괄호 앞 이름 = users.display_name 유일 일치 시만.
    const users = await sql`select id, display_name, english_name, subjects, status from users where tenant_id = ${tenantId} and system_role <> 'student'`;
    const matchCounselor = makeCounselorMatcher(users);
    const subjectLabels = await loadSubjectLabels(sql, tenantId);

    // ── 행 처리 ──
    const stats = { total: rows.length, notEnrolledKind: 0, prospectTemplate: 0, noContent: 0, noStudent: 0, strictDup: 0, sameDay: 0, batchDup: 0, toInsert: 0 };
    const inserts = [];
    const sameDaySamples = [];
    const noStudentSamples = [];
    const batchKeys = new Set();

    for (const r of rows) {
      const kind = ci.kind >= 0 ? L.txt(r[ci.kind]) : null;
      if (kind && kind !== "재원생") { stats.notEnrolledKind++; continue; } // 예비원생 등은 enrollment 소관
      const name = L.txt(r[ci.name]);
      const dateStr = L.parseDate(r[ci.date]);
      const title = ci.title >= 0 ? L.txt(r[ci.title]) : null;
      const body = L.txt(r[ci.body]);
      const summary = title && body ? `${title}\n\n${body}` : body || title;
      if (!name || !dateStr || !summary) { stats.noContent++; continue; }
      // 예비→재원 전환 학생의 옛 '예비원생 상담'(입회상담) — enrollment_consultations에 이미 동기화된
      // 내용이라 재원생 상담으로 또 넣으면 중복 표기 → 스킵(제목/본문 머리에 템플릿 문구).
      if (/예비원생 상담/.test((title || "").slice(0, 30)) || /예비원생 상담/.test(summary.slice(0, 40))) {
        stats.prospectTemplate++;
        continue;
      }

      const rec = {
        name, grade: L.gradeNorm(r[ci.grade]), schoolCore: schoolCore(r[ci.school]),
        parentPhoneD: phoneDigits(r[ci.parentPhone]),
      };
      const studentId = matchActive(rec) || matchAll(rec);
      if (!studentId) {
        stats.noStudent++;
        if (noStudentSamples.length < 8) noStudentSamples.push(`${name}(${L.txt(r[ci.school]) || "?"} ${L.txt(r[ci.grade]) || "?"})`);
        continue;
      }

      const strictKey = `${studentId}|${dateStr}|${normText(summary)}`;
      if (strictKeys.has(strictKey)) { stats.strictDup++; continue; } // 재실행 멱등 + 기존 동일 내용
      if (batchKeys.has(strictKey)) { stats.batchDup++; continue; } // 엑셀 내 중복 행
      batchKeys.add(strictKey);

      const dayKey = `${studentId}|${dateStr}`;
      if (dayKeys.has(dayKey)) {
        stats.sameDay++;
        if (sameDaySamples.length < 5) {
          const ex = existing.find((e) => `${e.student_id}|${e.d}` === dayKey);
          sameDaySamples.push({ name, date: dateStr, 기존: (ex?.summary || "").slice(0, 60).replace(/\n/g, "⏎"), 엑셀: summary.slice(0, 60).replace(/\n/g, "⏎") });
        }
        if (SKIP_SAME_DAY) continue; // 보수 모드: 같은 날 기존 상담 있으면 스킵
      }

      stats.toInsert++;
      inserts.push({
        studentId, summary, name, dateStr,
        consultedAt: `${dateStr}T00:00:00+09:00`, // KST 자정(parseTimestamp 규약)
        category: mapCategory(ci.cat1 >= 0 ? r[ci.cat1] : null),
        counselor: matchCounselor(ci.writer >= 0 ? r[ci.writer] : null),
      });
    }
    // 상담사·과목 판정 — 증분 동기화와 같은 함수(consultation-counselor.cjs).
    const enrolledBy = await loadEnrolledSubjects(sql, tenantId, inserts.map((it) => ({ studentId: it.studentId, date: it.dateStr })));
    for (const it of inserts) {
      it.counselorId = it.counselor?.id ?? null;
      it.subject = resolveConsultationSubject({
        counselor: it.counselor,
        enrolledSubjects: enrolledBy.get(`${it.studentId}|${it.dateStr}`) || [],
        labels: subjectLabels,
      })?.label ?? null;
    }
    // 반 — 과목을 정한 뒤에(과목으로 좁힌다).
    const classOn = await hasClassColumns(sql);
    if (classOn && inserts.length) {
      const items = inserts.map((it) => ({ studentId: it.studentId, date: it.dateStr, counselorId: it.counselorId, subject: it.subject }));
      console.log("[반]", JSON.stringify(await assignClasses(sql, tenantId, items, subjectLabels)));
      items.forEach((x, i) => { inserts[i].classId = x.classId; inserts[i].classSource = x.classSource; });
    }

    console.log("\n[통계]", JSON.stringify(stats, null, 1));
    if (noStudentSamples.length) console.log("학생 미매칭 표본:", noStudentSamples.join(", "));
    if (sameDaySamples.length) {
      console.log(`\n같은 학생·같은 날짜에 기존 상담 존재(${SKIP_SAME_DAY ? "스킵 모드" : "임포트 모드"}) 표본:`);
      for (const s of sameDaySamples) console.log(` - ${s.name} ${s.date}\n     기존: ${s.기존}\n     엑셀: ${s.엑셀}`);
    }

    if (inserts.length) {
      console.log(`\n임포트 대상 표본(최대 10):`);
      for (const it of inserts.slice(0, 10)) console.log(` + ${it.name} ${it.dateStr}: ${it.summary.slice(0, 70).replace(/\n/g, "⏎")}`);
    }

    if (!APPLY) { console.log("\n[DRY-RUN] --apply 없이 종료 (DB write 0)."); return; }

    let inserted = 0;
    for (const it of inserts) {
      await sql`
        insert into student_consultations
          (tenant_id, student_id, counselor_id, consulted_at, category, subject, summary
           ${classOn ? sql`, class_id, class_source` : sql``})
        values (${tenantId}, ${it.studentId}, ${it.counselorId}, ${it.consultedAt}, ${it.category}, ${it.subject}, ${it.summary}
          ${classOn ? sql`, ${it.classId ?? null}, ${it.classSource ?? null}` : sql``})`;
      inserted++;
    }
    // 수동 부트스트랩도 동기화 시각으로 기록(학생상담 화면 '↻ 동기화' 배지). sync_added_at 배지는 자동 증분용이라 안 찍음.
    await L.recordSync(sql, tenantId, "consultations", inserted);
    console.log(`\n✅ inserted: ${inserted}건 (makeedu_id=null — 이후 증분 동기화가 counselSeq 백필 예정)`);
  } finally {
    await sql.end();
  }
})().catch((e) => {
  console.error("ERR", e.message);
  process.exit(1);
});
