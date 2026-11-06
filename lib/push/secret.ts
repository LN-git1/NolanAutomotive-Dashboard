import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Checks a scheduler's `Authorization: Bearer <secret>` header against the
 * secret in the environment, in constant time. Both sides are hashed first so
 * the comparison always sees equal-length input and leaks nothing about the
 * secret's length or prefix. A missing secret never matches.
 */
export function hasValidBearer(request: Request, secret: string | undefined): boolean {
  if (!secret) return false;

  const header = request.headers.get('authorization') ?? '';
  const expected = createHash('sha256').update(`Bearer ${secret}`).digest();
  const actual = createHash('sha256').update(header).digest();
  return timingSafeEqual(expected, actual);
}
