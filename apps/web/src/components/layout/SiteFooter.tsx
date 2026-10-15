import { PageContainer } from './PageContainer';

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-line">
      <PageContainer className="py-6">
        <p className="max-w-3xl text-sm leading-6 text-ink-soft">
          CareFlow AI keeps the session on this device. You can book from the form or the scheduling
          assistant. A visit is saved only after you confirm it.
        </p>
      </PageContainer>
    </footer>
  );
}
