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
