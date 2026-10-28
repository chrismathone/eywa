/**
 * scripts/_makeedu/rebuild-history-monthly.mts — 원생 통계 '지난 기록'의 **메이크에듀 줄**(`student_history_monthly` · source='makeedu' ·
 * 2020-01~2025-12)을 메이크에듀 수납 원자료(0384a `makeedu_history_bills` 85,605줄)로 다시 센다.
 *
 * 원장 2026-10-28: *"수납을 기준으로 재원생 과목, 강좌수, 퇴원생등 추측가능한것을 최대치로"* · *"EiE라고 되어있는데. 수납명에 교재를 보면 그 학생이
 * EiE 수업인지 판단가능함"* · *"청구건수가 이상할정도로 적은달은 건너뛰는게 차라리 나음. 애매한것보다. 과목별로 분리가능한 수준까지 쫙 분리시킬것"*.
 *
 * 무엇이 바뀌나(종전 운영자 집계 대비):
 *  ① 2025-05 전엔 EiE·일부 과목 수업료가 **'교재' 구분**으로 청구됐다('ROOKIES (LE) 월수목 Aaron' · 메모 '수강료') — 교재 줄 중 요일·시간·
 *     nT 표기가 있거나 낸 돈 8만 원 이상을 수업료로 센다. 그 시기 기타 항목의 청구액은 연도 숫자(2,023)라 **낸 돈**을 금액으로.
 *     EiE 수업명(ROOKIES·LEADERS·PHONICS·Let's · 레벨 줄임말 (LE)·(LT)…)은 `[EiE]`로 본다 → EiE가 2021-07부터 이어진다(EiE 칸은 2020-01부터 · 그 전은 0).
 *  ② 그 밖의 과목을 과목마다(`payingSubject:<키>` — 국어·과학…).
 *  ③ 청구가 비정상으로 적은 달(앞뒤 3개월 중앙값의 60% 미만 — 2025-04 23% · 2020-02 55%)은 **메우지 않고 비운다**(`skippedPaying`) · 청구가 끊긴 학생은 그 달을 넘어 판정.
 *  ④ 청구가 끊긴 학생은 2026년 에이와 청구와 **이어서** 판정(원생번호 → 에이와 학생) — 2025-10~12도 셀 수 있다.
 *  ⑤ 지금 직원 명단에 없는 옛 강사의 과목은 원장이 알려 준 대로(`FORMER_STAFF`).
 *  ⑥ 원장 시트 '5개년' 탭의 **반형태**(`--class-types=<파일>` — 수납명 → 반형태 줄 수만 · 학생·금액 없음)로 이름 판정이 모름인 반을 메우고
 *     EiE를 가른다 · 수업이 아닌 반은 기타로(`CLASS_TYPE_RULES` — 원장 2026-10-28).
 * 그대로인 것: `enrolledRecord`(메이크에듀 월별 재원생 기록) · 2026년 메이크에듀 줄 · 에이와 줄.
 * 계산은 앱의 밤 집계와 **같은 함수**(`aywaHistoryMonths` · `lessonProgramClassifier`) — 검증: 같은 길로 2026년 에이와 청구를 다시 세면 저장된
 * 에이와 줄과 같다(드라이런이 함께 대조한다).
 *
 *   npx tsx --env-file=.env.local scripts/_makeedu/rebuild-history-monthly.mts --tenant=cs                 # 드라이런(쓰기 0)
 *   npx tsx --env-file=.env.local scripts/_makeedu/rebuild-history-monthly.mts --tenant=cs --apply         # 백업 뒤 쓰기
 *   npx tsx --env-file=.env.local scripts/_makeedu/rebuild-history-monthly.mts --tenant=cs --revert=<백업.json>
 *   (--backup-dir=<폴더> — 기본 OS 임시 폴더 · 원생 이름·연락처는 읽지도 쓰지도 않는다)
 *   (--class-types=<파일> — { "수납명": { "반형태": 줄 수 } } JSON · 없으면 ⑥의 반형태 메우기 없이 센다)
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import postgres from "postgres";
import { aywaHistoryMonths, isLiveTuition, lessonKinds, lessonNameWeights, type HistoryInvoice } from "@/features/students/stats/history-aywa";
import { isEieLesson, lessonProgramClassifier, type LessonStaff } from "@/features/students/stats/lesson-program";
import { resolveSettings } from "@/features/owner/resolve";
import {
  bookTuitionNames,
  classTypeGroup,
  dominantClassType,
  historyInvoices,
  historyLine,
  isTeacherClassType,
  lowBillingMonths,
  teacherTypeGroups,
  type HistoryBill,
} from "@/features/students/stats/makeedu-history-bills";

const ym = (d: Date | string) => (typeof d === "string" ? d.slice(0, 7) : d.toISOString().slice(0, 7));
const shift = (m: string, n: number) => {
  const [y, mo] = m.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, mo - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};
const monthsBetween = (a: string, b: string) => {
  const out: string[] = [];
  for (let m = a; m <= b; m = shift(m, 1)) out.push(m);
  return out;
};
const kstMonth = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 7);

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const APPLY = process.argv.includes("--apply");
const REVERT = arg("revert");
const SLUG = arg("tenant") ?? "cs";
const BACKUP_DIR = arg("backup-dir") ?? join(tmpdir(), "aywa-history-monthly-backups");
const FROM = "2020-01";
const THROUGH = "2025-12"; // 메이크에듀 원자료 끝 — 2026년부터는 에이와 줄
/**
 * 지금 직원 명단(users)에 없는 옛 강사 — 원장 2026-10-28 *"디올 승헌 수학, 리치 수학 트레비 수학"* · *"브라이언 영어"* · *"(임) 수학 (이) 수학
 * (유) 수학"*. 수납명엔 '디올T'·'(디올)'·'승헌T'·'RichY*'·'richY'·'Trevi'·'TreviT*'·'(TrevII*)'·'브라이언 시그니처'·'(Brian)'·'인재원 … 월목2(임)'으로
 * 적혔다. 직원처럼 판정기에 넣고(강사 표시가 낱말보다 먼저) `loose` — 강사 표시로 안 잡히는 모양('(디올)'·소문자 'richY'·'브라이언 …')도
 * 이름이 보이면 그 과목(판정이 모름일 때만 · 과목 이름이 적힌 수업명·두 과목 합반은 그대로).
 */
const FORMER_STAFF: Record<string, LessonStaff[]> = {
  cs: [
    { names: ["디올", "승헌", "트레비", "Rich", "Trevi", "Trev", "(임)", "(이)", "(유)"], subjects: ["math"], loose: true },
    { names: ["브라이언", "Brian"], subjects: ["english"], loose: true },
  ],
};
/**
 * 반형태 규칙(원장 2026-10-28) — *"단과 내신대비, 순공300, 100점프로젝트는 그냥 기타로 넘겨. 수업이 아닌듯"*.
 *  `other` = 그 반형태의 수납명은 모두 기타(이름 판정이 정해졌어도) · `otherNames` = 반형태와 상관없이 기타 ·
 *  `nameSubjects` = 원장이 과목을 정해 준 수납명(이름 판정이 모름일 때만 · 원장 2026-10-28 *"셋 다 수학"*).
 *  2025-06 뒤 내신대비 반(시트 밖)은 수업 그대로 — 원장 *"김화영은 수학, 국어는 국어"*(이름 판정이 이미 그렇게 센다).
 *  '순공300 프로그램'은 정규 수업 409개에도 붙은 학생 묶음 표시라 반형태로 걸지 않고 과목 없는 반('스터디케어')만 이름으로 건다 — '모름이면
 *  기타'로 걸면 판정이 흔들릴 때 정규 반이 화면에 안 보이게 학생 수에서 빠진다(리뷰 2026-10-28).
 *  강사형 반형태 'Sarah 중고등'은 과목을 정하지 않는다 — 정해진 줄의 72%가 같은 반형태의 Forever 수학 반이다(원장 *"sarah는 영어"*는 강사 이야기 ·
 *  Sarah는 지금 직원 명단에 영어로 있어 이름이 보이는 반은 이미 영어).
 */
const CLASS_TYPE_RULES: Record<string, { other: string[]; otherNames: RegExp[]; nameSubjects: Record<string, string> }> = {
  cs: {
    other: ["단과 내신대비"],
    otherNames: [/100점\s*프로젝트/, /스터디\s*케어/],
    nameSubjects: { "내신 추가수업 토": "math", "김은정 중등 화 3교시": "math", "중등주말내신보강 2회": "math" },
  },
};
const CLASS_TYPES = arg("class-types");
const EXPLAIN = arg("explain");
const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1 });
const READ_ONLY = !APPLY && !REVERT;
try {
  if (READ_ONLY) await sql`set session characteristics as transaction read only`; // 드라이런은 쓰기를 DB가 막는다
  const tenant = (await sql`select id, name from public.tenants where slug=${SLUG}`)[0];
  if (!tenant) throw new Error(`지점 없음: ${SLUG}`);
  const t = tenant.id as string;

  if (REVERT) {
    const backup = JSON.parse(readFileSync(REVERT, "utf8")) as {
      tenantId: string;
      rows: { month: string; data: unknown; computed_at: string | null }[];
      written?: string[];
    };
    if (backup.tenantId !== t) throw new Error("백업의 지점이 다르다");
    // 쓰기 전에 없던 달(이번에 새로 넣은 줄)은 지운다 — 백업 줄은 값을 되돌린다.
    const had = new Set(backup.rows.map((r) => r.month));
    const added = (backup.written ?? []).filter((m) => !had.has(m));
    await sql.begin(async (tx) => {
      for (const r of backup.rows) {
        await tx`update public.student_history_monthly set data=${tx.json(r.data as never)}, computed_at=${r.computed_at}
          where tenant_id=${t} and source='makeedu' and month=${`${r.month}-01`}::date`;
      }
      for (const m of added) await tx`delete from public.student_history_monthly where tenant_id=${t} and source='makeedu' and month=${`${m}-01`}::date`;
    });
    console.log(`되돌림: 메이크에듀 줄 ${backup.rows.length}개를 백업 값으로 · 새로 넣었던 줄 ${added.length}개 지움`);
    await sql.end();
    process.exit(0);
  }

  // ── 재료(읽기) ──
  const settingsRow = (await sql`select data from public.tenant_settings where tenant_id=${t}`)[0];
  const subjects = resolveSettings(settingsRow?.data ?? null, { name: tenant.name as string }).operations.subjects.map((s) => ({ key: s.key, label: s.label }));
  const users = await sql`select display_name, english_name, subjects from public.users where tenant_id=${t} and subjects is not null`;
  const staff: LessonStaff[] = users.filter((u) => (u.subjects as string[])?.length).map((u) => ({ names: [u.display_name, u.english_name], subjects: u.subjects as string[] }));
  const bills = (await sql`select makeedu_no, bill_month, item_kind, category, item_name, billed, discount, points, paid
    from public.makeedu_history_bills where tenant_id=${t}`) as unknown as HistoryBill[];
  const links = await sql`select makeedu_no, student_id, enrolled_on from public.makeedu_history_students where tenant_id=${t}`;
  const idOf = new Map(links.filter((l) => l.student_id).map((l) => [String(l.makeedu_no), String(l.student_id)]));
  const appInv = ((await sql`select student_id, period, status, category, line_items, amount_total, amount_paid from public.invoices where tenant_id=${t}`) as unknown as HistoryInvoice[]).filter(isLiveTuition);
  const stored = await sql`select to_char(month,'YYYY-MM') m, source, data, computed_at from public.student_history_monthly where tenant_id=${t}`;
  const makeeduRows = stored.filter((r) => r.source === "makeedu");
  const oldBy = new Map(makeeduRows.map((r) => [r.m as string, r.data as Record<string, unknown>]));
  console.log(`재료: 수납 ${bills.length}줄 · 원생 ${links.length}(에이와 연결 ${idOf.size}) · 에이와 청구 ${appInv.length} · 설정 과목 ${subjects.length} · 담당 과목 직원 ${staff.length}`);

  // ── 청구 → 학생·달 청구서(메이크에듀 번호 → 연결된 에이와 학생) + 에이와 2026 청구 = 한 줄 ──
  const allStaff = [...staff, ...(FORMER_STAFF[SLUG] ?? [])];
  const build = (hints?: Parameters<typeof historyInvoices>[1]) => {
    const h = historyInvoices(bills, hints).filter(isLiveTuition).map((i) => ({ ...i, student_id: idOf.get(i.student_id) ?? `me:${i.student_id}` }));
    return { hist: h, stitched: [...h, ...appInv] as HistoryInvoice[] };
  };
  // ⑥ 반형태 — 첫 판정(반형태 없이)으로 강사형 반형태의 과목을 배우고, 수납명마다 표시를 정한 뒤 다시 센다.
  const rules = CLASS_TYPE_RULES[SLUG] ?? { other: [], otherNames: [], nameSubjects: {} };
  const norm = (s: string) => s.replace(/\s+/g, "").toLowerCase();
  // 공백·대소문자만 다른 시트 수납명은 한 이름 — 반형태 줄 수를 합친다(덮어쓰면 뒤에 온 키 하나가 반 전체의 반형태를 정한다).
  const sheet = new Map<string, Record<string, number>>();
  for (const [k, v] of Object.entries(CLASS_TYPES ? (JSON.parse(readFileSync(CLASS_TYPES, "utf8")) as Record<string, Record<string, number>>) : {})) {
    const cur = sheet.get(norm(k)) ?? sheet.set(norm(k), {}).get(norm(k))!;
    for (const [type, n] of Object.entries(v)) cur[type] = (cur[type] ?? 0) + n;
  }
  const pass0 = build();
  const classify0 = lessonProgramClassifier(lessonNameWeights(pass0.stitched), subjects, allStaff);
  const tuition0 = bookTuitionNames(bills);
  const byRaw = new Map<string, { desc: string; weight: number }>(); // 수업 줄 수납명 → 판정기에 들어갈 수업명(트림) · 줄 수
  for (const b of bills) {
    const line = historyLine(b, tuition0);
    if (line.kind !== "수업") continue;
    const raw = String(b.item_name ?? "");
    const cur = byRaw.get(raw) ?? byRaw.set(raw, { desc: line.description.trim(), weight: 0 }).get(raw)!;
    cur.weight++;
  }
  const typeOf = (raw: string) => dominantClassType(sheet.get(norm(raw)));
  const groupOfProgram = (p: string | null) => (p === "injaewon" ? "english" : p);
  const learnedTeacher = teacherTypeGroups([...byRaw].flatMap(([raw, r]) => {
    const type = typeOf(raw);
    return type ? [{ type, group: groupOfProgram(classify0(r.desc)), weight: r.weight }] : [];
  }));
  const eieNames = new Set<string>();
  const otherNames = new Set<string>();
  const labels = new Map<string, string>();
  const eieOverDecided: string[] = []; // 시트 EIE가 이름 판정(수학·그 밖 과목)을 덮은 반 — 드라이런에 보인다
  for (const [raw, r] of byRaw) {
    const type = typeOf(raw);
    if (rules.otherNames.some((re) => re.test(raw)) || (type && rules.other.includes(type))) {
      otherNames.add(raw);
      continue;
    }
    const named = classify0(r.desc);
    const byName = rules.nameSubjects[raw.trim()];
    if (byName && named === null) {
      labels.set(raw.trim(), byName);
      continue;
    }
    if (!type) continue;
    const bySubject = classTypeGroup(type, subjects);
    // 강사형 반형태에서 배운 과목은 이름 판정이 모름일 때만 — EiE로 배워도 그 강사의 인재원·수학 반을 덮지 않는다.
    const g = bySubject ?? (isTeacherClassType(type) && named === null ? learnedTeacher.get(type) : undefined) ?? null;
    if (g === "eie") {
      if (isEieLesson(r.desc)) continue;
      eieNames.add(raw);
      if (named !== null && named !== "injaewon") eieOverDecided.push(`${raw.trim()}(${named})`);
    } else if (g) labels.set(raw.trim(), g); // 판정기는 트림한 수업명을 받는다(`lessonKinds`)
  }
  const rowsOf = (s: Iterable<string>) => [...s].reduce((n, raw) => n + (byRaw.get(raw)?.weight ?? 0), 0);
  const filled = [...byRaw].filter(([raw, r]) => labels.has(raw.trim()) && classify0(r.desc) === null).map(([raw]) => raw);
  console.log(`반형태: 수납명 ${[...byRaw.keys()].filter((r) => typeOf(r)).length}/${byRaw.size}개에 있음 · 강사형 과목 배움 ${[...learnedTeacher].map(([t, g]) => `${t.split(" ")[0]}=${g}`).join(" ")}`);
  console.log(`  기타로 ${otherNames.size}개(${rowsOf(otherNames)}줄) · EiE로 ${eieNames.size}개(${rowsOf(eieNames)}줄) · 모름 → 반형태 과목 ${filled.length}개(${rowsOf(filled)}줄)`);
  console.log(`  기타로 간 수납명: ${[...otherNames].map((raw) => `${raw.trim()}(${byRaw.get(raw)!.weight})`).join(" · ") || "없음"}`);
  if (eieOverDecided.length) console.log(`  ⚠️ 시트 EIE가 이름 판정을 덮음: ${eieOverDecided.join(" · ")}`);
  const { hist, stitched } = build({ eie: eieNames, other: otherNames });
  const classify = lessonProgramClassifier(lessonNameWeights(stitched), subjects, allStaff, labels);
  const unknownRows = new Map<string, number>();
  for (const i of hist) {
    if (i.period! > THROUGH) continue;
    for (const l of i.line_items) if (l.kind === "수업" && (l.amount > 0 || l.paid > 0) && !isEieLesson(l.description) && !classify(l.description.trim())) unknownRows.set(l.description.trim(), (unknownRows.get(l.description.trim()) ?? 0) + 1);
  }
  const unknownTop = [...unknownRows].sort((a, b) => b[1] - a[1]);
  console.log(`  남은 과목 모름 수업명 ${unknownTop.length}개(${unknownTop.reduce((s, [, n]) => s + n, 0)}줄) — 상위: ${unknownTop.slice(0, 8).map(([n, c]) => `${n}(${c})`).join(" · ") || "없음"}`);
  // 검증 — 첫 판정에서 정해진 수업명은 다시 센 판정에서도 같아야 한다(반형태는 모름만 메운다 · 기타·EiE로 보낸 이름은 빼고).
  const drift = [...byRaw].filter(([raw]) => !otherNames.has(raw) && !eieNames.has(raw))
    .map(([, r]) => r.desc).filter((d) => classify0(d) !== null && classify(d) !== classify0(d));
  console.log(`  검증(정해진 수업명 판정 바뀜 = 0이어야): ${drift.length}${drift.length ? ` — ${drift.slice(0, 8).join(" · ")}` : ""}`);
  // --explain=<정규식> — 맞는 수납명마다 청구 기간·줄 수·최종 판정·반형태(원장 확인용 · 반 이름만, 학생 정보 없음).
  if (EXPLAIN) {
    const re = new RegExp(EXPLAIN);
    const span = new Map<string, [string, string]>();
    for (const b of bills) {
      const raw = String(b.item_name ?? "");
      if (!byRaw.has(raw) || !re.test(raw)) continue;
      const m = ym(b.bill_month);
      const s = span.get(raw);
      span.set(raw, s ? [m < s[0] ? m : s[0], m > s[1] ? m : s[1]] : [m, m]);
    }
    for (const [raw, [a, z]] of [...span].sort((x, y) => x[1][0].localeCompare(y[1][0]))) {
      const verdict = otherNames.has(raw) ? "기타" : eieNames.has(raw) ? "eie" : (classify(byRaw.get(raw)!.desc) ?? "모름");
      console.log(`  설명 ${raw.trim()} | ${a}~${z} | ${byRaw.get(raw)!.weight}줄 | ${verdict} | 반형태 ${typeOf(raw) ?? "-"}`);
    }
  }
  const thisMonth = kstMonth();
  const allMonths = monthsBetween(FROM, thisMonth);
  const histMonths = monthsBetween(FROM, THROUGH);

  // ③ 건너뛸 달 — 한 번 세어 본 학생 수로 판정
  const first = aywaHistoryMonths({ months: histMonths, invoices: hist, registrations: [], started: new Set(), classify });
  const skip = new Set(lowBillingMonths(new Map(first.map((r) => [r.month, r.data.payingTotal ?? 0])), histMonths));
  console.log(`건너뛸 달: ${[...skip].join(", ") || "없음"}`);
  const rows = aywaHistoryMonths({ months: allMonths, invoices: stitched, registrations: [], started: new Set(), classify, skipMonths: skip })
    .filter((r) => r.month <= THROUGH);

  // ── 등록·실제 신규(메이크에듀 규칙 — 결정 students.md: 입학일 달 이후 살아 있는 수업료 청구 · 직전 두 달 청구가 있던 학생 제외) ──
  // 수업료 청구가 있는 달 = 학생 수 칸과 같은 판정(`lessonKinds`) · 건너뛴 달의 청구도 넣는다(학생 수 칸만 비웠을 뿐 청구는 진짜다).
  const paidMonths = new Map<string, Set<string>>();
  for (const i of stitched) {
    const k = lessonKinds(i.line_items, i.amount_total);
    if (!k.general && !k.eie) continue;
    (paidMonths.get(i.student_id) ?? paidMonths.set(i.student_id, new Set()).get(i.student_id)!).add(i.period!);
  }
  const reg = new Map<string, number>();
  const real = new Map<string, number>();
  for (const l of links) {
    if (!l.enrolled_on) continue;
    const m = ym(l.enrolled_on as Date);
    if (m < FROM || m > THROUGH) continue;
    reg.set(m, (reg.get(m) ?? 0) + 1);
    const id = idOf.get(String(l.makeedu_no)) ?? `me:${l.makeedu_no}`;
    const set = paidMonths.get(id);
    if (!set) continue;
    const started = [...set].some((p) => p >= m);
    const before = set.has(shift(m, -1)) || set.has(shift(m, -2));
    if (started && !before) real.set(m, (real.get(m) ?? 0) + 1);
  }

  // ── 새 줄 = 다시 센 청구 칸 + 등록 칸 + 종전 enrolledRecord ──
  const next = rows.map((r) => {
    const old = oldBy.get(r.month) ?? {};
    const data: Record<string, unknown> = { ...r.data, newRegistered: reg.get(r.month) ?? 0, newReal: real.get(r.month) ?? 0 };
    if (typeof old.enrolledRecord === "number") data.enrolledRecord = old.enrolledRecord;
    return { month: r.month, data };
  });

  // ── 대조(드라이런 보고) ──
  const pick = (d: Record<string, unknown> | undefined, k: string) => (d && typeof d[k] === "number" ? (d[k] as number) : "·");
  console.log("\n달 | 학생(종전→새) | 수학 | 인재원영어 | EiE | 과목들 | 모름 | 끊김 | 등록 | 실제신규");
  for (const n of next) {
    const o = oldBy.get(n.month);
    const subj = Object.entries(n.data).filter(([k]) => k.startsWith("payingSubject:")).map(([k, v]) => `${k.slice(14)} ${v}`).join("·");
    const f = (k: string) => `${pick(o, k)}→${pick(n.data, k)}`;
    console.log(`${n.month}${n.data.skippedPaying ? "(비움)" : ""} | ${f("payingTotal")}(${f("payingGeneral")}) | ${f("payingMath")} | ${f("payingInjaewon")} | ${f("payingEie")} | ${subj || "-"} | ${f("payingUnknown")} | ${f("stoppedPaying")} | ${f("newRegistered")} | ${f("newReal")}`);
  }
  // 검증 — 같은 함수로 에이와 2026을 다시 세면 저장된 에이와 줄과 같아야 한다(학생 수 칸).
  const aywa = new Map(stored.filter((r) => r.source === "aywa").map((r) => [r.m as string, r.data as Record<string, number>]));
  const aywaClassify = lessonProgramClassifier(lessonNameWeights(appInv), subjects, staff);
  const appMonths = [...aywa.keys()].sort();
  const re = aywaHistoryMonths({ months: appMonths, invoices: appInv, registrations: [], started: new Set(), classify: aywaClassify });
  const keys = ["payingTotal", "payingGeneral", "payingEie", "payingMath", "payingInjaewon", "payingOther", "payingUnknown"];
  const bad = re.filter((r) => keys.some((k) => (r.data[k] ?? null) !== (aywa.get(r.month)?.[k] ?? null)));
  console.log(`\n검증(에이와 ${appMonths.length}개월 다시 세기 = 저장값): ${bad.length ? `다름 ${bad.map((r) => r.month).join(",")}` : "모두 같음"}`);

  if (!APPLY) {
    console.log("\n드라이런 — 쓰지 않았다(--apply로 쓴다).");
  } else {
    if (bad.length || drift.length) throw new Error("검증이 어긋나 쓰지 않는다");
    mkdirSync(BACKUP_DIR, { recursive: true });
    const file = join(BACKUP_DIR, `history-monthly-${SLUG}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    writeFileSync(file, JSON.stringify({
      tenantId: t,
      rows: makeeduRows.filter((r) => (r.m as string) <= THROUGH).map((r) => ({ month: r.m, data: r.data, computed_at: r.computed_at })),
      written: next.map((n) => n.month), // 되돌릴 때 백업에 없던 달(새로 넣은 줄)을 지운다
    }, null, 1));
    console.log(`백업: ${file}`);
    const now = new Date().toISOString();
    await sql.begin(async (tx) => {
      for (const n of next) {
        await tx`insert into public.student_history_monthly (tenant_id, month, source, data, computed_at)
          values (${t}, ${`${n.month}-01`}::date, 'makeedu', ${tx.json(n.data as never)}, ${now})
          on conflict (tenant_id, month, source) do update set data = excluded.data, computed_at = excluded.computed_at`;
      }
    });
    const back = await sql`select count(*)::int n from public.student_history_monthly where tenant_id=${t} and source='makeedu' and month <= ${`${THROUGH}-01`}::date and computed_at=${now}`;
    console.log(`썼다: 메이크에듀 줄 ${back[0]!.n}/${next.length} · 되돌리기: --revert=${file}`);
  }
} finally {
  if (READ_ONLY) await sql`reset all`.catch(() => {}); // 풀러 연결에 세션 설정을 남기지 않는다
  await sql.end();
}
