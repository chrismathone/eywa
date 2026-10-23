"use client";

import { useSheetT, useSheetTf } from "@/features/teacher-view/lang-context";
import { NOTICE_TEMPLATE_TAGS, fillNoticeTemplate } from "../notice-template";

const TAG_HINTS = {
  학생: "os.n.tagStudent",
  학생이름: "os.n.tagGivenName",
  작성자: "os.n.tagAuthor",
} as const;

type NoticeTag = (typeof NOTICE_TEMPLATE_TAGS)[number];
const tagText = (tag: NoticeTag) => `{${tag}}`;

/**
 * 사전 문구의 태그 자리 — 태그는 화면 말(한국어/English)과 상관없이 **이 한글 그대로** 입력한다.
 * 영어 문구엔 한글을 두지 않으므로(`i18n.test.ts`) 자리(`{tagStudent}` 등)만 두고 여기서 채운다.
 */
export const NOTICE_TAG_PARAMS = {
  tagStudent: tagText("학생"),
  tagGiven: tagText("학생이름"),
  tagAuthor: tagText("작성자"),
} as const;

/** 예시의 실제 결과 — 발송과 같은 함수로 채운다(학생 이름은 한글로 저장돼 있어 영어 화면에서도 한글로 들어간다). */
const EXAMPLE_CONTEXT = { studentName: "김민서G", authorName: "이수진" };
const exampleFill = (tag: NoticeTag) => {
  const r = fillNoticeTemplate(tagText(tag), EXAMPLE_CONTEXT);
  return r.ok ? r.body : tagText(tag);
};
const EXAMPLE_PARAMS = {
  ...NOTICE_TAG_PARAMS,
  teacher: EXAMPLE_CONTEXT.authorName,
  student: EXAMPLE_CONTEXT.studentName,
  full: exampleFill("학생"),
  given: exampleFill("학생이름"),
  author: exampleFill("작성자"),
};

export function NoticeTemplateHelp() {
  const t = useSheetT();
  const tf = useSheetTf();
  return (
    <div className="bg-bg-soft text-text-dim space-y-1.5 rounded-md px-3 py-2 text-xs">
      <p className="text-foreground font-medium">{t("os.n.tagHeading")}</p>
      <dl className="flex flex-wrap gap-x-5 gap-y-1">
        {NOTICE_TEMPLATE_TAGS.map(tag => (
          <div key={tag} className="flex items-baseline gap-1.5">
            <dt className="text-primary font-bold">{`{${tag}}`}</dt>
            <dd>{t(TAG_HINTS[tag])}</dd>
          </div>
        ))}
      </dl>
      <p>{t("os.n.tagHint")}</p>
      <details>
        <summary className="text-primary cursor-pointer font-medium">{t("os.n.tagExamples")}</summary>
        <div className="mt-2 space-y-1.5">
          <p>{tf("os.n.tagExampleStudent", EXAMPLE_PARAMS)}</p>
          <ul className="space-y-1">
            <li>{tf("os.n.tagExampleFull", EXAMPLE_PARAMS)}</li>
            <li>{tf("os.n.tagExampleGiven", EXAMPLE_PARAMS)}</li>
            <li>{tf("os.n.tagExampleAuthor", EXAMPLE_PARAMS)}</li>
          </ul>
          <p>{t("os.n.tagNameFallback")}</p>
          <p>{t("os.n.tagPostedEdit")}</p>
        </div>
      </details>
    </div>
  );
}
