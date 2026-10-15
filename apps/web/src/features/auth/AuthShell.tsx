import type { ReactNode } from 'react';
import { PageContainer } from '../../components/layout/PageContainer';
import { PageHeader } from '../../components/ui/PageHeader';
import { useDocumentTitle } from '../../hooks/use-document-title';

export function AuthShell({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description: string;
  children: ReactNode;
  footer: ReactNode;
}) {
  useDocumentTitle(title);

  return (
    <PageContainer className="py-8 sm:py-12">
      <div className="mx-auto w-full max-w-md">
        <PageHeader eyebrow="Account" title={title} description={description} />
        <div className="mt-6">{children}</div>
        <div className="mt-6 text-sm leading-6 text-ink-soft">{footer}</div>
      </div>
    </PageContainer>
  );
}
