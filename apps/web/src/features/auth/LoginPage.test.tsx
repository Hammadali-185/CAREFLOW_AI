import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderRoute } from '../../test/render-app';

describe('sign in and registration', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith('/api/auth/me')) {
          return json({ error: { code: 'UNAUTHENTICATED', message: 'Sign in to continue.' } }, 401);
        }
        if (url.endsWith('/api/auth/login')) {
          const headers = new Headers(init?.headers);
          expect(init?.credentials).toBe('include');
          expect(headers.get('X-CareFlow-Request')).toBe('1');
          return json(
            {
              error: {
                code: 'AUTHENTICATION_FAILED',
                message: 'The email or password is incorrect.',
              },
            },
            401,
          );
        }
        return json({ error: { code: 'NOT_FOUND', message: 'Missing.' } }, 404);
      }),
    );
  });

  it('validates the sign-in form and shows the API failure without creating a local session', async () => {
    const user = userEvent.setup();
    renderRoute('/login');

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Enter a valid email address.')).toBeVisible();

    await user.type(screen.getByLabelText('Email'), 'ada@clinic.test');
    await user.type(screen.getByLabelText('Password'), 'not-the-password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('The email or password is incorrect.')).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Ada' })).not.toBeInTheDocument();
  });

  it('requires a clinic slug and matching passwords before registration', async () => {
    const user = userEvent.setup();
    renderRoute('/register');

    expect(await screen.findByRole('heading', { name: 'Create account' })).toBeVisible();
    expect(screen.getByLabelText('Role')).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText('Enter your name.')).toBeVisible();
    expect(screen.getByText(/harbor-light/i)).toBeVisible();
  });

  it('shows a notice when the email is already registered', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/api/auth/me')) {
          return json({ error: { code: 'UNAUTHENTICATED', message: 'Sign in to continue.' } }, 401);
        }
        if (url.endsWith('/api/auth/signup')) {
          return json(
            {
              error: {
                code: 'ACCOUNT_EXISTS',
                message: 'An account with that email already exists.',
              },
            },
            409,
          );
        }
        return json({ error: { code: 'NOT_FOUND', message: 'Missing.' } }, 404);
      }),
    );
    renderRoute('/register');

    await user.type(await screen.findByLabelText('Full name'), 'Ada Patient');
    await user.type(screen.getByLabelText('Email'), 'ada@clinic.test');
    await user.type(screen.getByLabelText('Clinic slug'), 'harbor-light');
    await user.type(screen.getByLabelText('Password'), 'DemoCareflow!2026');
    await user.type(screen.getByLabelText('Confirm password'), 'DemoCareflow!2026');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findAllByText('You already have an account')).toHaveLength(2);
    expect(screen.queryByText('Registration failed')).not.toBeInTheDocument();
  });

  it('sends visitors without a session from the account page to sign in', async () => {
    renderRoute('/account');
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeVisible();
  });
});

function json(body: unknown, status: number) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}
