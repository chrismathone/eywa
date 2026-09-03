import "server-only";

/**
 * 보이지 않는 '보강' 반의 **조회·생성** — 규약과 "왜 이렇게 하나"는 순수부에 있다:
 * [`features/classes/makeup-pool.ts`](@/features/classes/makeup-pool). 여기 오기 전에 그걸 먼저 읽을 것.
 *
 * 🔴 **생성은 보강을 실제로 기록할 때만**(lazy) — 강사 목록을 훑어 미리 만들지 않는다. 안 그러면 보강을
 *    한 번도 안 한 강사에게까지 빈 반이 생기고, 그 반은 아무 데도 안 보이니 **아무도 지우지 못한다**.
 * 🔴 **admin 클라이언트로 쓴다** — 이 반은 사람이 만드는 반이 아니라 강사 권한으로는 반 생성이 막혀 있다.
 *    admin은 RLS 우회라 **모든 조회·쓰기에 `tenant_id` 명시 필터가 필수**다([[#104]]).
 * ⚠️ 0241a 미적용이면 `is_makeup_pool` 컬럼이 없어 조회·생성이 실패한다 → **null을 돌려주고 조용히 넘어간다**
 *    (보강 출결이 안 남을 뿐, 보고서 저장·발송은 그대로 된다. [[#95]] expand/contract).
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { makeupPoolName, pickMakeupOwner } from "@/features/classes/makeup-pool";

/**
 * 보강 보고서 한 건의 **귀속 강사**(누구의 보강 반에 앉는가) — 규칙은 순수부 `pickMakeupOwner` 주석.
 *
 * 🔴 저장자(`user`)를 그대로 넘기지 말 것 — 사무실이 강사 대신 저장하면 보강 반이 사무실 앞으로 생긴다.
 *    저장된 행의 `created_by`(트리거 보존)·`teacher_name`을 넘기고, 못 풀면 **null = 훅을 건너뛴다**
 *    (잘못된 반을 만드는 것보다 안 만드는 게 낫다 — 소급 스크립트가 같은 규칙으로 채울 수 있다).
 * ⚠️ admin은 RLS 우회라 모든 조회에 `tenant_id` 필터([[#104]]). 조회 실패는 null(보고서 저장은 이미 끝났다).
 */
export async function resolveMakeupOwner(input: {
  tenantId: string;
  createdBy: string | null | undefined;
  teacherName: string | null | undefined;
  saver: { id: string; name: string | null };
}): Promise<{ id: string; name: string | null } | null> {
  const admin = createAdminClient();
  const name = input.teacherName ?? "";
  // 이름 조회는 created_by가 비었을 때만(그때만 규칙이 이름을 본다) — 평소 왕복 0.
  let sameName: { id: string; display_name: string | null }[] = [];
  if (!input.createdBy && name.trim()) {
    // 🔴 raw 정확 일치·활성·학생 계정 제외 — resolveReportAuthorName과 같은 직원 풀 규약. 2명이면 모호.
    const { data, error } = await admin
      .from("users")
      .select("id, display_name")
      .eq("tenant_id", input.tenantId)
      .eq("display_name", name)
      .eq("status", "active")
      .neq("system_role", "student")
      .limit(2);
    if (error) {
      console.error("[makeup-pool] 소유자 이름 조회 실패", error.message);
      return null;
    }
    sameName = (data ?? []) as { id: string; display_name: string | null }[];
  }
  const pick = pickMakeupOwner({
    createdBy: input.createdBy,
    teacherName: input.teacherName,
    sameName,
    saver: input.saver.id,
  });
  if (!pick) return null;
  if (pick.via === "saver") return { id: input.saver.id, name: input.saver.name };
  if (pick.via === "teacher_name") {
    return { id: pick.id, name: sameName.find((u) => u.id === pick.id)?.display_name ?? name };
  }
  // created_by — 반 이름에 쓸 표시 이름을 그 계정에서 읽는다. 이 학원에 없는 계정이면(삭제·타 테넌트) 만들지 않는다.
  const { data: owner, error } = await admin
    .from("users")
    .select("id, display_name")
    .eq("tenant_id", input.tenantId)
    .eq("id", pick.id)
    .maybeSingle();
  if (error) {
    console.error("[makeup-pool] 소유자 계정 조회 실패", error.message);
    return null;
  }
  if (!owner?.id) return null;
  return { id: owner.id as string, name: (owner.display_name as string | null) ?? null };
}

/** 0241a 미적용 판별 — PostgREST는 없는 컬럼을 42703(또는 PGRST204)로 돌려준다. */
function isMissingColumn(e: { code?: string; message?: string } | null | undefined): boolean {
  return e?.code === "42703" || e?.code === "PGRST204" || /is_makeup_pool/.test(e?.message ?? "");
}

/**
 * 그 강사의 보강 반 id — 없으면 만들어서 돌려준다. 실패·미적용이면 null.
 *
 * @param subject 이 반의 과목 — 보강 보고서의 과목을 그대로 쓴다(수학 강사의 보강 반은 math).
 *   ⚠️ 과목은 표시·필터용이고 귀속과 무관하다. 강사가 두 과목을 가르쳐도 반은 **하나**다
 *      (강사당 1개 유니크 — 과목마다 만들면 같은 보강이 두 묶음으로 갈라진다).
 */
export async function ensureMakeupPoolClass(input: {
  tenantId: string;
  teacherId: string;
  teacherName: string | null;
  subject: string;
}): Promise<string | null> {
  const admin = createAdminClient();
  // ① 있으면 그대로 쓴다(부분 유니크라 `on conflict` 추론이 안 돼 upsert를 못 쓴다 — [[#113]]).
  const { data: found, error: findErr } = await admin
    .from("classes")
    .select("id")
    .eq("tenant_id", input.tenantId)
    .eq("teacher_id", input.teacherId)
    .eq("is_makeup_pool", true)
    .maybeSingle();
  if (findErr) {
    if (isMissingColumn(findErr)) return null; // 0241a 미적용 — 조용히 넘어간다.
    console.error("[makeup-pool] 보강 반 조회 실패", findErr.message);
    return null;
  }
  if (found?.id) return found.id as string;

  // ② 없으면 만든다. 🔴 `is_active=false`가 "어디에도 안 보이게" 하는 주 장치다(순수부 참조).
  //    교시·수강은 만들지 않는다 — 있으면 '미입력 반' 신호와 명단·청구가 흔들린다.
  const { data: created, error: insErr } = await admin
    .from("classes")
    .insert({
      tenant_id: input.tenantId,
      class_name: makeupPoolName(input.teacherName),
      subject: input.subject,
      teacher_id: input.teacherId,
      is_active: false,
      is_makeup_pool: true,
    })
    .select("id")
    .single();
  if (insErr) {
    // 동시 저장 경합(같은 강사가 두 칸을 한꺼번에 저장) — 유니크가 막았으면 다시 읽어 그걸 쓴다.
    if (insErr.code === "23505") {
      const { data: again } = await admin
        .from("classes")
        .select("id")
        .eq("tenant_id", input.tenantId)
        .eq("teacher_id", input.teacherId)
        .eq("is_makeup_pool", true)
        .maybeSingle();
      return (again?.id as string | undefined) ?? null;
    }
    if (isMissingColumn(insErr)) return null;
    console.error("[makeup-pool] 보강 반 생성 실패", insErr.message);
    return null;
  }
  return (created?.id as string | undefined) ?? null;
}

/**
 * 그 강사의 보강 반 id — **만들지 않는다**(읽기 전용 화면용). 없으면 null.
 * 출석부가 묶음을 그릴 때 쓴다: 보강을 한 적 없는 강사에겐 반이 없고, 그러면 묶음도 안 선다(정상).
 */
export async function findMakeupPoolClass(tenantId: string, teacherId: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("classes")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("teacher_id", teacherId)
    .eq("is_makeup_pool", true)
    .maybeSingle();
  if (error) return null; // 미적용·실패 = 묶음 없음(화면은 종전과 같다).
  return (data?.id as string | undefined) ?? null;
}

/**
 * 보강 보고서 한 건에 대해 **출석부 칸을 만든다**(없을 때만).
 *
 * 원장 2026-09-02: *"보고서 발송건에 대해서는 자동 입력 되어야지"* + *"실제로 수업을 했는데 출석부에
 * 시수가 없으면 이상하지."* — 보고서를 쓰면 그날 그 학생이 보강 반에 **출석**으로 한 칸 선다.
 *
 * 🔴 **이미 있는 칸은 절대 안 덮는다.** 강사가 나중에 결석·시수로 고쳐 뒀을 수 있다(원장: *"발송 날자에
 *    대해서는 수정할수도 있어야하고"*). 자동 입력은 **빈 칸을 채우는 것**이지 사람 손을 이기는 게 아니다.
 * 🔴 상태는 `makeup` — `present`가 아니다. 정규 출석과 섞이면 그 반 명단·출석률이 흔들리고, 보강 칸은
 *    이미 앱 전체가 아는 상태값이다(색·집계·`COUNTABLE_STATUSES` 전부 준비돼 있다).
 * ⚠️ 시수는 기본 1이다 — 확인창에서 고른 시수는 그 경로(원스크린)가 따로 넘긴다. 여기 오는 건
 *    "보고서만 쓰고 출결은 안 찍은" 경우라 기본값이 맞다(고치는 건 사람 몫).
 * ⚠️ 실패해도 **보고서 저장을 되돌리지 않는다** — 보고서가 본 일이고 출결은 그 위의 기록이다.
 */
export async function ensureMakeupAttendanceForReport(input: {
  tenantId: string;
  teacherId: string;
  teacherName: string | null;
  studentId: string;
  subject: string;
  date: string;
  /** 확인창에서 고른 시수(원스크린 경로) — 없으면 기본 1(컬럼을 비워 둔다). */
  units?: number | null;
}): Promise<{ ok: boolean; classId?: string }> {
  const admin = createAdminClient();

  // ② **그 강사가 그 학생을 그날 이미 찍었으면** 만들지 않는다 — 같은 수업을 두 번 세지 않기 위해서다.
  //
  // 🔴 판정 축은 "어느 반이든"이 아니라 **강사**다(원장 제보 2026-09-02: *"수업보고서는 1개인데, 실제
  //    출석부는 시수합이 같은 학생에 대해 2가 되는 버그"*). 실측 2026-09-01~02 세 건이 축을 정해 줬다:
  //     · 김승언 — 김은정이 보고서를 쓰고 **자기 반(CR1C)에 `present`로** 손수 찍어 뒀다. 같은 수업이다 → 만들면 2.
  //     · 정채민 — 이수진이 **자기 반에 `makeup`으로** 찍어 뒀다. 같은 수업이다 → 만들면 2.
  //     · 이채아 — 김은정 보강 보고서 + **김윤하**가 자기 반(JJ3J, 그날이 정규 수요일)에 `present`.
  //       **서로 다른 두 수업**이다 → 여기서 막으면 김은정이 실제로 한 보강의 시수가 사라진다.
  //    그래서 상태(`makeup`)로 가르면 첫째를 놓치고, "어느 반이든"으로 가르면 셋째를 잘못 막는다.
  // 🔴 `status`로 좁히지 않는다 — 손으로 찍을 땐 `present`가 더 흔하다(김승언).
  //    결석·조퇴 등도 "그날 그 강사가 이미 판단했다"는 뜻이라 그 위에 덧쓰지 않는다.
  // 🔑 반을 만들기 **전**에 본다 — 안 그러면 보강을 전부 자기 반에 찍는 강사에게 빈 보강 반이 생긴다(lazy 원칙).
  // ⚠️ 축은 **담임**(`classes.teacher_id`)이다. 수학은 교시 담당이 전 슬롯 미지정이라 이게 곧 귀속이고,
  //    소급 스크립트(`backfill-makeup-attendance.mjs`)도 같은 판정을 쓴다.
  const { data: mine, error: mineErr } = await admin
    .from("attendance_records")
    .select("id, classes!attendance_records_class_id_classes_id_fk(teacher_id)")
    .eq("tenant_id", input.tenantId)
    .eq("student_id", input.studentId)
    .eq("session_date", input.date);
  if (mineErr) {
    console.error("[makeup-pool] 그날 출결 조회 실패", mineErr.message);
    return { ok: false };
  }
  const alreadyByThisTeacher = (mine ?? []).some((r) => {
    const c = (r as { classes?: { teacher_id?: string | null } | { teacher_id?: string | null }[] }).classes;
    const row = Array.isArray(c) ? c[0] : c;
    return row?.teacher_id === input.teacherId;
  });
  if (alreadyByThisTeacher) return { ok: true }; // 그 강사가 이미 찍었다 — 그대로 둔다.

  const classId = await ensureMakeupPoolClass({
    tenantId: input.tenantId,
    teacherId: input.teacherId,
    teacherName: input.teacherName,
    subject: input.subject,
  });
  if (!classId) return { ok: false }; // 0241a 미적용 등 — 조용히 넘어간다(보고서는 이미 저장됐다).

  // ① 그 보강 반의 (학생, 날짜) 칸 — 상태 불문(결석·시수로 고쳐 둔 값일 수 있다).
  const { data: exists, error: readErr } = await admin
    .from("attendance_records")
    .select("id")
    .eq("tenant_id", input.tenantId)
    .eq("class_id", classId)
    .eq("student_id", input.studentId)
    .eq("session_date", input.date)
    .limit(1);
  if (readErr) {
    console.error("[makeup-pool] 보강 출결 조회 실패", readErr.message);
    return { ok: false };
  }
  if ((exists ?? []).length > 0) return { ok: true, classId }; // 있으면 그대로 둔다(사람 손이 이긴다).

  const { error: insErr } = await admin.from("attendance_records").insert({
    tenant_id: input.tenantId,
    class_id: classId,
    student_id: input.studentId,
    session_date: input.date,
    status: "makeup",
    recorded_by: input.teacherId,
    ...(input.units && input.units !== 1 ? { session_units: input.units } : {}),
  });
  if (insErr) {
    console.error("[makeup-pool] 보강 출결 저장 실패", insErr.message);
    return { ok: false };
  }
  return { ok: true, classId };
}

/**
 * 이 테넌트의 **보이지 않는 '보강' 반 id 전부** — 사무실 목록에서 빼는 데만 쓴다.
 *
 * 🔴 **컬럼 이름을 목록 쿼리의 `select`나 필터에 넣지 않으려고** 별도 조회로 뺐다. 0241a 적용 전에
 *    `is_makeup_pool`을 수업목록 쿼리에 끼워 넣으면 PostgREST가 400을 내고 **화면이 통째로 죽는다**([[#95]]).
 *    여기서 실패하면 빈 배열이라 목록은 종전과 같이(그 반이 보이는 채로) 그냥 돈다 — fail-open.
 * ⚠️ 반 수가 강사 수만큼이라(수십) `.in()` 걱정은 없다.
 */
export async function listMakeupPoolClassIds(): Promise<string[]> {
  // 세션 클라이언트 — 읽기는 RLS(테넌트 격리)가 알아서 좁힌다(admin을 쓸 이유가 없다).
  const supabase = await createClient();
  const { data, error } = await supabase.from("classes").select("id").eq("is_makeup_pool", true);
  if (error) return []; // 미적용·실패 = 아무것도 안 뺀다(목록이 죽는 것보다 낫다).
  return (data ?? []).map((r) => r.id as string);
}
