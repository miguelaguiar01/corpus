import { expect, test } from "vitest";
import { CliError } from "./config";
import { request, serverMessage } from "./server";

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
