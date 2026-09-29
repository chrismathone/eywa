import "server-only";
import { revalidateTag } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { getTenantSettings } from "@/features/owner/server/queries";
import { resolveSkillAreas } from "@/features/owner/skill-areas";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { friendlyTextbookError, isMissingTextbookTable, TEXTBOOKS_NOT_READY } from "@/features/textbooks/server/access";
import { textbookOptionsTag } from "@/features/textbooks/server/queries";
import { IMPORT_META } from "../kinds";
import { duplicateKeyIssues, type ColumnSpec, type ImportPreviewRow, type SheetSpec } from "../spec";
import type { ImporterDef } from "../server/types";

/**
 * 교재 가져오기 — 교재목록(0266a `textbooks`) 마스터 + 차수별 진도·과제(`textbook_lessons`, 선택 시트).
 * 🔴 수납관리의 '교재 단가표'(`textbook_catalog`, 금액 표)와 **다른 물건**이다 — 여기로 금액을 붓지 않는다(sheets.md).
 * 🔑 매칭 = 과목 + 교재이름(대소문자·앞뒤 공백 무시 — DB 유니크 `lower(btrim(title))`와 같은 기준).
 *    🔴 비슷한 이름을 합치지 않는다(`그래머인사이드 3` ↔ `그래머인사이드3`은 다른 책 — 합치기는 사람 판단).
 * 🔑 구분은 학원설정 `subjects[].skillAreas`의 **라벨**로 적는다(키도 받는다). 모르는 구분은 오류(구분은 필터라 틀리면 기입이 엇나간다).
 * 🔑 '차수' 시트: 교재이름 + 차수 번호 → 진도·과제. 추가 = 이미 적힌 차수는 건너뜀 · 덮어쓰기 = 파일 값으로.
 *    진도·과제가 둘 다 빈 줄은 **아무것도 안 한다**(지우기는 화면에서 — 파일로 기록이 사라지지 않게).
 * ⚠️ admin 클라이언트(교재 액션과 같은 규약) = RLS 우회 → 모든 쿼리에 tenant_id 명시.
 */
type BK = "subject" | "skillArea" | "title" | "pageTime" | "sessionCount";
type LK = "subject" | "title" | "lessonNo" | "progress" | "homework";

const BOOK_SHEET = "교재";
const LESSON_SHEET = "차수";

function bookSpec(subjects: readonly string[], areas: readonly string[]): SheetSpec<BK> {
  const columns: ColumnSpec<BK>[] = [
    { key: "subject", header: "과목", width: 10, options: subjects, strictOptions: true, hint: "비우면 영어" },
    { key: "skillArea", header: "구분", width: 12, options: areas, hint: "학원 설정의 과목별 구분(예: Vocab·Reading). 비우면 미지정(반 배정에 못 씁니다)." },
    { key: "title", header: "교재이름", width: 32, required: true, aliases: ["교재명", "교재"] },
    { key: "pageTime", header: "페이지/시간", width: 14, aliases: ["페이지", "시간"], hint: "예: 35분 · p.10-20 (40자까지)" },
    { key: "sessionCount", header: "차수", width: 8, aliases: ["총차수", "차시"], hint: "0~200" },
  ];
  return { name: BOOK_SHEET, columns, keyHint: "과목 + 교재이름" };
}
function lessonSpec(subjects: readonly string[]): SheetSpec<LK> {
  const columns: ColumnSpec<LK>[] = [
    { key: "subject", header: "과목", width: 10, options: subjects, strictOptions: true, hint: "비우면 영어" },
    { key: "title", header: "교재이름", width: 32, required: true, aliases: ["교재명", "교재"] },
    { key: "lessonNo", header: "차수번호", width: 9, required: true, aliases: ["차수", "회차"], hint: "1~200" },
    { key: "progress", header: "진도", width: 36 },
    { key: "homework", header: "과제", width: 36 },
  ];
  return { name: LESSON_SHEET, columns, keyHint: "과목 + 교재이름 + 차수번호", optional: true };
}

type ExistingBook = { id: string; subject: string; skill_area: string | null; title: string; page_time: string | null; session_count: number };
type ExistingLesson = { textbook_id: string; lesson_no: number; progress: string | null; homework: string | null };
type BookWrite = { subject: string; skill_area: string | null; title: string; page_time: string | null; session_count: number | null };
type Plan = {
  inserts: BookWrite[];
  updates: { id: string; patch: Partial<BookWrite> }[];
  /** 교재 식별 = `${subject}|${lower(title)}` — 새 교재는 반영 때 id가 생긴다. */
  lessons: { bookKey: string; lessonNo: number; progress: string | null; homework: string | null }[];
};

const titleKey = (subject: string, title: string) => `${subject}|${title.trim().toLowerCase()}`;

async function loadContext(tenantId: string) {
  const settings = await getTenantSettings();
  const subjects = settings.operations.subjects;
  const maps = buildSubjectMaps(subjects);
  const defaultSubject = subjects.some((s) => s.key === "english") ? "english" : (subjects[0]?.key ?? "english");
  const subjectTable = subjects.map((s) => ({ label: s.label, value: s.key }));
  const areasOf = (subject: string) => resolveSkillAreas(subjects.find((s) => s.key === subject));
  return { tenantId, subjects, maps, defaultSubject, subjectTable, areasOf };
}

const def: ImporterDef<Plan> = {
  kind: "textbooks",
  title: IMPORT_META.textbooks.title,
  menu: "textbooks",
  sheets: [bookSpec([], []), lessonSpec([])],
  modeHelp: IMPORT_META.textbooks.modeHelp,
  guide: [
    "· '교재' 시트 한 줄 = 교재 한 권. '차수' 시트(선택) 한 줄 = 교재 한 권의 한 차수 진도·과제.",
    "· 같은 교재 판단: 과목 + 교재이름(대소문자·앞뒤 공백 무시). 이름이 한 글자라도 다르면 다른 교재로 들어갑니다.",
    "· '추가' = 이미 있는 교재·차수는 건너뜀 · '덮어쓰기' = 적힌 칸을 파일 값으로(빈 칸은 그대로 둡니다).",
    "· 구분은 학원 설정의 과목별 구분 이름으로 적습니다. 목록에 없는 구분은 오류입니다(설정에서 먼저 추가).",
    "· 차수 시트의 교재는 '교재' 시트나 교재목록에 있어야 합니다. 진도·과제가 둘 다 빈 줄은 무시합니다(지우기는 화면에서).",
    "· 이 서식은 수업 교재 목록입니다 — 교재 판매 금액(교재 단가표)은 여기에 넣지 않습니다.",
  ],
  revalidate: ["/textbooks"],

  async template(ctx) {
    const c = await loadContext(ctx.tenantId);
    const admin = createAdminClient();
    let books: ExistingBook[] = [];
    let lessons: ExistingLesson[] = [];
    try {
      [books, lessons] = await Promise.all([
        fetchAllPaged<ExistingBook>((from, to) =>
          admin.from("textbooks").select("id, subject, skill_area, title, page_time, session_count").eq("tenant_id", ctx.tenantId).order("subject").order("title").order("id").range(from, to),
        ),
        fetchAllPaged<ExistingLesson>((from, to) =>
          admin.from("textbook_lessons").select("textbook_id, lesson_no, progress, homework").eq("tenant_id", ctx.tenantId).order("textbook_id").order("lesson_no").range(from, to),
        ),
      ]);
    } catch {
      // 0266a 미적용이어도 빈 서식은 내려준다(화면이 이미 한글 배너로 알린다).
    }
    const bookById = new Map(books.map((b) => [b.id, b]));
    const subjectLabels = c.subjectTable.map((s) => s.label);
    const areaLabels = c.areasOf(c.defaultSubject).map((a) => a.label);
    const areaLabel = (subject: string, key: string | null) => (key ? (c.areasOf(subject).find((a) => a.key === key)?.label ?? key) : "");
    return [
      {
        spec: bookSpec(subjectLabels, areaLabels),
        rows: books.map((b) => ({
          subject: c.maps.labelOf(b.subject),
          skillArea: areaLabel(b.subject, b.skill_area),
          title: b.title,
          pageTime: b.page_time ?? "",
          sessionCount: b.session_count,
        })),
      },
      {
        spec: lessonSpec(subjectLabels),
        rows: lessons.flatMap((l) => {
          const b = bookById.get(l.textbook_id);
          return b ? [{ subject: c.maps.labelOf(b.subject), title: b.title, lessonNo: l.lesson_no, progress: l.progress ?? "", homework: l.homework ?? "" }] : [];
        }),
      },
    ];
  },

  async plan({ ctx, mode, sheets, issues }) {
    const c = await loadContext(ctx.tenantId);
    const admin = createAdminClient();
    // 표 없음(0266a 미적용)은 원인을 말한다 — fetchAllPaged의 raw 원문 대신.
    const probe = await admin.from("textbooks").select("id").eq("tenant_id", ctx.tenantId).limit(1);
    if (probe.error) throw new Error(isMissingTextbookTable(probe.error) ? TEXTBOOKS_NOT_READY : friendlyTextbookError(probe.error, "교재목록을 읽지 못했습니다"));
    const [books, lessons] = await Promise.all([
      fetchAllPaged<ExistingBook>((from, to) =>
        admin.from("textbooks").select("id, subject, skill_area, title, page_time, session_count").eq("tenant_id", ctx.tenantId).order("id").range(from, to),
      ),
      fetchAllPaged<ExistingLesson>((from, to) =>
        admin.from("textbook_lessons").select("textbook_id, lesson_no, progress, homework").eq("tenant_id", ctx.tenantId).order("textbook_id").order("lesson_no").range(from, to),
      ),
    ]);
    const bookByKey = new Map(books.map((b) => [titleKey(b.subject, b.title), b]));
    const lessonByKey = new Map(lessons.map((l) => [`${l.textbook_id}#${l.lesson_no}`, l]));

    const plan: Plan = { inserts: [], updates: [], lessons: [] };
    const preview: ImportPreviewRow[] = [];
    const notes: string[] = [];
    let bookSkip = 0;
    /** 파일에 적힌(새로 생길 것 포함) 교재 키 → 차수 상한. */
    const fileBooks = new Map<string, number | null>();
    const parsedBooks: { rowNum: number; key: string }[] = [];

    for (const row of sheets[BOOK_SHEET]?.rows ?? []) {
      const subject = row.option("subject", c.subjectTable) ?? c.defaultSubject;
      const title = row.text("title", { required: true, max: 120 });
      const areas = c.areasOf(subject);
      const skillArea = row.option("skillArea", areas.map((a) => ({ label: a.label, value: a.key })));
      const pageTime = row.text("pageTime", { max: 40 });
      const sessionCount = row.int("sessionCount", { min: 0, max: 200 });
      if (!row.ok || !title) continue;
      const key = titleKey(subject, title);
      parsedBooks.push({ rowNum: row.rowNum, key });
      fileBooks.set(key, sessionCount);
      const label = `${c.maps.labelOf(subject)} · ${title}`;
      const summary = [skillArea ? (areas.find((a) => a.key === skillArea)?.label ?? skillArea) : "구분 미지정", pageTime, sessionCount !== null ? `${sessionCount}차수` : null]
        .filter(Boolean)
        .join(" · ");
      const cur = bookByKey.get(key);
      if (!cur) {
        plan.inserts.push({ subject, skill_area: skillArea, title, page_time: pageTime, session_count: sessionCount });
        preview.push({ sheet: BOOK_SHEET, rowNum: row.rowNum, key: label, action: "insert", summary });
        continue;
      }
      if (mode === "append") {
        bookSkip += 1;
        preview.push({ sheet: BOOK_SHEET, rowNum: row.rowNum, key: label, action: "skip", summary: `이미 있음 · ${summary}` });
        continue;
      }
      const patch: Partial<BookWrite> = {};
      if (skillArea !== null && skillArea !== cur.skill_area) patch.skill_area = skillArea;
      if (pageTime !== null && pageTime !== cur.page_time) patch.page_time = pageTime;
      if (sessionCount !== null && sessionCount !== cur.session_count) patch.session_count = sessionCount;
      if (Object.keys(patch).length === 0) {
        bookSkip += 1;
        preview.push({ sheet: BOOK_SHEET, rowNum: row.rowNum, key: label, action: "skip", summary: "바뀐 칸 없음" });
      } else {
        plan.updates.push({ id: cur.id, patch });
        preview.push({ sheet: BOOK_SHEET, rowNum: row.rowNum, key: label, action: "update", summary: `${Object.keys(patch).length}칸 바꿈 · ${summary}` });
      }
    }
    issues.push(...duplicateKeyIssues(BOOK_SHEET, parsedBooks, (r) => r.key, "교재(과목·교재이름)"));

    let lessonInsert = 0;
    let lessonUpdate = 0;
    let lessonSkip = 0;
    const parsedLessons: { rowNum: number; key: string }[] = [];
    for (const row of sheets[LESSON_SHEET]?.rows ?? []) {
      const subject = row.option("subject", c.subjectTable) ?? c.defaultSubject;
      const title = row.text("title", { required: true, max: 120 });
      const lessonNo = row.int("lessonNo", { required: true, min: 1, max: 200 });
      const progress = row.text("progress", { max: 500 });
      const homework = row.text("homework", { max: 500 });
      if (!row.ok || !title || lessonNo === null) continue;
      const key = titleKey(subject, title);
      const cur = bookByKey.get(key);
      if (!cur && !fileBooks.has(key)) {
        row.fail("title", "이 교재가 교재목록에도, 이 파일의 '교재' 시트에도 없습니다 — 교재 시트에 먼저 적어 주세요");
        continue;
      }
      // 차수 상한 — 파일에 적은 차수(있으면) → 지금 교재의 차수. 넘는 차수는 시트에 안 뜬다.
      const limit = fileBooks.get(key) ?? cur?.session_count ?? null;
      if (limit !== null && limit !== undefined && lessonNo > limit) {
        row.fail("lessonNo", `이 교재의 차수는 ${limit}차수까지입니다 — 교재 시트의 '차수'를 늘리거나 번호를 확인하세요`);
        continue;
      }
      parsedLessons.push({ rowNum: row.rowNum, key: `${key}#${lessonNo}` });
      const label = `${title} ${lessonNo}차수`;
      if (progress === null && homework === null) {
        lessonSkip += 1;
        preview.push({ sheet: LESSON_SHEET, rowNum: row.rowNum, key: label, action: "skip", summary: "진도·과제가 비어 있음(지우지 않습니다)" });
        continue;
      }
      const curLesson = cur ? lessonByKey.get(`${cur.id}#${lessonNo}`) : undefined;
      const summary = [progress, homework ? `과제 ${homework}` : null].filter(Boolean).join(" · ");
      if (!curLesson) {
        plan.lessons.push({ bookKey: key, lessonNo, progress, homework });
        lessonInsert += 1;
        preview.push({ sheet: LESSON_SHEET, rowNum: row.rowNum, key: label, action: "insert", summary });
        continue;
      }
      if (mode === "append") {
        lessonSkip += 1;
        preview.push({ sheet: LESSON_SHEET, rowNum: row.rowNum, key: label, action: "skip", summary: "이미 적힌 차수" });
        continue;
      }
      // 덮어쓰기 — 빈 칸은 그대로(원래 값 유지).
      const nextProgress = progress ?? curLesson.progress;
      const nextHomework = homework ?? curLesson.homework;
      if (nextProgress === curLesson.progress && nextHomework === curLesson.homework) {
        lessonSkip += 1;
        preview.push({ sheet: LESSON_SHEET, rowNum: row.rowNum, key: label, action: "skip", summary: "바뀐 칸 없음" });
        continue;
      }
      plan.lessons.push({ bookKey: key, lessonNo, progress: nextProgress, homework: nextHomework });
      lessonUpdate += 1;
      preview.push({ sheet: LESSON_SHEET, rowNum: row.rowNum, key: label, action: "update", summary });
    }
    issues.push(...duplicateKeyIssues(LESSON_SHEET, parsedLessons, (r) => r.key, "교재 차수"));
    // 차수 칸을 비운 **새** 교재 = 차수 시트에 적힌 가장 큰 번호(없으면 0) — 0차수 교재에 차수를 적어 두면 시트에 안 뜬다.
    for (const b of plan.inserts) {
      if (b.session_count !== null) continue;
      const k = titleKey(b.subject, b.title);
      b.session_count = plan.lessons.filter((l) => l.bookKey === k).reduce((m, l) => Math.max(m, l.lessonNo), 0);
    }

    return {
      counts: [
        { label: "교재", total: sheets[BOOK_SHEET]?.rows.length ?? 0, insert: plan.inserts.length, update: plan.updates.length, skip: bookSkip },
        { label: "차수", total: sheets[LESSON_SHEET]?.rows.length ?? 0, insert: lessonInsert, update: lessonUpdate, skip: lessonSkip },
      ],
      preview,
      notes,
      plan,
    };
  },

  async apply({ ctx, plan }) {
    const admin = createAdminClient();
    const userId = ctx.user.id;
    let inserted = 0;
    const idByKey = new Map<string, string>();
    for (let i = 0; i < plan.inserts.length; i += 200) {
      const chunk = plan.inserts.slice(i, i + 200);
      const { data, error } = await admin
        .from("textbooks")
        .insert(
          chunk.map((b) => ({
            tenant_id: ctx.tenantId,
            subject: b.subject,
            skill_area: b.skill_area,
            title: b.title,
            page_time: b.page_time,
            session_count: b.session_count ?? 0,
            created_by: userId,
            updated_by: userId,
          })),
        )
        .select("id, subject, title");
      if (error) {
        return { error: `${friendlyTextbookError(error, "교재를 넣지 못했습니다", "같은 이름의 교재가 방금 생겼습니다 — 미리보기를 다시 받아 주세요")}${inserted ? ` · 그 앞 ${inserted}권은 들어갔습니다` : ""}` };
      }
      for (const r of data ?? []) idByKey.set(titleKey(r.subject as string, r.title as string), r.id as string);
      inserted += chunk.length;
    }
    for (const u of plan.updates) {
      const { error } = await admin.from("textbooks").update({ ...u.patch, updated_by: userId }).eq("tenant_id", ctx.tenantId).eq("id", u.id);
      if (error) return { error: `교재 갱신 중 멈췄습니다 — ${friendlyTextbookError(error, "교재를 고치지 못했습니다")} (새 교재 ${inserted}권은 들어갔습니다)` };
    }
    if (plan.lessons.length) {
      // 기존 교재 id — 반영 직전에 다시 읽는다(새 교재는 방금 받은 id).
      const missing = [...new Set(plan.lessons.map((l) => l.bookKey).filter((k) => !idByKey.has(k)))];
      if (missing.length) {
        const books = await fetchAllPaged<{ id: string; subject: string; title: string }>((from, to) =>
          admin.from("textbooks").select("id, subject, title").eq("tenant_id", ctx.tenantId).order("id").range(from, to),
        );
        for (const b of books) {
          const k = titleKey(b.subject, b.title);
          if (!idByKey.has(k)) idByKey.set(k, b.id);
        }
      }
      const rows = plan.lessons.flatMap((l) => {
        const id = idByKey.get(l.bookKey);
        return id ? [{ tenant_id: ctx.tenantId, textbook_id: id, lesson_no: l.lessonNo, progress: l.progress, homework: l.homework, updated_by: userId }] : [];
      });
      for (let i = 0; i < rows.length; i += 500) {
        const { error } = await admin.from("textbook_lessons").upsert(rows.slice(i, i + 500), { onConflict: "tenant_id,textbook_id,lesson_no" });
        if (error) return { error: `차수를 저장하지 못했습니다 — ${friendlyTextbookError(error, "차수 저장 실패")} (교재는 반영됐습니다)` };
      }
    }
    // Route Handler라 `updateTag`를 못 쓴다 — 즉시 만료(`expire: 0`)로 ECS 교재 제안이 바로 새 목록을 본다.
    revalidateTag(textbookOptionsTag(ctx.tenantId), { expire: 0 });
    return {};
  },
};

export default def;
