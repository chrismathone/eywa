import "server-only";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canAccessTenant, canWriteTenant } from "@/lib/auth/perm-matrix";
import { readonlyTeacherViewError } from "@/lib/auth/view-as";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged, fetchAllPagedInChunks, fetchInChunks } from "@/lib/supabase/batch";
import { kstToday } from "@/lib/date-kst";
import { getTenantSettings } from "@/features/owner/server/queries";
import { isChinsanTenant } from "@/features/owner/preset";
import baseline from "./historical-baseline.json";
import { sectionResult } from "@/features/students/ontology/live-contract";
import { canSeeStudentEnrollment } from "@/features/students/server/enrollment-gate";
import { saveJourneySchema, validateJourneyDates, summarizeJourney, kinds, statuses, eventDay, inquiryDay, type JourneyConsultation, type JourneyIdentity, type JourneyRecord } from "./model";

/**
 * 신규 콜&상담 여정 — 전화·방문·등록 확인 기록(aywa-next 인계 이식 · s2_0062 · 서버 전용 표).
 * 🔴 상담은 **사용자 클라이언트(RLS)** 로 먼저 읽어 열람 범위를 정하고, 기록 표는 admin + tenant_id로 읽되 그 상담에 걸린 것만 남긴다.
 * 쓰기는 `save_enrollment_journey` 한 함수(기록 + 이력 한 트랜잭션 · version 비교).
 * '다른 강사 뷰'면 그 강사로 판정하고 기록 명의도 그 강사다(#154 — 신규생 관리와 같은 규칙).
 */
export async function journeyAccess(write = false) {
  const user = await getCurrentUser({ teacherView: true });
  if (!user || !await canAccessTenant(user.systemRole, "enrollment")) throw Error("신규 콜&상담 열람 권한이 필요합니다");
  if (write && (user.tenantView || await readonlyTeacherViewError() || !await canWriteTenant(user.systemRole, "enrollment")))
    throw Error("이 화면에서는 기록을 수정할 수 없습니다");
  return user;
}

const consultColumns = "id,prospect_name,prospect_school,prospect_grade,parent_phone,student_id,consulted_at,received_date,consultation_date,consultation_path,outcome,counselor,consultant_id,legacy_source";
const recordColumns = "id,consultation_id,version,document,voided,updated_at,actor_id";
const choiceColumns = "id,prospect_name,prospect_school,prospect_grade,student_id,consulted_at,received_date,consultation_date,consultation_path";

/** KST 날짜의 0시를 UTC 시각 글자로(주소에 `+`가 들어가지 않게 Z 표기). */
const kstMidnightUtc = (day: string) => new Date(`${day}T00:00:00+09:00`).toISOString();

/**
 * 읽는 범위 — 상담 상세 칸(consultationId)은 그 상담 하나. 점검 화면은 **고른 연도**만:
 *  · 상담 본문 = 접수일(없으면 상담 시각의 KST 날짜)이 그 해인 것(오늘 뒤 날짜로 적힌 것 포함 — 월별 '미확인'이 센다) + 아래 기록이 걸린 상담
 *  · 기록 = 실제일·예정일이 그 해인 것 + 끝나지 않은 후속 업무·결과 확인 전 예약(지난 해 것도 지금 챙길 일) + 그 해 상담에 걸린 기록 전부
 *  · 같은 사람 판정 = **지점 전체 상담의 열쇠 칸 넷**(id·연결 원생·이름·보호자 연락처) — 묶음이 다른 해 상담을 거쳐 이어져서
 *    그 해 상담만으로는 방문 대상 수·전환율이 달라진다(model.ts `summarizeJourney`). 본문·기록은 줄이고 열쇠만 전건으로 둔다.
 *  · 새 기록을 걸 상담 선택지 = 그 해 + **바로 앞 해** 접수 상담(12월 문의 → 1월 방문처럼 해를 넘기는 기록) — 선택지에 쓰는 칸만 따로 읽는다.
 *    더 오래된 상담은 그 상담 상세의 기록 칸에서 건다.
 * 전에는 연도와 무관하게 지점의 상담 본문·기록을 전부 읽었다(해마다 커진다 — 2026-11-11 검토). 집계 결과는 전건으로 읽던 때와 같다.
 */
export async function loadJourney(consultationId?: string, year?: number) {
  const user = await journeyAccess(), db = await createClient(), admin = createAdminClient(), today = kstToday();
  if (consultationId && !z.uuid().safeParse(consultationId).success) throw Error("상담을 확인해 주세요");
  const thisYear = Number(today.slice(0, 4));
  const selectedYear = year && year >= 2021 && year <= thisYear ? year : thisYear;
  const from = `${selectedYear}-01-01`, through = selectedYear === thisYear ? today : `${selectedYear}-12-31`;
  const tenant = user.tenantId;
  const consults = () => db.from("enrollment_consultations").select(consultColumns).eq("tenant_id", tenant);
  const journal = () => admin.from("enrollment_journey_records").select(recordColumns).eq("tenant_id", tenant);
  // 🔴 조회 빌더는 기다릴 때마다 요청을 다시 보낸다 — 한 번만 기다린다(아래 Promise.all 안에서).
  const staffQuery = () => db.from("users").select("id,display_name,status,system_role").eq("tenant_id", tenant)
    .in("system_role", ["master", "admin", "manager", "teacher", "counselor"]).order("display_name");

  type ChoiceRow = Pick<JourneyConsultation, "id" | "prospect_name" | "prospect_school" | "prospect_grade" | "student_id" | "consulted_at" | "received_date" | "consultation_date" | "consultation_path">;
  let rows: JourneyConsultation[], records: JourneyRecord[], identity: readonly JourneyIdentity[], earlier: ChoiceRow[] = [];
  let staff: Awaited<ReturnType<typeof staffQuery>>;
  /** 2021–2026 검증 자료(첨부 분석 스냅샷)가 이 지점의 것인가 — 점검 화면에서만 판정한다. */
  let ownsBaseline = false;
  if (consultationId) {
    [rows, records, staff] = await Promise.all([
      fetchAllPaged<JourneyConsultation>((a, b) => consults().eq("id", consultationId).order("id").range(a, b)),
      fetchAllPaged<JourneyRecord>((a, b) => journal().eq("consultation_id", consultationId).order("id").range(a, b)),
      staffQuery(),
    ]);
    if (!rows.length) throw Error("상담을 찾을 수 없거나 열람 권한이 없습니다");
    identity = rows; // 상담 상세 칸은 집계를 그리지 않는다.
  } else {
    // 접수일 범위 [lo, hi) — 접수일이 없으면 상담 시각의 KST 날짜(model.ts `inquiryDay`와 같은 뜻).
    const inquiredIn = (lo: string, hi: string) =>
      `and(received_date.gte.${lo},received_date.lt.${hi}),and(received_date.is.null,consulted_at.gte.${kstMidnightUtc(lo)},consulted_at.lt.${kstMidnightUtc(hi)})`;
    // 🔴 그 해 상담은 **연말까지**(오늘까지가 아니라) — 월별 '미확인'은 이번 달의 남은 날짜로 적힌 상담도 센다(전건으로 읽던 때와 같게).
    const yearStart = from, nextYearStart = `${selectedYear + 1}-01-01`, prevYearStart = `${selectedYear - 1}-01-01`;
    const dated = `and(document->>happenedOn.gte.${from},document->>happenedOn.lte.${through}),and(document->>scheduledOn.gte.${from},document->>scheduledOn.lte.${through}),and(document->>nextDue.not.is.null,document->>nextDoneOn.is.null),document->>status.eq.scheduled`;
    const [yearRows, datedRecords, identityRows, earlierRows, staffRead, settingsRead] = await Promise.all([
      fetchAllPaged<JourneyConsultation>((a, b) => consults().or(inquiredIn(yearStart, nextYearStart)).order("id").range(a, b)),
      fetchAllPaged<JourneyRecord>((a, b) => journal().or(dated).order("id").range(a, b)),
      fetchAllPaged<JourneyIdentity>((a, b) => db.from("enrollment_consultations").select("id,student_id,prospect_name,parent_phone").eq("tenant_id", tenant).order("id").range(a, b)),
      fetchAllPaged<ChoiceRow>((a, b) => db.from("enrollment_consultations").select(choiceColumns).eq("tenant_id", tenant).or(inquiredIn(prevYearStart, yearStart)).order("id").range(a, b)),
      staffQuery(),
      getTenantSettings(),
    ]);
    const have = new Set(yearRows.map((r) => r.id)), seen = new Set(datedRecords.map((r) => r.id));
    // 서로의 나머지 — 그 해 상담의 다른 해 기록(방문 여부 판정) · 기록이 걸린 다른 해 상담(이름·같은 사람 판정). id 목록은 청크로(B3).
    const [ownRecords, otherRows] = await Promise.all([
      fetchAllPagedInChunks<JourneyRecord>([...have], (chunk, a, b) => journal().in("consultation_id", chunk).order("id").range(a, b)),
      fetchInChunks<JourneyConsultation>([...new Set(datedRecords.map((r) => r.consultation_id))].filter((id) => !have.has(id)),
        (chunk) => consults().in("id", chunk)),
    ]);
    rows = [...yearRows, ...otherRows];
    records = [...datedRecords, ...ownRecords.filter((r) => !seen.has(r.id))];
    identity = identityRows;
    earlier = earlierRows;
    staff = staffRead;
    ownsBaseline = isChinsanTenant(settingsRead);
  }
  if (staff.error) throw Error("담당자 목록을 불러오지 못했습니다");
  const visible = new Set(rows.map((r) => r.id)), safe = records.filter((r) => visible.has(r.consultation_id));
  const summary = summarizeJourney(rows, safe, from, through, identity);
  // 선택지 = 본문을 읽은 상담(그 해 + 기록이 걸린 상담) + 바로 앞 해 접수 상담. 최근 접수가 위로 오게 세운다(같은 날은 이름순).
  const choiceRows: ChoiceRow[] = [...rows, ...earlier.filter((r) => !visible.has(r.id))];
  const choices = choiceRows
    .map((r) => ({ r, day: inquiryDay(r) }))
    .sort((x, y) => y.day.localeCompare(x.day) || x.r.prospect_name.localeCompare(y.r.prospect_name, "ko") || x.r.id.localeCompare(y.r.id))
    .map(({ r, day }) => ({ id: r.id, name: r.prospect_name, label: `${r.prospect_name} · ${r.prospect_school ?? "학교 미기재"} ${r.prospect_grade ?? ""} · ${day}`, studentId: r.student_id ?? null, legacyDate: r.consultation_date, path: r.consultation_path }));
  const canWrite = !user.tenantView && !await readonlyTeacherViewError() && await canWriteTenant(user.systemRole, "enrollment");
  // 2021–2026 검증 자료(첨부 분석 스냅샷)는 **침산의 집계**다 — 다른 지점 화면엔 싣지 않는다(탭도 안 선다). 지점 판정은 설정 행(preset) 한 곳.
  const history = ownsBaseline
    ? { asOf: baseline.asOf, source: baseline.source, range: baseline.range, seasonality: baseline.seasonality, monthly: baseline.monthly.filter((m) => m.month.startsWith(String(selectedYear))) }
    : null;
  // 연락처는 서버의 같은 사람 판정에만 쓴다 — 화면으로 보내는 값에 싣지 않는다.
  return { today, year: selectedYear, through, summary, records: safe, choices, staff: staff.data, currentUser: user.id, canWrite, consultationId: consultationId ?? null, history };
}
export type JourneyData = Awaited<ReturnType<typeof loadJourney>>;

export async function saveJourney(raw: unknown) {
  const input = saveJourneySchema.parse(raw), user = await journeyAccess(true), db = await createClient();
  const dateError = validateJourneyDates(input.document, kstToday());
  if (dateError) throw Error(dateError);
  const target = await db.from("enrollment_consultations").select("id").eq("tenant_id", user.tenantId).eq("id", input.consultationId).maybeSingle();
  if (target.error || !target.data) throw Error("상담을 찾을 수 없거나 기록 권한이 없습니다");
  const { data, error } = await createAdminClient().rpc("save_enrollment_journey", {
    p_tenant: user.tenantId, p_actor: user.id, p_consultation: input.consultationId, p_id: input.id,
    p_expected: input.expectedVersion, p_document: input.document, p_voided: input.voided, p_reason: input.reason,
  });
  if (error) {
    if (error.code !== "40001") console.error("[enrollment.journey.save]", error.code, error.message);
    throw Error(error.code === "40001" ? "다른 담당자가 변경했습니다. 새로고침 후 다시 확인해 주세요" : "저장하지 못했습니다. 날짜와 담당자를 확인해 주세요");
  }
  return data;
}

export async function journeyHistory(id: string) {
  if (!z.uuid().safeParse(id).success) throw Error("기록을 확인해 주세요");
  const user = await journeyAccess(), admin = createAdminClient();
  const r = await admin.from("enrollment_journey_records").select("consultation_id").eq("tenant_id", user.tenantId).eq("id", id).maybeSingle();
  if (r.error || !r.data) throw Error("기록을 확인해 주세요");
  // 상담 열람 범위(RLS)를 다시 본다 — 기록 id만 알아도 이력이 열리지 않게.
  const check = await (await createClient()).from("enrollment_consultations").select("id").eq("tenant_id", user.tenantId).eq("id", r.data.consultation_id).maybeSingle();
  if (check.error || !check.data) throw Error("기록 열람 권한을 확인해 주세요");
  const history = await admin.from("enrollment_journey_revisions").select("version,document,voided,actor_id,reason,recorded_at")
    .eq("tenant_id", user.tenantId).eq("record_id", id).order("version", { ascending: false });
  if (history.error) throw Error("변경 이력을 불러오지 못했습니다");
  return history.data;
}

/** 학생 통합 기록의 '전화·방문·등록 확인 기록' 칸 — 그 학생에게 이어진 상담의 기록(집계 제외 기록은 뺀다). */
export async function studentJourneySection(studentId: string) {
  const user = await journeyAccess();
  if (!await canSeeStudentEnrollment(user.systemRole, studentId)) throw Error("학생 입학상담 열람 권한이 필요합니다");
  const db = await createClient(), admin = createAdminClient();
  const c = await db.from("enrollment_consultations").select("id").eq("tenant_id", user.tenantId).eq("student_id", studentId);
  if (c.error) throw Error("연결 상담을 확인하지 못했습니다");
  const ids = (c.data ?? []).map((r) => r.id);
  const records = await fetchAllPagedInChunks<JourneyRecord>(ids, (chunk, a, b) => admin.from("enrollment_journey_records").select(recordColumns)
    .eq("tenant_id", user.tenantId).in("consultation_id", chunk).eq("voided", false).order("id").range(a, b));
  return sectionResult("admissionJourney", "전화·방문·등록 확인 기록", "/enrollment/visits", records.map((r) => ({
    id: r.id, title: `${kinds[r.document.kind]} · ${statuses[r.document.status]}`, date: eventDay(r),
    detail: `${r.document.evidence}${r.document.nextAction ? ` / 후속: ${r.document.nextAction} (${r.document.nextDoneOn ? "완료" : "진행 중"})` : ""}`,
    evidence: [{ source: "enrollment_journey_records", id: r.id, studentId, href: `/enrollment/${r.consultation_id}#journey` }],
  })), records.length);
}
