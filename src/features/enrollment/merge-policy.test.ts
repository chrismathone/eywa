// 구조 가드 — **컬럼 정책표가 실제 테이블과 어긋나면 실패**한다.
// 이게 없으면 새 컬럼이 정책 없이 조용히 승자 값으로 덮이거나(정보 손실), 두 정책에 이중 등록돼
// 값이 갈린다. 병합은 되돌리기 어려운 작업이라 이 어긋남을 런타임까지 끌고 가면 안 된다.
import { describe, expect, it } from "vitest";
import {
  APPEND_COLUMNS,
  ATOMIC_SETS,
  BOOLEAN_OR_COLUMNS,
  COLUMN_LABEL,
  EARLIEST_WINS_COLUMNS,
  KEY_SETS,
  NAME_LIST_COLUMNS,
  OUTCOME_RANK,
  PHONE_COLUMNS,
  SCALAR_COLUMNS,
  SCHOOL_COLUMNS,
  SKIP_COLUMNS,
  TERMINAL_OUTCOMES,
} from "./merge-policy";

/**
 * `enrollment_consultations`의 실제 컬럼 전수(2026-08-11 information_schema 실측 67개).
 * 🔴 스키마에 컬럼을 더하면 **여기와 정책표 둘 다** 갱신할 것. 한쪽만 고치면 이 테스트가 잡는다.
 */
const DB_COLUMNS = [
  "id", "tenant_id", "prospect_name", "prospect_grade", "prospect_school", "parent_name",
  "parent_phone", "parent_request", "learning_history", "consultant_id", "outcome", "student_id",
  "consulted_at", "created_at", "updated_at", "audio_path", "audio_duration_sec", "audio_size_bytes",
  "transcription", "speaker_labels", "processing_status", "processing_error", "assemblyai_transcript_id",
  "english_name", "gender", "blood_type", "birth_date", "student_phone", "home_phone", "parent_relation",
  "address", "zip_code", "address_detail", "consultation_path", "subject", "career_goal", "siblings",
  "safety_notes", "shuttle_bus_request", "registration_status", "payment_amount", "payment_date",
  "registrar", "privacy_agreement", "installment_agreement", "follow_up_date", "follow_up_content",
  "non_registration_reason", "subject_details", "from_public_intake", "intake_token_id", "makeedu_id",
  "sync_added_at", "counselor", "received_date", "student_type", "siblings_details", "consultation_date",
  "makeedu_pushed_at", "intake_checklist", "prep_brief", "prep_brief_at", "prep_brief_status",
  "prep_brief_error", "prep_brief_job_at", "receiver", "legacy_key", "legacy_source",
  // 0362a 소개한 사람
  "referrer_student_id", "referrer_staff_id", "referrer_name",
] as const;

const covered = [...SKIP_COLUMNS, ...SCALAR_COLUMNS, ...APPEND_COLUMNS, ...Object.values(ATOMIC_SETS).flat()];

describe("merge-policy — 컬럼 전수 커버리지", () => {
  it("모든 DB 컬럼이 정확히 한 정책에 속한다", () => {
    const missing = DB_COLUMNS.filter((c) => !covered.includes(c));
    expect(missing, "정책이 없는 컬럼(병합 시 조용히 덮인다)").toEqual([]);
  });

  it("정책표에 실재하지 않는 컬럼이 없다", () => {
    const ghosts = covered.filter((c) => !(DB_COLUMNS as readonly string[]).includes(c));
    expect(ghosts, "테이블에 없는 컬럼(오타이거나 삭제된 컬럼)").toEqual([]);
  });

  it("한 컬럼이 두 정책에 중복 등록되지 않는다", () => {
    const dupes = covered.filter((c, i) => covered.indexOf(c) !== i);
    expect([...new Set(dupes)], "두 번 결정되면 값이 갈린다").toEqual([]);
  });

  it("특수 취급 컬럼은 전부 scalar 목록 안에 있다(디스패치가 갈라 쓰는 전제)", () => {
    const special = [...EARLIEST_WINS_COLUMNS, ...BOOLEAN_OR_COLUMNS, ...PHONE_COLUMNS, ...NAME_LIST_COLUMNS, ...SCHOOL_COLUMNS, "outcome"];
    const outside = special.filter((c) => !(SCALAR_COLUMNS as readonly string[]).includes(c));
    expect(outside, "scalar 목록 밖의 특수 컬럼은 결정 자체가 누락된다").toEqual([]);
  });

  it("특수 취급 컬럼끼리 겹치지 않는다", () => {
    const special = [...EARLIEST_WINS_COLUMNS, ...BOOLEAN_OR_COLUMNS, ...PHONE_COLUMNS, ...NAME_LIST_COLUMNS, ...SCHOOL_COLUMNS, "outcome"];
    const dupes = special.filter((c, i) => special.indexOf(c) !== i);
    expect([...new Set(dupes)]).toEqual([]);
  });

  it("KEY_SETS는 실재하는 atomic 세트만 가리킨다", () => {
    const names = Object.keys(ATOMIC_SETS);
    expect(KEY_SETS.every((k) => names.includes(k))).toBe(true);
  });

  it("registrar는 payment 세트에만 있고 이름 나열에는 없다(결제 사실과 한 덩어리)", () => {
    expect(ATOMIC_SETS.payment).toContain("registrar");
    expect(NAME_LIST_COLUMNS as readonly string[]).not.toContain("registrar");
  });

  it("registration_status는 payment 세트에 없다(금액 없는 행도 상태는 갖는다)", () => {
    expect(ATOMIC_SETS.payment as readonly string[]).not.toContain("registration_status");
  });
});

describe("merge-policy — outcome 랭킹", () => {
  it("등록과 미등록은 같은 층(결말)이다 — 한쪽이 다른 쪽을 자동으로 이기면 안 된다", () => {
    expect(OUTCOME_RANK.enrolled).toBe(OUTCOME_RANK.declined);
    expect(TERMINAL_OUTCOMES).toEqual(expect.arrayContaining(["enrolled", "declined"]));
  });

  it("진행 중 상태는 결말보다 낮다", () => {
    for (const s of ["pending", "scheduled", "no_show", "consulted", "ai_done"]) {
      expect(OUTCOME_RANK[s]!).toBeLessThan(OUTCOME_RANK.enrolled!);
    }
  });
});

describe("merge-policy — 한글 라벨", () => {
  it("사람이 고를 수 있는 모든 항목에 한글 라벨이 있다(raw 컬럼명 노출 금지)", () => {
    const shown = [...SCALAR_COLUMNS, ...APPEND_COLUMNS, ...Object.keys(ATOMIC_SETS)];
    const noLabel = shown.filter((c) => !COLUMN_LABEL[c]);
    expect(noLabel, "화면·감사로그에 영문 컬럼명이 그대로 나간다").toEqual([]);
  });
});
