"use client";

import { useSheetT } from "@/features/teacher-view/lang-context";
import { NOTICE_TEMPLATE_TAGS } from "../notice-template";

const TAG_HINTS = {
  학생: "os.n.tagStudent",
  학생이름: "os.n.tagGivenName",
  작성자: "os.n.tagAuthor",
} as const;

export function NoticeTemplateHelp() {
  const t = useSheetT();
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
          <p>{t("os.n.tagExampleStudent")}</p>
          <ul className="space-y-1">
            <li>{t("os.n.tagExampleFull")}</li>
            <li>{t("os.n.tagExampleGiven")}</li>
            <li>{t("os.n.tagExampleAuthor")}</li>
          </ul>
          <p>{t("os.n.tagNameFallback")}</p>
          <p>{t("os.n.tagPostedEdit")}</p>
        </div>
      </details>
    </div>
  );
}
