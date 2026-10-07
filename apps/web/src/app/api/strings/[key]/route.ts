import {
  partsOf,
  type StringResponse,
  isHtml,
  vueDefaultForms,
} from "@corpus/contract";
import { getDb } from "@/db";
import { authenticateProject } from "@/api/bearer";
import { apiError } from "@/api/body";
import { slotsOf } from "@/strings/slots";
import { pendingForString } from "@/proposals/service";
import { stringDetail } from "@/strings/detail";
import { siblingsOf } from "@/strings/siblings";
import { problemOf } from "@/translations/validation-message";

// What the editor shows for one string (§9.3), for an agent (§10).
export async function GET(
  request: Request,
  context: { params: Promise<{ key: string }> },
): Promise<Response> {
  const db = getDb();
  const auth = authenticateProject(db, request);
  if (!auth.ok) return auth.response;
  const { project } = auth;

  const { key } = await context.params;
  const detail = stringDetail(db, project.id, key);
  if (!detail) return apiError(404, "not-found", `no string ${key}`);

  const pending = pendingForString(db, detail.string.id);
  const siblings = siblingsOf(db, project.id, {
    id: detail.string.id,
    key: detail.string.key,
    type: detail.string.type,
    sourceLanguage: project.sourceLanguage,
  });
  const translations: StringResponse["translations"] = {};
  for (const [language, row] of Object.entries(detail.translations)) {
    translations[language] = {
      state: row.state,
      stale: row.stale,
      text: row.text,
      agentDraft: row.agentDraft,
      invalid: row.invalid,
      problem:
        row.invalid && row.text !== null
          ? problemOf(
              detail.string.source,
              row.text,
              language,
              detail.string.syntax,
              detail.string.richText,
              detail.string.arguments,
              detail.string.key,
              project.sourceLanguage,
              detail.string.placeholderSyntaxes,
              detail.string.pluralForms?.[language],
              detail.string.pluralShared?.[language],
            )
          : null,
      ...(row.suggestion !== null && { suggestion: row.suggestion }),
    };
  }
  const parts = partsOf(
    detail.string.source,
    detail.string.syntax,
    detail.string.placeholderSyntaxes ?? undefined,
  );
  const body: StringResponse = {
    key: detail.string.key,
    type: detail.string.type,
    source: detail.string.source,
    sourceLanguage: project.sourceLanguage,
    file: detail.string.file,
    archived: detail.string.archived,
    placeholders: [...parts.placeholders],
    selects: [...parts.selects],
    plurals: [...parts.plurals],
    forms: parts.forms,
    ...(detail.string.pluralRules === "default" &&
      parts.forms > 1 && {
        formMeanings: vueDefaultForms(parts.forms).map(
          (meaning) => meaning ?? "unused",
        ),
      }),
    tags: [...parts.tags],
    // Every one under HTML, whose tags a translation writes its own way;
    // elsewhere a tag carries its own in `tags`, but one read as prose.
    ...((attributes) =>
      attributes.size > 0 && { attributePlaceholders: [...attributes] })(
      isHtml(detail.string.richText ?? undefined)
        ? parts.attributePlaceholders
        : parts.proseAttributePlaceholders,
    ),
    // An agent reads either HTML reading as "html" (#988).
    richText: isHtml(detail.string.richText ?? undefined) ? "html" : null,
    library: detail.string.syntax,
    syntax: detail.string.syntax,
    // An empty list is none: an exporter may send one (#737).
    ...(detail.string.arguments?.length && {
      arguments: detail.string.arguments,
    }),
    ...(detail.string.languages && {
      languages: detail.string.languages.filter(
        (l) => l !== project.sourceLanguage,
      ),
    }),
    slots: slotsOf(
      detail.string.source,
      detail.declarations,
      detail.string.examples,
      project.sourceLanguage,
      detail.string.syntax,
      detail.string.placeholderSyntaxes ?? undefined,
      project.languages.filter(
        (l) =>
          l !== project.sourceLanguage &&
          (!detail.string.languages || detail.string.languages.includes(l)),
      ),
    ),
    examples: detail.string.examples ?? [],
    metadata: detail.string.metadata,
    note: detail.string.note,
    stringNote: detail.string.stringNote,
    keyIsText: detail.string.keyIsText,
    ...(detail.string.generated && { generated: detail.string.generated }),
    ...(detail.string.placeholderSyntaxes && {
      placeholderSyntaxes: detail.string.placeholderSyntaxes,
    }),
    glossary: detail.string.glossary,
    entities: detail.entities,
    translations,
    proposal: pending
      ? {
          id: pending.id,
          kind: pending.kind,
          text: pending.text,
          author: pending.author,
        }
      : null,
    siblings: siblings.items.map(({ key, source, translations }) => ({
      key,
      source,
      translations,
    })),
    siblingCount: siblings.total,
  };
  return Response.json(body);
}
