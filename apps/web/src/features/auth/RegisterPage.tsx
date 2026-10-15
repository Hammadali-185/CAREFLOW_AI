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
import { Select } from '../../components/ui/Select';
import { ApiError } from '../../lib/api-client';
import { homePath } from '../../app/navigation';
import { AuthShell } from './AuthShell';
import { useAuth } from './auth-session';
import { registerSchema, type RegisterValues } from './schemas';

export function RegisterPage() {
  const auth = useAuth();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<RegisterValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      displayName: '',
      email: '',
      password: '',
      confirmPassword: '',
      businessSlug: '',
    },
  });
  const errors = form.formState.errors;

  if (auth.status === 'authenticated') {
    return <Navigate to={homePath(auth.user?.memberships ?? [])} replace />;
  }

  return (
    <AuthShell
      title="Create account"
      description="Registration creates a patient account at an existing clinic. Staff and clinic administrator access is granted by the clinic, not by this form."
      footer={
        <>
          Already have an account?{' '}
          <Link to="/login" className="focus-ring rounded-sm font-semibold text-teal-deep">
            Sign in
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
            await auth.signup({
              displayName: values.displayName,
              email: values.email,
              password: values.password,
              businessSlug: values.businessSlug,
            });
          } catch (error) {
            setFormError(
              error instanceof ApiError ? error.message : 'Registration failed. Try again.',
            );
          }
        })}
      >
        {formError ? (
          <Alert tone="danger" title="Registration failed">
            {formError}
          </Alert>
        ) : null}
        <FormField id="displayName" label="Full name" error={errors.displayName?.message}>
          <Input
            id="displayName"
            autoComplete="name"
            required
            aria-invalid={errors.displayName ? true : undefined}
            aria-describedby={fieldDescribedBy('displayName', errors.displayName?.message)}
            {...form.register('displayName')}
          />
        </FormField>
        <FormField
          id="role"
          label="Role"
          hint="Staff and clinic administrator roles are assigned by the clinic."
        >
          <Select
            id="role"
            defaultValue="patient"
            disabled
            aria-describedby={fieldDescribedBy('role', undefined, true)}
          >
            <option value="patient">Patient</option>
          </Select>
        </FormField>
        <FormField id="email" label="Email" error={errors.email?.message}>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            autoCapitalize="none"
            spellCheck={false}
            required
            aria-invalid={errors.email ? true : undefined}
            aria-describedby={fieldDescribedBy('email', errors.email?.message)}
            {...form.register('email')}
          />
        </FormField>
        <FormField
          id="businessSlug"
          label="Clinic slug"
          hint="The demo clinic slug is harbor-light."
          error={errors.businessSlug?.message}
        >
          <Input
            id="businessSlug"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            required
            aria-invalid={errors.businessSlug ? true : undefined}
            aria-describedby={fieldDescribedBy('businessSlug', errors.businessSlug?.message, true)}
            {...form.register('businessSlug')}
          />
        </FormField>
        <FormField id="password" label="Password" error={errors.password?.message}>
          <PasswordInput
            id="password"
            autoComplete="new-password"
            required
            aria-invalid={errors.password ? true : undefined}
            aria-describedby={fieldDescribedBy('password', errors.password?.message)}
            {...form.register('password')}
          />
        </FormField>
        <FormField
          id="confirmPassword"
          label="Confirm password"
          error={errors.confirmPassword?.message}
        >
          <PasswordInput
            id="confirmPassword"
            autoComplete="new-password"
            required
            aria-invalid={errors.confirmPassword ? true : undefined}
            aria-describedby={fieldDescribedBy('confirmPassword', errors.confirmPassword?.message)}
            {...form.register('confirmPassword')}
          />
        </FormField>
        <LoadingButton type="submit" loading={form.formState.isSubmitting}>
          Create account
        </LoadingButton>
      </form>
    </AuthShell>
  );
}
