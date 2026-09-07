export function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

// Every value of a repeatable option, in order.
export function options(args: string[], name: string): string[] {
  const values: string[] = [];
  args.forEach((arg, index) => {
    const value = args[index + 1];
    if (arg === name && value !== undefined) values.push(value);
  });
  return values;
}
