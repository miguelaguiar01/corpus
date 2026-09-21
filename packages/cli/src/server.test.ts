import { expect, test } from "vitest";
import { CliError } from "./config";
import { GZIP_FROM_BYTES, request, serverMessage } from "./server";

test("a server that is not a URL is a CliError naming it, not a stack trace", async () => {
  await expect(request("s/api/status", "tok")).rejects.toBeInstanceOf(CliError);
  await expect(request("s/api/status", "tok")).rejects.toThrow(
    /could not reach the server at s\/api\/status/,
  );
});

test("a closed port is the same error", async () => {
  await expect(
    request("http://127.0.0.1:1/api/status", "tok"),
  ).rejects.toBeInstanceOf(CliError);
});

test("serverMessage reads a message when there is one", async () => {
  expect(
    await serverMessage(Response.json({ message: "why" }, { status: 500 })),
  ).toBe(": why");
  expect(await serverMessage(new Response("nope", { status: 500 }))).toBe("");
});

test("a large body travels gzipped with the header; a small one as plain JSON", async () => {
  const { createServer } = await import("node:http");
  const { gunzipSync } = await import("node:zlib");
  const seen: { encoding: string | undefined; body: string }[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks);
      const encoding = req.headers["content-encoding"];
      seen.push({
        encoding,
        body: (encoding === "gzip" ? gunzipSync(raw) : raw).toString("utf8"),
      });
      res.end("{}");
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  try {
    const small = { a: "x" };
    const large = { a: "x".repeat(GZIP_FROM_BYTES) };
    await request(`http://127.0.0.1:${port}/`, "tok", {
      method: "POST",
      body: small,
    });
    await request(`http://127.0.0.1:${port}/`, "tok", {
      method: "POST",
      body: large,
    });
    expect(seen[0]).toEqual({
      encoding: undefined,
      body: JSON.stringify(small),
    });
    expect(seen[1]?.encoding).toBe("gzip");
    expect(seen[1]?.body).toBe(JSON.stringify(large));
  } finally {
    server.close();
  }
});
