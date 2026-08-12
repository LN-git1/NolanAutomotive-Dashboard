import { SignJWT, jwtVerify } from 'jose';

import { SESSION_MAX_AGE_SECONDS } from './constants';

/**
 * Stateless session tokens.
 *
 * `jose` is used rather than `jsonwebtoken` because this module is imported by
 * `middleware.ts`, which runs on the Edge runtime. Edge has no Node `crypto`
 * module, so `jsonwebtoken` fails there. `jose` is built on Web Crypto and
 * works in both runtimes.
 *
 * Deliberately free of `next/headers` so it stays runtime-agnostic and unit
 * testable; cookie plumbing lives in `require-session.ts` and the auth routes.
 */

const SUBJECT = 'admin';

function getSecretKey(): Uint8Array {
  const secret = process.env.SESSION_SECRET;

  if (!secret || secret.length < 32) {
    throw new Error(
      'SESSION_SECRET must be set to at least 32 characters. Generate one with: openssl rand -base64 32',
    );
  }

  return new TextEncoder().encode(secret);
}

export async function createSessionToken(): Promise<string> {
  return new SignJWT({ sub: SUBJECT })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE_SECONDS}s`)
    .sign(getSecretKey());
}

/**
 * Returns true only for a token this server signed, that has not expired and
 * has not been tampered with. Any failure — malformed, wrong signature,
 * expired, wrong subject — is a plain false. Fail closed, never throw.
 */
export async function verifySessionToken(token: string | undefined | null): Promise<boolean> {
  if (!token) return false;

  try {
    const { payload } = await jwtVerify(token, getSecretKey(), {
      algorithms: ['HS256'],
    });
    return payload.sub === SUBJECT;
  } catch {
    return false;
  }
}
