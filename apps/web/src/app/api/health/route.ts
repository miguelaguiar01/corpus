// Machine-readable liveness endpoint for the Docker container (#16).
export function GET(): Response {
  return Response.json({ status: "ok" });
}
