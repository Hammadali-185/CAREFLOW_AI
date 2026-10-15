import { Link } from 'react-router';
import { Alert } from '../../components/feedback/Alert';
import { Button } from '../../components/ui/Button';

export function AssistantNotice({
  title,
  message,
  formHref,
  onRetry,
}: {
  title: string;
  message: string;
  formHref: string;
  onRetry?: () => void;
}) {
  return (
    <Alert tone="danger" title={title}>
      <p>{message}</p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <Link to={formHref} className="font-semibold text-teal-deep underline">
          Use the booking form
        </Link>
        {onRetry ? (
          <Button variant="secondary" onClick={onRetry}>
            Try again
          </Button>
        ) : null}
      </div>
    </Alert>
  );
}
