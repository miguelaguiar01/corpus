// The project's languages a string takes, in the project's order: all
// of them unless it names its own (#1006).
export function takenLanguages(
  project: string[],
  own: string[] | null,
): string[] {
  return own ? project.filter((language) => own.includes(language)) : project;
}
