/**
 * scripts/_oneoff/fix-enrollment-stats-from-calendar.cjs — 신규 콜&상담 통계 보정(실데이터, 2026-10-22).
 *
 * 원장 2026-10-22: *"신규 콜앤상담 통계 (추이) 탭을 전체적으로 검수해보고 정리해야겠어"* +
 * *"연결된 구글 캘린더 통해서 보정데이터 있으면 보정할것"*.
 *
 * 옮겨 온 옛 상담에서 통계를 흐리는 세 가지를 **증거가 있는 행만** 고친다(증거가 둘 이상으로 갈리면 손대지 않는다).
 *   A. 과목 빈칸 → 캘린더 '02. 입학 상담' 일정 제목의 과목(영어입테·수학입테·영수입테).
 *      일정 = 전화+이름 · 이름+학교 · (이름 없는 일정이면) 전화가 맞고 상담일 ±45일 안 · 후보 과목이 한 가지로 모일 때만.
 *   B. '그 달 1일'로 몰린 옛 자료의 상담일 → 같은 달 안의 캘린더 일정 날짜(취소 일정 제외 · 그 달에 날짜가 하나일 때만).
 *      달은 바꾸지 않는다(월별 수치는 그대로 · 일별 막대만 바로 선다). 시각(00:00·09:00)은 그대로 둔다.
 *   C. 옛 앱 이관(2026-07-01)에서 '미등록'이 '등록'으로 들어간 상담(`mapConsultationOutcome`의 `endsWith("등록")`) →
 *      상담일 −14일 ~ +90일 안에 수강 시작(연결 학생 또는 이름+학교가 같은 원생)도, 캘린더 '03. 신입생/시범수업' 일정도
 *      없으면 '미등록'(declined). 둘 중 하나라도 있으면 '등록' 그대로(실제로 다녔다).
 *
 * 🔴 드라이런이 기본(`--apply` 없으면 아무것도 안 쓴다). 적용은 한 거래 · 행마다 옛 값이 그대로일 때만 바꾸고
 *    감사로그를 행마다 남긴다(실행자 '자료 보정(구글 캘린더·수강 기록 대조)').
 * 🔴 적용 전 값은 `--backup <파일>`(기본 D:/tmp/enrollment-stats-fix-backup-<시각>.json)에 남는다. 되돌리기는 그 파일로.
 *
 * 사용:
 *   node --env-file=.env.local scripts/_oneoff/fix-enrollment-stats-from-calendar.cjs            # 드라이런
 *   node --env-file=.env.local scripts/_oneoff/fix-enrollment-stats-from-calendar.cjs --apply    # 적용
 * env: DATABASE_URL · TENANT_ID(기본 침산).
 */
const fs = require("fs");
const postgres = require("postgres");

const APPLY = process.argv.includes("--apply");
const T = process.env.TENANT_ID || "becaa316-e636-42e9-9d09-08b133e0b094";
const backupArg = process.argv.indexOf("--backup");
const BACKUP = backupArg > 0 ? process.argv[backupArg + 1] : `D:/tmp/enrollment-stats-fix-backup-${Date.now()}.json`;
const ACTOR = "자료 보정(구글 캘린더·수강 기록 대조)";
const VIA = "calendar_fix_2026_10_22";

const digits = (s) => String(s ?? "").replace(/\D/g, "");
const phonesIn = (t) => [...t.matchAll(/01[016789][-.\s/]*\d{3,4}[-.\s]*\d{4}/g)].map((m) => digits(m[0]));
const baseName = (n) => String(n ?? "").replace(/\s+/g, "").replace(/[A-Za-z]+$/, "");
const schoolCore = (s) => String(s ?? "").replace(/\s+/g, "").replace(/^대구/, "").replace(/(초등학교|중학교|고등학교|초|중|고)$/, "");
const dayDiff = (a, b) => Math.round((Date.parse(a) - Date.parse(b)) / 86400000);
/** 일정 제목의 과목 — '영어입테'·'수학 입테'·'영수레테'·'영어/수학 입테'. 수학·영어 밖은 손대지 않는다. */
function subjectsOf(title) {
  const out = new Set();
  for (const m of title.matchAll(/(영수|영어|수학|과학|국어)\s*(?:EIE|EiE)?\s*(?:재)?\s*(입테|레테|레벨|상담|테스트|입학)/g)) {
    if (m[1] === "영수") { out.add("math"); out.add("english"); }
    else out.add({ 영어: "english", 수학: "math", 과학: "science", 국어: "korean" }[m[1]]);
  }
  if (/영어\s*\/\s*수학|수학\s*\/\s*영어/.test(title)) { out.add("math"); out.add("english"); }
  return [...out].sort();
}
/** 저장 값 — 한 과목은 설정 키(새 입력과 같다) · 영어+수학은 옛 자료와 같은 글('수학, 영어' — 통계가 둘 다로 읽는다). */
const subjectValue = (keys) => (keys.length === 1 ? keys[0] : keys.join(",") === "english,math" ? "수학, 영어" : null);
const blocking = (t) => /(금지|불가|휴무|마감)/.test(t) && phonesIn(t).length === 0;

(async () => {
  const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false, onnotice: () => {} });
  try {
    const [evs, rows, studs] = await Promise.all([
      sql`select e.id, e.start_date::text d, e.title, t.name tag from public.calendar_events e join public.calendar_tags t on t.id=e.tag_id
          where e.tenant_id=${T} and (t.name like '02.%' or t.name like '03.%') and e.start_date between '2022-12-01' and '2026-12-31'`,
      sql`select id, prospect_name, prospect_school, prospect_grade, parent_phone, student_phone, home_phone, subject, outcome::text outcome,
          registration_status, student_id, referrer_student_id, referrer_staff_id, consulted_at,
          to_char(consulted_at at time zone 'Asia/Seoul','YYYY-MM-DD') d, to_char(consulted_at at time zone 'Asia/Seoul','HH24:MI:SS') hms,
          to_char(created_at at time zone 'Asia/Seoul','YYYY-MM-DD') cd, legacy_source
          from public.enrollment_consultations where tenant_id=${T}`,
      sql`select s.id, s.name, s.school,
          coalesce((select json_agg(e.start_date::text) from public.enrollments e where e.student_id=s.id), '[]') starts
          from public.students s where s.tenant_id=${T}`,
    ]);
    const consultEvs = evs.filter((e) => e.tag.startsWith("02.") && e.title && !blocking(e.title)).map((e) => ({ ...e, phones: phonesIn(e.title), subjects: subjectsOf(e.title), flat: e.title.replace(/\s/g, "") }));
    const newbieEvs = evs.filter((e) => e.tag.startsWith("03.") && e.title).map((e) => ({ ...e, flat: e.title.replace(/\s/g, "") }));
    const candidatesOf = (r, windowDays) => {
      const ph = [r.parent_phone, r.student_phone, r.home_phone].map(digits).filter((p) => p.length >= 10);
      const nm = baseName(r.prospect_name);
      const sc = schoolCore(r.prospect_school);
      return consultEvs.filter((c) => {
        if (Math.abs(dayDiff(c.d, r.d)) > windowDays) return false;
        const phone = c.phones.some((p) => ph.includes(p));
        const name = nm.length >= 2 && c.flat.includes(nm);
        const school = sc.length >= 2 && c.flat.includes(sc);
        return (phone && name) || (name && school) || (phone && !/[가-힣]{2,4}\s*\(/.test(c.title));
      });
    };

    // A. 과목
    const fixSubject = [];
    for (const r of rows) {
      if (String(r.subject ?? "").trim()) continue;
      const cs = candidatesOf(r, 45);
      const subs = new Set(cs.map((c) => c.subjects.join(",")).filter(Boolean));
      if (subs.size !== 1) continue;
      const value = subjectValue([...subs][0].split(","));
      if (!value) continue;
      fixSubject.push({ id: r.id, name: r.prospect_name, from: r.subject, to: value, eventId: cs.find((c) => c.subjects.length)?.id ?? null, d: r.d });
    }
    // B. 상담일(같은 달 안)
    const fixDate = [];
    for (const r of rows) {
      const imported = !!r.legacy_source || r.cd === "2026-07-01";
      if (!imported || !r.d.endsWith("-01") || !["00:00:00", "09:00:00"].includes(r.hms)) continue;
      const same = candidatesOf(r, 62).filter((c) => !/취소/.test(c.title) && c.d.slice(0, 7) === r.d.slice(0, 7));
      const days = [...new Set(same.map((c) => c.d))];
      if (days.length !== 1 || days[0] === r.d) continue;
      fixDate.push({ id: r.id, name: r.prospect_name, from: r.consulted_at.toISOString(), fromDay: r.d, toDay: days[0], hms: r.hms, eventId: same[0].id });
    }
    // C. 상태
    const byName = new Map();
    for (const s of studs) (byName.get(baseName(s.name)) ?? byName.set(baseName(s.name), []).get(baseName(s.name))).push(s);
    const fixOutcome = [];
    const keptEnrolled = [];
    for (const r of rows) {
      if (r.registration_status !== "미등록" || r.outcome !== "enrolled" || r.cd !== "2026-07-01") continue;
      if (r.referrer_student_id || r.referrer_staff_id) continue; // 소개 기록이 붙은 상담은 사람이 본 행 — 건드리지 않는다
      const nm = baseName(r.prospect_name);
      const sc = schoolCore(r.prospect_school);
      const cands = r.student_id ? studs.filter((s) => s.id === r.student_id) : (byName.get(nm) ?? []).filter((s) => sc && schoolCore(s.school) === sc);
      const started = cands.flatMap((s) => s.starts).some((x) => { const k = dayDiff(x, r.d); return k >= -14 && k <= 90; });
      const newbie = nm.length >= 2 && newbieEvs.some((c) => c.flat.includes(nm) && dayDiff(c.d, r.d) >= -14 && dayDiff(c.d, r.d) <= 90);
      if (started || newbie) { keptEnrolled.push(r.id); continue; }
      fixOutcome.push({ id: r.id, name: r.prospect_name, d: r.d });
    }

    const byMonth = (arr, f) => { const o = {}; for (const x of arr) o[f(x)] = (o[f(x)] ?? 0) + 1; return Object.entries(o).sort().map(([k, v]) => `${k}:${v}`).join(" "); };
    console.log(`A 과목 채움 ${fixSubject.length}건 — ${byMonth(fixSubject, (x) => x.d.slice(0, 7))}`);
    console.log(`B 상담일 바로잡음(같은 달 안) ${fixDate.length}건 — ${byMonth(fixDate, (x) => x.fromDay.slice(0, 7))}`);
    console.log(`C 상태 등록 → 미등록 ${fixOutcome.length}건 — ${byMonth(fixOutcome, (x) => x.d.slice(0, 7))} · 등록 그대로(수강·첫수업 확인) ${keptEnrolled.length}건`);
    if (!APPLY) {
      console.log("\n드라이런 — 아무것도 쓰지 않았습니다. 적용: --apply");
      return;
    }

    const backup = {
      at: new Date().toISOString(),
      subject: fixSubject.map((x) => ({ id: x.id, subject: x.from ?? null })),
      consulted_at: fixDate.map((x) => ({ id: x.id, consulted_at: x.from })),
      outcome: fixOutcome.map((x) => ({ id: x.id, outcome: "enrolled" })),
    };
    fs.writeFileSync(BACKUP, JSON.stringify(backup, null, 1), "utf8");
    console.log("되돌리기용 옛 값:", BACKUP);

    const done = await sql.begin(async (tx) => {
      const n = { subject: 0, date: 0, outcome: 0, skipped: 0 };
      const audit = (action, label, metadata) =>
        tx`insert into public.audit_logs (tenant_id, actor_id, actor_name, action, target_type, target_label, metadata)
           values (${T}, null, ${ACTOR}, ${action}, 'enrollment_consultations', ${label}, ${tx.json(metadata)})`;
      for (const x of fixSubject) {
        const r = await tx`update public.enrollment_consultations set subject=${x.to}, updated_at=now()
          where tenant_id=${T} and id=${x.id} and coalesce(btrim(subject),'')='' returning id`;
        if (!r.length) { n.skipped++; continue; }
        n.subject++;
        await audit("enrollment_consultation_update", x.name, { consultationId: x.id, changed: ["과목"], changes: [{ field: "과목", from: null, to: x.to }], via: VIA, calendarEventId: x.eventId });
      }
      for (const x of fixDate) {
        const r = await tx`update public.enrollment_consultations
          set consulted_at = ((${x.toDay}::date + ${x.hms}::time) at time zone 'Asia/Seoul'), updated_at=now()
          where tenant_id=${T} and id=${x.id} and consulted_at = ${x.from}::timestamptz returning id`;
        if (!r.length) { n.skipped++; continue; }
        n.date++;
        await audit("enrollment_consultation_update", x.name, { consultationId: x.id, changed: ["상담일"], changes: [{ field: "상담일", from: x.fromDay, to: x.toDay }], via: VIA, calendarEventId: x.eventId });
      }
      for (const x of fixOutcome) {
        const r = await tx`update public.enrollment_consultations set outcome='declined', updated_at=now()
          where tenant_id=${T} and id=${x.id} and outcome='enrolled' and registration_status='미등록' returning id`;
        if (!r.length) { n.skipped++; continue; }
        n.outcome++;
        await audit("enrollment_consultation_outcome", x.name, { consultationId: x.id, from: "enrolled", to: "declined", via: VIA, reason: "옛 기록 '미등록' · 수강 시작·첫수업 일정 없음" });
      }
      return n;
    });
    console.log("적용:", JSON.stringify(done));
  } catch (e) {
    console.error("오류:", String(e?.message ?? e).slice(0, 400));
    process.exitCode = 1;
  } finally {
    await sql.end({ timeout: 5 });
  }
})();
