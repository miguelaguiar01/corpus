import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { INVITE_PATH, SESSION_COOKIE } from "./constants";
import { getSessionUser, type User } from "./service";

export async function currentUser(): Promise<User | undefined> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return undefined;
  return getSessionUser(getDb(), token);
}

// Guard for every protected server component: resolves the session or
// sends the visitor to the invite prompt (§10).
export async function requireUser(): Promise<User> {
  const user = await currentUser();
  if (!user) redirect(INVITE_PATH);
  return user;
}
