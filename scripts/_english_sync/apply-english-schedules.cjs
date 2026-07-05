// 영어 시간표 구조 동기화 — 시트(강사별영어시간표 7월) → class_schedules 재구축.
// 진실원본 = D:/영어시간표/_english-sync-artifacts/normalized_model.json (periods 275 중 유효 254).
//
// 동작(기본 dry-run, --apply 시 트랜잭션 쓰기):
//  1. 유효 슬롯 254 로드(노이즈 18 + 별표 3 제외), 시각 = start_min/end_min(정오 기준) → 24h.
//  2. 매칭: 반=이름(공백 무시), 강사=english_name→한글이름(teacher 역할 우선, 모호하면 라벨-only),
//     방=토큰→"본원"+토큰 classrooms 대조(305/605/606은 신규 생성, SKY는 라벨-only=LAB실 전례).
//  3. 적용: 기존 영어 스케줄 valid_to='2026-07-02'로 마감(temporal — 타임머신 과거 주 보존)
//     + 신규 254행 valid_from='2026-07-03' 삽입 + classes 담임/기본강의실 갱신(해석된 것만, null 덮어쓰기 금지).
//  4. 백업/언두: SCHED_BACKUP_*.json / SCHED_UNDO_*.json (아티팩트 폴더).
//
// 실행: node --env-file=.env.local scripts/_english_sync/apply-english-schedules.cjs [--apply]
// ⚠️ tenant_id + subject='english' 스코프 밖은 절대 건드리지 않는다(수학 불가침).

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const postgres = require("postgres");

const TENANT = "becaa316-e636-42e9-9d09-08b133e0b094";
// 아티팩트 경로: env 우선, 기본은 리포 내 _artifacts(git 미추적) — PC 이동 시 재현성 (2026-07-06, 구 D:/영어시간표 고정 경로 대체)
const ART_DIR = process.env.ENGLISH_SYNC_ART_DIR || path.join(__dirname, "_artifacts");
const CUTOVER = "2026-07-03"; // 새 스케줄 시작일 (enrollment 전환일과 동일)
const CLOSE_AT = "2026-07-02"; // 옛 스케줄 마지막 유효일 (fetchSlots: valid_to >= referenceDate)
const APPLY = process.argv.includes("--apply");

const NOISE = /^(쉬는\s*시간|수업\s*준비|교수부\s*미팅|연차\s*사용)/;
const DATEISH = /^(\d{4}\.|\d+(\.\d+)?$)/;
const DAY_KO = { 월: "mon", 화: "tue", 수: "wed", 목: "thu", 금: "fri", 토: "sat" };

// 신규 생성할 강의실 (실재 방 — 강사 상주. SKY는 라벨-only로 미생성 = LAB실 전례)
const ROOMS_TO_CREATE = ["본원305", "본원605", "본원606"];

function to24(minFromNoon) {
  const t = 12 * 60 + minFromNoon;
  if (!Number.isInteger(t) || t < 0 || t >= 24 * 60) throw new Error(`시각 범위 밖: ${minFromNoon}분(정오 기준)`);
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}
function nameKey(s) {
  return String(s).replace(/\s+/g, "").toLowerCase();
}
// SKY 반들의 실제 방 (시트 강사별 탭 실측 2026-07-06 — fix-sky-room-labels.cjs와 동일 매핑).
// 'SKY' 토큰을 본원SKY 라벨-only로 만들면 시트 표시와 어긋남 → 강사 기준 실방으로 해석.
const SKY_ROOM_BY_TEACHER = {
  Jane: "본원301",
  Elsa: "본원303",
  Dom: "본원303",
  Florence: "본원303",
  JJ: "본원305",
};

function roomLabel(token, teacher) {
  if (!token) return null;
  const raw = `본원${token.toUpperCase()}`;
  if (token.toUpperCase() === "SKY") return SKY_ROOM_BY_TEACHER[teacher] ?? raw;
  return raw;
}

async function main() {
  // 실행일 가드: 오늘(KST) < CUTOVER면 현재 주에 구·신 스케줄이 동시 표시된다.
  const todayKst = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(new Date());
  if (APPLY && todayKst < CUTOVER) throw new Error(`오늘(KST ${todayKst}) < CUTOVER(${CUTOVER}) — 상수 조정 필요`);

  const sql = postgres(process.env.DATABASE_URL, { ssl: "require" });
  try {
    // ── 1. 슬롯 로드 ──────────────────────────────────────────────────────────
    const model = JSON.parse(fs.readFileSync(path.join(ART_DIR, "normalized_model.json"), "utf8"));
    // 별표(*) 항목은 노이즈가 아니라 실스케줄 — 통합영어시간표가 `*LAB` 교시로 파생 표시함(정규시간 밖
    // 추가 LAB 세션, 2026-07-06 확인). 원 임포트(7/3)의 /^\*/ 제외 필터는 제거하고 별표만 벗겨 포함.
    const valid = model.periods
      .filter((p) => !NOISE.test(p.class) && !DATEISH.test(p.class))
      .map((p) => (/^\*/.test(p.class) ? { ...p, class: p.class.replace(/^\*+/, "").trim() } : p));
    console.log(`슬롯: 전체 ${model.periods.length} → 유효 ${valid.length}`);
    if (valid.length < 254) throw new Error(`유효 슬롯 254+ 기대, 실제 ${valid.length}`);

    // ── 2. 기존 레코드 로드 ────────────────────────────────────────────────────
    const classes = await sql`
      select id, class_name, teacher_id, classroom_id from classes
      where tenant_id = ${TENANT} and subject = 'english' and is_active = true`;
    const users = await sql`
      select id, display_name, english_name, system_role, status from users
      where tenant_id = ${TENANT} and status = 'active'`;
    const rooms = await sql`select id, name from classrooms where tenant_id = ${TENANT}`;

    const classByKey = new Map();
    for (const c of classes) {
      const k = nameKey(c.class_name);
      if (classByKey.has(k)) throw new Error(`반 이름 모호: ${c.class_name}`);
      classByKey.set(k, c);
    }

    // 강사 해석: english_name 우선, 없으면 헤더의 한글 이름(display_name). teacher 역할 우선, 모호=null.
    const TEACHER_ROLES = new Set(["teacher", "manager", "master"]);
    function resolveUser(cands) {
      if (cands.length === 0) return null;
      if (cands.length === 1) return cands[0];
      const t = cands.filter((u) => TEACHER_ROLES.has(u.system_role));
      return t.length === 1 ? t[0] : null; // 여전히 모호 → 라벨-only
    }
    const teacherCache = new Map(); // sheetName → user|null
    function resolveTeacher(sheetName, header) {
      if (teacherCache.has(sheetName)) return teacherCache.get(sheetName);
      let user = resolveUser(users.filter((u) => (u.english_name || "").toLowerCase() === sheetName.toLowerCase()));
      if (!user) {
        // 헤더 "Elsa 전양원 303" → 두 번째 토큰이 한글이면 display_name 시도
        const ko = (header || "").split(/\s+/).find((tok) => /^[가-힣]{2,4}$/.test(tok));
        if (ko) user = resolveUser(users.filter((u) => u.display_name === ko));
        // 시트명 자체가 한글(부원장·이주희)이면 display_name 직접 시도 (부원장은 직함이라 안 잡히는 게 정상)
        if (!user && /^[가-힣]+$/.test(sheetName)) user = resolveUser(users.filter((u) => u.display_name === sheetName));
      }
      teacherCache.set(sheetName, user ?? null);
      return user ?? null;
    }

    const roomByName = new Map(rooms.map((r) => [r.name, r]));

    // ── 3. 슬롯 해석 ──────────────────────────────────────────────────────────
    const unknownClasses = new Set();
    const unresolvedTeachers = new Map(); // name → count
    const usedRoomLabels = new Set();
    const targets = [];
    for (const p of valid) {
      const cls = classByKey.get(nameKey(p.class));
      if (!cls) {
        unknownClasses.add(p.class);
        continue;
      }
      const day = DAY_KO[p.day];
      if (!day) throw new Error(`요일 해석 실패: ${p.day}`);
      const user = resolveTeacher(p.teacher, p.teacher_raw);
      if (!user) unresolvedTeachers.set(p.teacher, (unresolvedTeachers.get(p.teacher) || 0) + 1);
      const rLabel = roomLabel(p.room, p.teacher);
      if (rLabel) usedRoomLabels.add(rLabel);
      targets.push({
        classId: cls.id,
        className: cls.class_name,
        day,
        start: to24(p.start_min),
        end: to24(p.end_min),
        teacherName: p.teacher,
        teacherId: user?.id ?? null,
        roomLabel: rLabel,
      });
    }
    if (unknownClasses.size) {
      throw new Error(`시트 반이 DB에 없음(먼저 해결): ${[...unknownClasses].join(", ")}`);
    }

    // (반,요일,시작) 중복 = 합반/이중배치 검사 — 보고만
    const dupKey = new Map();
    for (const t of targets) {
      const k = `${t.classId}|${t.day}|${t.start}`;
      dupKey.set(k, (dupKey.get(k) || 0) + 1);
    }
    const dups = [...dupKey.entries()].filter(([, n]) => n > 1);

    // ── 4. classes 담임/기본강의실 계획 ────────────────────────────────────────
    // ⚠️ 담임 최빈값은 **강사 이름 기준(전 슬롯)** — 해석된 슬롯만 세면 미해석 강사(Elsa 등)가
    // 다수인 반의 담임이 소수 슬롯의 해석 강사에게 오배정된다(적대리뷰 MED-1).
    // 최빈 이름이 users로 해석될 때만 갱신, 미해석/동률이면 기존 유지(null 덮어쓰기 금지).
    const perClass = new Map();
    for (const t of targets) {
      if (!perClass.has(t.classId)) perClass.set(t.classId, { names: new Map(), rooms: new Map() });
      const e = perClass.get(t.classId);
      e.names.set(t.teacherName, (e.names.get(t.teacherName) || 0) + 1);
      if (t.roomLabel) e.rooms.set(t.roomLabel, (e.rooms.get(t.roomLabel) || 0) + 1);
    }
    // 최빈값 — 동률(top2 count 같음)이면 null(모호 → 기존 유지).
    const modal = (m) => {
      if (!m.size) return null;
      const sorted = [...m.entries()].sort((a, b) => b[1] - a[1]);
      if (sorted.length > 1 && sorted[0][1] === sorted[1][1]) return null;
      return sorted[0][0];
    };
    const userNameById = new Map(users.map((u) => [u.id, u.display_name]));
    const classUpdates = [];
    const ambiguous = [];
    for (const c of classes) {
      const e = perClass.get(c.id);
      if (!e) continue; // 시트에 없는 반(폐강 대상)은 건드리지 않음
      const modalName = modal(e.names);
      if (!modalName && e.names.size > 1) ambiguous.push(`${c.class_name}(강사 동률: ${[...e.names.keys()].join("/")})`);
      const modalUser = modalName ? teacherCache.get(modalName) : null; // 해석 실패 강사면 null → 유지
      const newRoomName = modal(e.rooms);
      const upd = {
        id: c.id,
        className: c.class_name,
        prevTeacher: c.teacher_id,
        prevRoom: c.classroom_id,
        modalName,
      };
      let changed = false;
      if (modalUser && modalUser.id !== c.teacher_id) {
        upd.teacherId = modalUser.id;
        upd.teacherName = modalUser.display_name;
        changed = true;
      } else if (modalUser) {
        upd.teacherNote = `무변경(이미 ${modalUser.display_name})`;
      } else {
        upd.teacherNote = modalName ? `유지 — 최빈 ${modalName} 계정없음` : "유지 — 동률";
      }
      if (newRoomName && (!roomByName.get(newRoomName) || roomByName.get(newRoomName).id !== c.classroom_id)) {
        upd.roomName = newRoomName; // 적용 시 id 해석 (신규 생성분 포함)
        changed = true;
      }
      if (changed) classUpdates.push(upd);
    }

    // ── 5. 마감 대상 기존 스케줄 ───────────────────────────────────────────────
    const toClose = await sql`
      select s.id, s.valid_from, s.valid_to, c.class_name from class_schedules s
      join classes c on c.id = s.class_id
      where c.tenant_id = ${TENANT} and c.subject = 'english'
        and (s.valid_to is null or s.valid_to >= ${CUTOVER})`;
    const badValidFrom = toClose.filter((r) => new Date(r.valid_from) > new Date(CLOSE_AT));
    if (badValidFrom.length) {
      throw new Error(`valid_from > ${CLOSE_AT}인 기존 스케줄 ${badValidFrom.length}건 — 수동 확인 필요`);
    }

    // ── 6. 보고 ──────────────────────────────────────────────────────────────
    const missingRooms = [...usedRoomLabels].filter((l) => !roomByName.has(l));
    console.log("\n=== 계획 ===");
    console.log(`신규 스케줄 삽입: ${targets.length}행 (valid_from ${CUTOVER})`);
    console.log(`기존 스케줄 마감: ${toClose.length}행 (valid_to → ${CLOSE_AT})`);
    console.log(`classes 갱신: ${classUpdates.length}건`);
    console.log(`강의실 신규 생성: ${ROOMS_TO_CREATE.filter((n) => !roomByName.has(n)).join(", ") || "(없음)"}`);
    console.log(`라벨-only 방(강의실 미생성): ${missingRooms.filter((l) => !ROOMS_TO_CREATE.includes(l)).join(", ") || "(없음)"}`);
    console.log(`강사 미해석(라벨-only): ${[...unresolvedTeachers.entries()].map(([n, c]) => `${n}(${c})`).join(", ")}`);
    const resolvedCnt = targets.filter((t) => t.teacherId).length;
    console.log(`강사 해석: ${resolvedCnt}/${targets.length}`);
    if (dups.length) console.log(`⚠️ (반,요일,시작) 중복 ${dups.length}건:`, dups.slice(0, 5));
    if (ambiguous.length) console.log(`⚠️ 담임 동률(기존 유지): ${ambiguous.join(" · ")}`);
    console.log("\n강사 해석 표:");
    for (const [name, u] of teacherCache) console.log(`  ${name} → ${u ? `${u.display_name}(${u.english_name || "-"}, ${u.system_role})` : "라벨-only"}`);
    console.log("\nclasses 갱신 표 (담임=시트 최빈 강사, 이름으로 검수):");
    for (const u of classUpdates) {
      const prev = u.prevTeacher ? (userNameById.get(u.prevTeacher) ?? "…" + u.prevTeacher.slice(0, 8)) : "-";
      const next = u.teacherName ? `${u.teacherName}` : `(${u.teacherNote})`;
      console.log(`  ${u.className}: 담임 ${prev} → ${next}, 강의실 → ${u.roomName ?? "(유지)"}`);
    }

    if (!APPLY) {
      console.log("\n(dry-run — 쓰기 없음. --apply로 적용)");
      return;
    }

    // ── 7. 적용 ──────────────────────────────────────────────────────────────
    const stamp = new Date().toISOString().slice(0, 10);
    // 백업: 현재 영어 스케줄 전체
    const backup = await sql`
      select s.* from class_schedules s join classes c on c.id = s.class_id
      where c.tenant_id = ${TENANT} and c.subject = 'english'`;
    fs.writeFileSync(path.join(ART_DIR, `SCHED_BACKUP_${stamp}.json`), JSON.stringify(backup, null, 1));
    console.log(`\n백업: SCHED_BACKUP_${stamp}.json (${backup.length}행)`);

    const undo = {
      // 마감 전 스냅샷(id + 이전 valid_to) — 복원은 이 값으로 되돌린다(현재 전부 null 실측).
      closedSchedules: toClose.map((r) => ({ id: r.id, prevValidTo: r.valid_to })),
      insertedScheduleIds: [],
      classUpdates: [],
      createdClassroomIds: [],
      restoreOrder: "1) classes 되돌리기 2) 삽입 스케줄 삭제 3) 마감 스케줄 valid_to 복원 4) 생성 강의실 삭제",
    };

    await sql.begin(async (tx) => {
      // 강의실 생성
      for (const name of ROOMS_TO_CREATE) {
        if (roomByName.has(name)) continue;
        const [row] = await tx`
          insert into classrooms (tenant_id, name) values (${TENANT}, ${name}) returning id, name`;
        roomByName.set(name, row);
        undo.createdClassroomIds.push(row.id);
      }
      // 기존 마감 — valid_from < CUTOVER 술어로, 가드~트랜잭션 사이 앱이 만든 신규(7/3+) 행을 안 닫는다(레이스 봉쇄).
      const closed = await tx`
        update class_schedules s set valid_to = ${CLOSE_AT}
        from classes c
        where c.id = s.class_id and c.tenant_id = ${TENANT} and c.subject = 'english'
          and (s.valid_to is null or s.valid_to >= ${CUTOVER})
          and s.valid_from < ${CUTOVER}
        returning s.id`;
      undo.actualClosedIds = closed.map((r) => r.id);
      // 신규 삽입
      const rows = targets.map((t) => ({
        id: crypto.randomUUID(),
        tenant_id: TENANT,
        class_id: t.classId,
        day_of_week: t.day,
        start_time: t.start,
        end_time: t.end,
        valid_from: CUTOVER,
        valid_to: null,
        teacher_id: t.teacherId,
        classroom_id: t.roomLabel ? (roomByName.get(t.roomLabel)?.id ?? null) : null,
        slot_teacher_label: t.teacherName,
        slot_room_label: t.roomLabel,
      }));
      for (let i = 0; i < rows.length; i += 100) {
        await tx`insert into class_schedules ${tx(rows.slice(i, i + 100))}`;
      }
      undo.insertedScheduleIds = rows.map((r) => r.id);
      // classes 갱신
      for (const u of classUpdates) {
        const roomId = u.roomName ? (roomByName.get(u.roomName)?.id ?? null) : null;
        if (u.teacherId && roomId) {
          await tx`update classes set teacher_id = ${u.teacherId}, classroom_id = ${roomId} where id = ${u.id} and tenant_id = ${TENANT}`;
        } else if (u.teacherId) {
          await tx`update classes set teacher_id = ${u.teacherId} where id = ${u.id} and tenant_id = ${TENANT}`;
        } else if (roomId) {
          await tx`update classes set classroom_id = ${roomId} where id = ${u.id} and tenant_id = ${TENANT}`;
        }
        undo.classUpdates.push(u);
      }
    });

    fs.writeFileSync(path.join(ART_DIR, `SCHED_UNDO_${stamp}.json`), JSON.stringify(undo, null, 1));
    console.log(`적용 완료. 언두: SCHED_UNDO_${stamp}.json`);
    console.log(`  마감 ${undo.actualClosedIds.length} / 삽입 ${undo.insertedScheduleIds.length} / classes ${undo.classUpdates.length} / 강의실 ${undo.createdClassroomIds.length}`);
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error("실패:", e.message);
  process.exit(1);
});
