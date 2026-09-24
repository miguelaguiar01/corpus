import type { ProposalResponse } from "@corpus/contract";
import type { Project } from "@/projects/service";
import type { Proposal, ProposeResult } from "@/proposals/service";
import { writableSourcesClause } from "./writable-sources";
import { apiError } from "./body";

// The proposals service's refusals as API answers (§10, §11), the same
// reasons the editor shows.
export function proposalRefusal(
  result: Extract<ProposeResult, { ok: false }>,
  key: string,
  project: Project,
): Response {
  switch (result.reason) {
    case "not-found":
      return apiError(404, "not-found", `no string ${key}`);
    case "archived":
      return apiError(409, "archived", `${key} is archived`);
    case "not-writable":
      return apiError(
        422,
        "not-writable",
        `${key} comes from a source that pull cannot write; ${writableSourcesClause(project)}`,
      );
    case "key-is-text":
      // The same code as a source pull cannot write, since a client
      // acts on it the same way (#611); the reason is the string's.
      return apiError(
        422,
        "not-writable",
        `the text of ${key} is its key: change it in the code that calls t(), and the catalogue follows`,
      );
    case "invalid-icu":
      return apiError(
        422,
        "invalid-icu",
        result.message ??
          "the text is empty or does not parse as a source in the string's syntax",
      );
    case "invalid-key":
      return apiError(422, "invalid-key", `${key} is not a valid key`);
    case "unchanged":
      return apiError(409, "unchanged", "that is the current source text");
    case "exists":
      return apiError(409, "exists", `${key} already exists`);
    case "unknown-source":
      return apiError(
        422,
        "unknown-source",
        `the file is not a writable source of the project; ${writableSourcesClause(project)}`,
      );
  }
}

export function proposalCreated(proposal: Proposal, author: string): Response {
  const body: ProposalResponse = {
    id: proposal.id,
    kind: proposal.kind,
    key: proposal.key,
    file: proposal.file,
    text: proposal.text,
    status: "pending",
    author,
  };
  return Response.json(body, { status: 201 });
}
