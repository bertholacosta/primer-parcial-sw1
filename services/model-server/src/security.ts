import { createHash, randomBytes, randomUUID } from "node:crypto";
import argon2 from "argon2";
import { SignJWT, jwtVerify } from "jose";

export interface AccessIdentity {
  userId: string;
  email: string;
}

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 });
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

export function newOpaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

export function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function signAccessToken(identity: AccessIdentity, secret: string, ttlSeconds: number): Promise<{ token: string; expiresAt: Date }> {
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
  const token = await new SignJWT({ email: identity.email })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(identity.userId)
    .setJti(randomUUID())
    .setIssuedAt()
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(new TextEncoder().encode(secret));
  return { token, expiresAt };
}

export async function verifyAccessToken(token: string, secret: string): Promise<AccessIdentity> {
  const verified = await jwtVerify(token, new TextEncoder().encode(secret), { algorithms: ["HS256"] });
  if (!verified.payload.sub || typeof verified.payload.email !== "string") throw new Error("AUTH_SESSION_INVALID");
  return { userId: verified.payload.sub, email: verified.payload.email };
}
