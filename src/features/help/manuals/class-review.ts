import type { HelpManual } from "../types";

export const classReview: HelpManual = {
  slug: "class-review",
  title: "직원 평가",
  href: "/class-review",
  menuKey: "class_review",
  group: "지원",
  layout: "list",
  summary: "직원 평가지입니다. 강사는 본인 평가지의 본인 채점만 봅니다. 개설·삭제는 사무실입니다.",
  related: ["staff", "classes"],
  callouts: [
    {
      n: 1,
      label: "새 평가",
      zone: "header",
      body: "사무실이 평가지를 엽니다. 관찰자와 정원을 정합니다.",
    },
    {
      n: 2,
      label: "문항 편집",
      zone: "header",
      body: "평가 문항 템플릿입니다.",
    },
    {
      n: 3,
      label: "내 채점",
      zone: "board",
      body: "강사는 자기 칸만 씁니다. 남의 점수·이름·정원은 보이지 않습니다. ‘다른 강사 뷰’에서도 그 강사의 눈으로 잘립니다.",
    },
  ],
};
