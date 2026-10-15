import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, Navigate } from 'react-router';
import { Alert } from '../../components/feedback/Alert';
import { FormField } from '../../components/ui/FormField';
import { fieldDescribedBy } from '../../components/ui/field-described-by';
import { Input } from '../../components/ui/Input';
import { LoadingButton } from '../../components/ui/LoadingButton';
import { PasswordInput } from '../../components/ui/PasswordInput';
import { ApiError } from '../../lib/api-client';
import { homePath } from '../../app/navigation';
import { AuthShell } from './AuthShell';
import { useAuth } from './auth-session';
import { loginSchema, type LoginValues } from './schemas';

export function LoginPage() {
  const auth = useAuth();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  if (auth.status === 'authenticated') {
    return <Navigate to={homePath(auth.user?.memberships ?? [])} replace />;
  }

  return (
    <AuthShell
      title="Sign in"
      description="Use the email and password for your CareFlow account. A session stays on this browser until you sign out or it expires."
      footer={
        <>
          Need an account?{' '}
          <Link to="/register" className="focus-ring rounded-sm font-semibold text-teal-deep">
            Create account
          </Link>
          . Or return{' '}
          <Link to="/" className="focus-ring rounded-sm font-semibold text-teal-deep">
            home
          </Link>
          .
        </>
      }
    >
      <form
        className="grid gap-5 rounded-lg border border-line bg-white p-5 shadow-card"
        noValidate
        onSubmit={form.handleSubmit(async (values) => {
          setFormError(null);
          try {
            await auth.login(values);
          } catch (error) {
            setFormError(error instanceof ApiError ? error.message : 'Sign-in failed. Try again.');
          }
        })}
      >
        {formError ? (
          <Alert tone="danger" title="Sign-in failed">
            {formError}
          </Alert>
        ) : null}
        <FormField id="email" label="Email" error={form.formState.errors.email?.message}>
          <Input
            id="email"
            type="email"
            autoComplete="username"
            inputMode="email"
            autoCapitalize="none"
            spellCheck={false}
            required
            aria-invalid={form.formState.errors.email ? true : undefined}
            aria-describedby={fieldDescribedBy('email', form.formState.errors.email?.message)}
            {...form.register('email')}
          />
        </FormField>
        <FormField id="password" label="Password" error={form.formState.errors.password?.message}>
          <PasswordInput
            id="password"
            autoComplete="current-password"
            required
            aria-invalid={form.formState.errors.password ? true : undefined}
            aria-describedby={fieldDescribedBy('password', form.formState.errors.password?.message)}
            {...form.register('password')}
          />
        </FormField>
        <LoadingButton type="submit" loading={form.formState.isSubmitting}>
          Sign in
        </LoadingButton>
      </form>
    </AuthShell>
  );
}
