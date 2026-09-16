import type { Project } from "@/projects/service";

// The clause a refusal ends with and the shape `/api/status` carries
// (§10): the declared paths, none declared with this CLI, or a push
// that predates the declaration.
export function writableSources(project: Project): string[] | null {
  return project.sources ? project.sources.map((s) => s.path) : null;
}

export function writableSourcesClause(project: Project): string {
  const paths = writableSources(project);
  if (paths === null) {
    return "the project was last pushed before sources were declared; run corpus push with this CLI";
  }
  if (paths.length === 0) return "the project has no writable source";
  return `the writable sources are ${paths.join(", ")}`;
}
