import { useState } from 'react';
import { useNavigate } from 'react-router';
import { ConfirmDialog } from '../../components/feedback/ConfirmDialog';
import { EmptyState } from '../../components/feedback/EmptyState';
import { PageContainer } from '../../components/layout/PageContainer';
import { Button } from '../../components/ui/Button';
import { PageHeader } from '../../components/ui/PageHeader';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { useDocumentTitle } from '../../hooks/use-document-title';
import { ApiError } from '../../lib/api-client';
import { useToast } from '../../components/feedback/toast-context';
import { useAuth } from './auth-session';

export function AccountPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const user = auth.user;
  useDocumentTitle('Your account');

  if (!user) {
    return null;
  }

  return (
    <PageContainer className="py-8 sm:py-12">
      <PageHeader
        eyebrow="Signed in"
        title={user.displayName}
        description={user.email}
        actions={
          <Button variant="secondary" onClick={() => setConfirming(true)}>
            Sign out
          </Button>
        }
      />
      <section aria-labelledby="memberships-heading" className="mt-8">
        <h2 id="memberships-heading" className="font-display text-2xl font-semibold text-ink">
          Clinic access
        </h2>
        {user.memberships.length === 0 ? (
          <div className="mt-4">
            <EmptyState
              title="No clinic yet"
              description="This account is not a member of a clinic. Booking stays unavailable until a clinic adds you."
            />
          </div>
        ) : (
          <ul className="mt-4 grid gap-3">
            {user.memberships.map((membership) => (
              <li
                key={membership.businessId}
                className="flex flex-col gap-3 rounded-lg border border-line bg-white p-4 shadow-card sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="font-semibold text-ink">{membership.businessName}</p>
                  <p className="text-sm text-ink-soft">{membership.businessSlug}</p>
                </div>
                <StatusBadge role={membership.role} />
              </li>
            ))}
          </ul>
        )}
      </section>
      <ConfirmDialog
        open={confirming}
        title="Sign out?"
        description="This revokes the session stored for this browser. You can sign in again afterward."
        confirmLabel="Sign out"
        onClose={() => setConfirming(false)}
        onConfirm={() => {
          void auth.logout().then(
            () => {
              setConfirming(false);
              void navigate('/login');
            },
            (error: unknown) => {
              setConfirming(false);
              toast.show(
                error instanceof ApiError ? error.message : 'Sign-out failed. Try again.',
                'danger',
              );
            },
          );
        }}
      />
    </PageContainer>
  );
}
