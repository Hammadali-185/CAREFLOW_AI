import { Navigate, Outlet, useLocation } from 'react-router';
import { ErrorState } from '../../components/feedback/ErrorState';
import { LoadingSkeleton } from '../../components/feedback/LoadingSkeleton';
import { PageContainer } from '../../components/layout/PageContainer';
import { Button } from '../../components/ui/Button';
import { useAuth } from './auth-session';

export function RequireAuth() {
  const auth = useAuth();
  const location = useLocation();

  if (auth.status === 'loading') {
    return (
      <PageContainer className="py-8">
        <LoadingSkeleton label="Checking your session" />
      </PageContainer>
    );
  }

  if (auth.status === 'error') {
    return (
      <PageContainer className="py-8">
        <ErrorState
          title="CareFlow could not check your session"
          description="The account service did not respond. Your password was not sent again."
          action={<Button onClick={() => void auth.refresh()}>Try again</Button>}
        />
      </PageContainer>
    );
  }

  if (auth.status === 'anonymous') {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <Outlet />;
}
