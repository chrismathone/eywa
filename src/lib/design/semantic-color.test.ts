import { describe, expect, it } from "vitest";
import { TONE_COLOR, TONE_SOFT, TONE_TEXT, TONE_ACCENT_BAR, toneColor } from "./semantic-color";
import { STUDENT_STATUS_TONE, studentStatusMeta } from "@/features/students/status-labels";
import { STAFF_STATUS_TONE, staffStatusMeta, roleMeta } from "@/features/staff/status-labels";
import { docStatusLabel } from "@/features/approvals/types";
import {
  ATT_SOFT,
  ATT_SOFT_BORDER,
  ATT_SOLID,
  ATT_VIVID,
} from "@/features/attendance/status-color";
import { BILLING_BADGE, BILLING_CARD } from "@/features/billing/status-color";
import { classnoteBadge } from "@/features/onescreen/classnote-badge";
import { LEVEL_COLOR } from "@/features/retention/components/risk-badge";

/**
 * 의미색 캐논 가드 — *"일치하는 곳의 색은 항상 일치"*(원장 2026-08-18)를 코드로 잠근다.
 *
 * 이 스위트가 지키는 건 **색의 예쁨이 아니라 어휘의 일관성**이다. 누군가 학생 '재원'만 파랑으로
 * 되돌리거나, 결재 '승인'을 네이비로 바꾸면 여기서 깨진다 — 화면 하나만 보면 멀쩡해 보이고
 * 스크린샷을 나란히 놓아야 보이는 종류의 회귀라, 사람 눈에 기대면 반드시 다시 갈라진다.
 */
describe("의미색 캐논", () => {
  it("tone → 색 배정이 고정이다", () => {
    expect(TONE_COLOR.positive).toBe("green");
    expect(TONE_COLOR.caution).toBe("amber");
    expect(TONE_COLOR.critical).toBe("danger");
    expect(TONE_COLOR.info).toBe("blue");
    expect(TONE_COLOR.special).toBe("purple");
    expect(TONE_COLOR.inert).toBe("neutral");
    expect(TONE_COLOR.brand).toBe("primary");
  });

  it("모든 tone이 네 표현(pill·text·soft·bar)을 빠짐없이 갖는다", () => {
    // 하나라도 비면 그 tone을 쓰는 화면이 조용히 무색으로 렌더된다.
    for (const tone of Object.keys(TONE_COLOR) as (keyof typeof TONE_COLOR)[]) {
      expect(TONE_TEXT[tone], `TONE_TEXT.${tone}`).toBeTruthy();
      expect(TONE_SOFT[tone], `TONE_SOFT.${tone}`).toBeTruthy();
      expect(TONE_ACCENT_BAR[tone], `TONE_ACCENT_BAR.${tone}`).toBeTruthy();
    }
  });

  it("서로 다른 뜻은 서로 다른 색을 쓴다 — 색이 겹치면 구분이 사라진다", () => {
    const used = Object.values(TONE_COLOR);
    expect(new Set(used).size).toBe(used.length);
  });
});

describe("'정상'은 어느 화면에서든 초록이다", () => {
  it("학생 재원 · 직원 재직 · 결재 승인이 모두 positive(green)", () => {
    expect(studentStatusMeta("enrolled")?.color).toBe("green");
    expect(staffStatusMeta("active")?.color).toBe("green");
    expect(docStatusLabel("approved").color).toBe("green");
    // 셋 다 같은 tone에서 나온다(값만 우연히 같은 게 아니라 같은 근거를 공유한다).
    expect(STUDENT_STATUS_TONE.enrolled).toBe("positive");
    expect(STAFF_STATUS_TONE.active).toBe("positive");
    expect(toneColor("positive")).toBe("green");
  });

  it("'끝난 것'은 색을 빼고(neutral), '실패'만 빨강이다", () => {
    expect(studentStatusMeta("withdrawn")?.color).toBe("neutral");
    expect(docStatusLabel("canceled").color).toBe("neutral"); // 회수 = 취소지 실패가 아니다
    expect(docStatusLabel("rejected").color).toBe("danger"); // 반려 = 실패
  });

  it("문서 '진행중'은 info(파랑)다 — 남이 처리 중이라는 정보이지 내 차례가 아니다", () => {
    expect(docStatusLabel("pending").color).toBe("blue");
  });
});

describe("출결은 여섯 화면이 같은 색을 쓴다", () => {
  // 2026-08-18 실측: '출석' 하나가 다섯 색이었다(민트·네이비·chart-2·primary-soft·…).
  // 채도는 자리마다 달라도(격자=원색 / 칩=틴트 / 누른 알약=채움) **색상 계열은 하나**여야 한다.
  it("세 벌(vivid·soft·solid)이 같은 키 집합을 갖는다", () => {
    const keys = Object.keys(ATT_VIVID).sort();
    expect(Object.keys(ATT_SOFT).sort()).toEqual(keys);
    expect(Object.keys(ATT_SOLID).sort()).toEqual(keys);
    expect(Object.keys(ATT_SOFT_BORDER).sort()).toEqual(keys);
  });

  it("출석=초록 · 결석=danger · 지각=amber · 조퇴=파랑 · 보강=보라", () => {
    expect(ATT_SOFT.present).toContain("green");
    expect(ATT_SOLID.present).toContain("green");
    expect(ATT_SOFT.absent).toContain("danger");
    expect(ATT_SOFT.late).toContain("amber");
    expect(ATT_SOFT.early_leave).toContain("blue");
    expect(ATT_SOFT.makeup).toContain("purple");
  });

  it("출석이 primary(네이비)로 되돌아가지 않는다 — 과목·브랜드와 뜻이 겹친다", () => {
    for (const set of [ATT_SOFT, ATT_SOLID]) {
      expect(set.present).not.toContain("primary");
    }
  });

  it("격자 팔레트는 --att-* 원색을 유지한다 — 31칸에서 틴트로는 결석을 못 찾는다", () => {
    expect(ATT_VIVID.present).toContain("att-present");
    expect(ATT_VIVID.absent).toContain("att-absent");
  });
});

describe("'완료'가 화면마다 갈리지 않는다 — primary는 상태색이 아니다", () => {
  // 🔴 2026-08-18 전수 감사: primary(네이비)를 "완료/정상"으로 쓰는 곳이 12군데였다.
  //    학생 축만 초록으로 옮기면 오히려 더 갈리므로 같은 푸시에서 전부 옮겼다.
  it("수납 완료·미납·부분납", () => {
    expect(BILLING_BADGE.paid).toContain("green");
    expect(BILLING_BADGE.unpaid).toContain("danger");
    expect(BILLING_BADGE.partial).toContain("amber");
    // 부분납과 미납이 같은 색이면 "일부라도 받았는가"가 색에서 사라진다.
    expect(BILLING_BADGE.partial).not.toBe(BILLING_BADGE.unpaid);
    for (const k of ["paid", "unpaid", "partial"] as const) {
      expect(BILLING_BADGE[k], `BILLING_BADGE.${k}`).not.toContain("primary");
      expect(BILLING_CARD[k], `BILLING_CARD.${k}`).not.toContain("primary");
    }
  });

  it("ClassNote 발송 완료", () => {
    expect(classnoteBadge("success")?.cls).toBe("text-green");
    expect(classnoteBadge("failed")?.cls).toBe("text-danger");
  });

  it("ClassNote 정본이 회수·취소·제외 상태를 삼키지 않는다", () => {
    // 로컬 사본이 이 상태들을 switch에서 빠뜨려 전부 "—"로 만들던 자리(상태 은폐 버그).
    for (const s of [
      "revoked",
      "recall_requested",
      "recalled",
      "recall_failed",
      "subject_off",
      "absent",
      "no_attendance",
    ]) {
      const b = classnoteBadge(s);
      expect(b, `classnoteBadge("${s}")`).not.toBeNull();
      expect(b!.short.length, `short label for ${s}`).toBeGreaterThan(0);
    }
    expect(classnoteBadge(null)).toBeNull();
  });

  it("이탈 위험 '안정'과 상담 후속조치 '완료'", () => {
    expect(LEVEL_COLOR.ok).toBe("green");
    expect(LEVEL_COLOR.risk).toBe("danger");
  });
});

describe("상태 배지 단일 소스", () => {
  it("학생 상태는 라벨과 색이 한 함수에서 나온다", () => {
    expect(studentStatusMeta("on_hold")).toEqual({ label: "휴원", color: "amber", tone: "caution" });
    expect(studentStatusMeta(null)).toBeNull();
    // 미지의 코드도 raw enum을 그대로 노출하지 않고 최소한 색은 중립으로 떨어진다.
    expect(studentStatusMeta("__unknown__")?.color).toBe("neutral");
  });

  it("직원 역할 색은 positive(green)를 쓰지 않는다 — 신원이 상태로 오독되면 안 된다", () => {
    const roles = ["master", "admin", "manager", "teacher", "counselor", "accountant", "viewer"];
    for (const r of roles) expect(roleMeta(r).color, r).not.toBe("green");
  });

  it("역할 라벨은 ROLE_LABEL 단일 소스를 따른다 — master는 '원장'", () => {
    expect(roleMeta("master").label).toBe("원장");
    expect(roleMeta(null).label).toBe("—");
  });
});
