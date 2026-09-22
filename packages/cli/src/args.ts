import { CliError } from "./config";

export function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

// Every value of a repeatable option, in order; the option without a
// value, or followed by another flag, is an error rather than nothing.
export function options(args: string[], name: string): string[] {
  const values: string[] = [];
  args.forEach((arg, index) => {
    if (arg !== name) return;
    const value = args[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new CliError(`${name} needs a value`);
    }
    values.push(value);
  });
  return values;
}

// A flag the command does not know is refused rather than ignored (#520):
// `corpus pull --langs pt-PT` would otherwise pull every language and a
// CI gate would go green having checked something else. `corpus agent`
// refuses its own, in tokenize.
export function refuseUnknown(
  command: string,
  args: string[],
  known: readonly string[],
): void {
  for (const arg of args) {
    if (!arg.startsWith("--")) continue;
    const name = arg.split("=")[0]!;
    if (known.includes(name)) continue;
    // A prefix of two characters matches half the table, so a suggestion
    // is only offered for something long enough to be a typo of one
    // flag rather than a stub of several.
    const near =
      name.length >= 4
        ? known.filter((flag) => flag.startsWith(name) || name.startsWith(flag))
        : [];
    throw new CliError(
      `${command}: unknown option ${name}${near.length === 1 ? `; did you mean ${near[0]}?` : ""}`,
    );
  }
}
