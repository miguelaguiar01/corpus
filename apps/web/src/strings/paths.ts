// The editor's language switcher (§9.3): the source language is the
// proofreading view (no `language`); the queue is kept only when the
// switched-to row is in it, so next and previous never point at a row
// the queue does not contain.
export function languageSwitchPath(input: {
  slug: string;
  key: string;
  sourceLanguage: string;
  queue?: { kind: string; languages: string[] };
}): (next: string) => string {
  return (next) =>
    stringPath(input.slug, input.key, {
      language: next === input.sourceLanguage ? undefined : next,
      queue: input.queue?.languages.includes(next)
        ? input.queue.kind
        : undefined,
    });
}

export function stringPath(
  slug: string,
  key: string,
  query: Record<string, string | undefined> = {},
): string {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(query)) {
    if (value !== undefined) params.set(name, value);
  }
  const suffix = params.size ? `?${params}` : "";
  return `/p/${slug}/s/${encodeURIComponent(key)}${suffix}`;
}
