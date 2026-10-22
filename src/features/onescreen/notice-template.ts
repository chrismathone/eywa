import { fillReportTemplate, templateTokens } from "@/features/report-templates/fill";
import { parentStudentGivenName, parentStudentName } from "@/features/report-templates/student-name";

export const NOTICE_BODY_MAX = 4000;
export const NOTICE_TEMPLATE_TAGS = ["학생", "학생이름", "작성자"] as const;

export function hasNoticeTemplateTags(body: string): boolean {
  return templateTokens(body).length > 0;
}

export function noticeTemplateError(body: string): string | null {
  if (/\{\{|\}\}/.test(body)) return "태그는 {학생}처럼 중괄호를 한 겹만 사용해 주세요";
  const unknown = templateTokens(body).filter(token => !(NOTICE_TEMPLATE_TAGS as readonly string[]).includes(token));
  return unknown.length ? `사용할 수 없는 태그입니다: ${unknown.map(token => `{${token}}`).join(", ")} — {학생}, {학생이름}, {작성자}를 사용할 수 있습니다` : null;
}

/** 대상 확정 뒤 서버에서 학생별로 채운다. 태그 없는 글은 작성한 줄바꿈을 그대로 보존한다. */
export function fillNoticeTemplate(
  template: string,
  context: { studentName: string; authorName: string },
): { ok: true; body: string } | { ok: false; error: string } {
  const error = noticeTemplateError(template);
  if (error) return { ok: false, error };
  const tags = templateTokens(template);
  const author = context.authorName.trim();
  const values = {
    학생: parentStudentName(context.studentName),
    학생이름: parentStudentGivenName(context.studentName),
    작성자: author ? (author.endsWith("선생님") ? author : `${author} 선생님`) : "",
  };
  if (tags.some(tag => !values[tag as keyof typeof values]))
    return { ok: false, error: "태그에 넣을 이름을 확인하지 못했습니다. 학생과 작성자 정보를 확인해 주세요" };
  const body = tags.length ? fillReportTemplate(template, values).text : template.trim();
  if (!body) return { ok: false, error: "내용을 입력하세요" };
  if (body.length > NOTICE_BODY_MAX)
    return { ok: false, error: `학생별 공지가 너무 깁니다(태그 적용·개별 내용 포함 최대 ${NOTICE_BODY_MAX}자)` };
  return { ok: true, body };
}
