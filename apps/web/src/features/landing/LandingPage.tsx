import { Link } from 'react-router';
import { PageContainer } from '../../components/layout/PageContainer';
import { Badge } from '../../components/ui/Badge';
import { buttonClassName } from '../../components/ui/button-styles';
import { Card } from '../../components/ui/Card';
import { useDocumentTitle } from '../../hooks/use-document-title';
import { ServiceStatus } from './ServiceStatus';

const plannedAreas = [
  {
    eyebrow: 'Available',
    title: 'Patient booking',
    body: 'Patients choose a service, a date, and an open time, then confirm the visit.',
  },
  {
    eyebrow: 'Available',
    title: 'Staff day list',
    body: 'Clinicians can review a schedule and update services and working hours.',
  },
  {
    eyebrow: 'Available',
    title: 'Clinic assistant',
    body: 'The assistant helps schedule a visit. It uses open times from the clinic and waits for you to confirm.',
  },
] as const;

export function LandingPage() {
  useDocumentTitle('Home');

  return (
    <PageContainer className="py-8 sm:py-12 lg:py-16">
      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(18rem,0.85fr)] lg:gap-12">
        <section aria-labelledby="hero-heading" className="min-w-0">
          <Badge tone="success">Accounts are available</Badge>
          <h1
            id="hero-heading"
            className="mt-4 font-display text-4xl font-semibold tracking-tight text-balance text-ink sm:text-5xl lg:text-6xl"
          >
            A calmer front desk for clinic appointments.
          </h1>
          <p className="mt-5 max-w-2xl text-lg leading-8 text-pretty text-ink-soft">
            CareFlow AI keeps clinic booking on a normal form, and a scheduling assistant can help
            you ask for a time. A visit is saved only after you confirm it.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link to="/login" className={buttonClassName('primary')}>
              Sign in
            </Link>
            <Link to="/register" className={buttonClassName('secondary')}>
              Create account
            </Link>
          </div>
        </section>
        <ServiceStatus />
      </div>

      <section aria-labelledby="scope-heading" className="mt-14 min-w-0">
        <h2
          id="scope-heading"
          className="font-display text-3xl font-semibold tracking-tight text-ink"
        >
          What works today
        </h2>
        <ul className="mt-4 grid gap-3 text-base leading-7 text-ink-soft sm:grid-cols-3">
          <li className="min-w-0 rounded-md border border-line bg-white/70 px-4 py-3">
            Move between home, sign-in, and registration on a phone, tablet, or desktop.
          </li>
          <li className="min-w-0 rounded-md border border-line bg-white/70 px-4 py-3">
            See whether the API process and PostgreSQL connection are actually up.
          </li>
          <li className="min-w-0 rounded-md border border-line bg-white/70 px-4 py-3">
            Book a visit from open times, then review upcoming and past appointments.
          </li>
        </ul>
      </section>

      <section aria-labelledby="planned-heading" className="mt-14">
        <div className="max-w-2xl">
          <h2
            id="planned-heading"
            className="font-display text-3xl font-semibold tracking-tight text-ink"
          >
            Clinic tools
          </h2>
          <p className="mt-3 text-base leading-7 text-ink-soft">
            Booking, the staff desk, and the scheduling assistant are available after sign-in. The
            assistant does not give medical advice.
          </p>
        </div>
        <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {plannedAreas.map((area) => (
            <Card key={area.title} eyebrow={area.eyebrow} title={area.title}>
              {area.body}
            </Card>
          ))}
        </div>
      </section>
    </PageContainer>
  );
}
