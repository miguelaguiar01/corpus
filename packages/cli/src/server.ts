// The server's message body for an otherwise-unhandled non-2xx, if any.
export async function serverMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: string };
    return body.message ? `: ${body.message}` : "";
  } catch {
    return "";
  }
}
