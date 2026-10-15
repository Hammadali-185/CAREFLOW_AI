import { Link } from 'react-router';
import { EmptyState } from '../components/feedback/EmptyState';
import { PageContainer } from '../components/layout/PageContainer';
import { buttonClassName } from '../components/ui/button-styles';
import { useDocumentTitle } from '../hooks/use-document-title';

export function NotFoundPage() {
  useDocumentTitle('Page not found');

  return (
    <PageContainer className="py-16">
      <EmptyState
        title="This page is not part of CareFlow yet"
        description="The address does not match a screen in this phase. Booking and account tools are still unfinished."
        action={
          <Link to="/" className={buttonClassName('primary')}>
            Back to home
          </Link>
        }
      />
    </PageContainer>
  );
}
