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
