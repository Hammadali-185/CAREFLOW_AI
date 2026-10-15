import { Alert } from '../../components/feedback/Alert';
import { LoadingIndicator } from '../../components/feedback/LoadingIndicator';
import { Badge } from '../../components/ui/Badge';
import { useApiClient } from '../../hooks/use-api';
import { useHealthQuery, useReadinessQuery } from '../../hooks/use-service-status';
import { ApiError } from '../../lib/api-client';

export function ServiceStatus() {
  const api = useApiClient();
  const healthQuery = useHealthQuery();
  const readinessQuery = useReadinessQuery();

  return (
    <section
      aria-labelledby="service-status-heading"
      aria-live="polite"
      className="min-w-0 rounded-lg border border-line bg-white p-5 shadow-card"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="service-status-heading" className="font-display text-2xl font-semibold text-ink">
          API connection
        </h2>
        <Badge tone="info">Live check</Badge>
      </div>
      <p className="mt-3 text-sm leading-6 break-all text-ink-soft">
        Calls <span className="font-semibold text-ink">{api.baseUrl}/api/health</span> and{' '}
        <span className="font-semibold text-ink">/api/ready</span>.
      </p>
      <div className="mt-5">
        <StatusBody healthQuery={healthQuery} readinessQuery={readinessQuery} />
      </div>
    </section>
  );
}

function StatusBody({
  healthQuery,
  readinessQuery,
}: {
  healthQuery: ReturnType<typeof useHealthQuery>;
  readinessQuery: ReturnType<typeof useReadinessQuery>;
}) {
  if (healthQuery.isPending || readinessQuery.isPending) {
    return <LoadingIndicator label="Checking the API" />;
  }

  if (healthQuery.isError) {
    return (
      <Alert tone="danger" title="API unreachable">
        {errorMessage(healthQuery.error)}
      </Alert>
    );
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-2">
        <Badge tone="success">API up</Badge>
        {readinessQuery.isSuccess && readinessQuery.data.database === 'up' ? (
          <Badge tone="success">Database up</Badge>
        ) : null}
        {readinessQuery.isSuccess && readinessQuery.data.database === 'down' ? (
          <Badge tone="danger">Database down</Badge>
        ) : null}
      </div>
      {readinessQuery.isError ? (
        <Alert tone="warning" title="Readiness check failed">
          {errorMessage(readinessQuery.error)}
        </Alert>
      ) : null}
      {readinessQuery.isSuccess && readinessQuery.data.database === 'down' ? (
        <Alert tone="warning" title="Database is not ready">
          The API process is running, but it could not query PostgreSQL. Start the database and
          apply migrations before relying on readiness.
        </Alert>
      ) : null}
    </div>
  );
}

function errorMessage(error: unknown) {
  if (error instanceof ApiError) {
    return error.message;
  }

  return 'The status check failed.';
}
