import { describe, expect, it } from 'vitest';
import { sessionCookieOptions } from '../src/modules/auth/cookies.js';

describe('session cookies', () => {
  it('keeps local sessions on the same site', () => {
    expect(sessionCookieOptions('development')).toMatchObject({
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      partitioned: false,
    });
    expect(sessionCookieOptions('test').sameSite).toBe('lax');
  });

  it('sends a partitioned cookie when the site and API are cross-site', () => {
    expect(sessionCookieOptions('production')).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      partitioned: true,
    });
  });
});
