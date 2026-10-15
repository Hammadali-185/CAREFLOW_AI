import type { AssistantTurn, Slot } from '@careflow/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { ErrorState } from '../../components/feedback/ErrorState';
import { LoadingSkeleton } from '../../components/feedback/LoadingSkeleton';
import { PageContainer } from '../../components/layout/PageContainer';
import { Button } from '../../components/ui/Button';
import { PageHeader } from '../../components/ui/PageHeader';
import { Select } from '../../components/ui/Select';
import { FormField } from '../../components/ui/FormField';
import { useAuth } from '../auth/auth-session';
import { useDocumentTitle } from '../../hooks/use-document-title';
import { useApiClient } from '../../hooks/use-api';
import { ApiError } from '../../lib/api-client';
import { AppointmentCard } from '../appointments/AppointmentCard';
import { AssistantNotice } from './AssistantNotice';
import { ChatMessage } from './ChatMessage';
import { ConfirmationCard } from './ConfirmationCard';
import { SlotChoiceCard } from './SlotChoiceCard';
import { SuggestedReplies } from './SuggestedReplies';
import { TypingIndicator } from './TypingIndicator';

export function AssistantPage() {
  const auth = useAuth();
  const api = useApiClient();
  const queryClient = useQueryClient();
  const clinics = (auth.user?.memberships ?? []).filter(
    (membership) => membership.role === 'patient',
  );
  const [clinicId, setClinicId] = useState(clinics[0]?.businessId ?? '');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [retryText, setRetryText] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  useDocumentTitle('Assistant');

  const clinic = useQuery({
    queryKey: ['clinic', clinicId],
    enabled: Boolean(clinicId),
    queryFn: ({ signal }) => api.clinic(clinicId, signal),
  });
  const sessions = useQuery({
    queryKey: ['assistant-sessions', clinicId],
    enabled: Boolean(clinicId),
    queryFn: ({ signal }) => api.listAssistantSessions(clinicId, signal),
  });
  const conversation = useQuery({
    queryKey: ['assistant-session', sessionId],
    enabled: Boolean(sessionId),
    refetchInterval: 4000,
    queryFn: ({ signal }) => api.getAssistantSession(sessionId ?? '', signal),
  });

  if (clinics.length === 0) {
    return (
      <PageContainer className="py-8 sm:py-12">
        <ErrorState
          title="The assistant is for patients"
          description="This account does not have a patient membership. You can still use the clinic desk if you work here."
        />
      </PageContainer>
    );
  }

  const turn = conversation.data;
  const timeZone = clinic.data?.clinic.timezone ?? 'UTC';
  const formHref = bookingHref(turn);

  async function start() {
    if (!auth.csrfToken) {
      setNotice('Sign in to continue.');
      return;
    }
    setPending(true);
    setNotice(null);
    try {
      const created = await api.createAssistantSession(clinicId, auth.csrfToken);
      setSessionId(created.session.id);
      await queryClient.cancelQueries({ queryKey: ['assistant-session', created.session.id] });
      queryClient.setQueryData(['assistant-session', created.session.id], created);
      await queryClient.invalidateQueries({ queryKey: ['assistant-sessions', clinicId] });
    } catch (error) {
      setNotice(error instanceof ApiError ? error.message : 'The conversation was not started.');
    } finally {
      setPending(false);
    }
  }

  async function send(text: string) {
    if (!sessionId || !auth.csrfToken) {
      setNotice('Start a conversation before sending a message.');
      return;
    }
    const outgoing = text.trim();
    if (!outgoing) {
      return;
    }
    setPending(true);
    setNotice(null);
    try {
      const next = await api.postAssistantMessage(sessionId, outgoing, auth.csrfToken);
      await queryClient.cancelQueries({ queryKey: ['assistant-session', sessionId] });
      queryClient.setQueryData(['assistant-session', sessionId], next);
      setDraft('');
      if (next.outcome === 'unavailable' || next.outcome === 'invalid_output') {
        setRetryText(outgoing);
        setNotice(next.messages.at(-1)?.body ?? 'The assistant could not answer.');
      } else {
        setRetryText(null);
      }
    } catch (error) {
      setDraft(outgoing);
      setNotice(error instanceof ApiError ? error.message : 'That message was not sent.');
    } finally {
      setPending(false);
    }
  }

  async function chooseSlot(slot: Slot) {
    if (!sessionId || !auth.csrfToken) {
      return;
    }
    setPending(true);
    setNotice(null);
    try {
      const next = await api.selectAssistantSlot(sessionId, slot, auth.csrfToken);
      await queryClient.cancelQueries({ queryKey: ['assistant-session', sessionId] });
      queryClient.setQueryData(['assistant-session', sessionId], next);
    } catch (error) {
      setNotice(error instanceof ApiError ? error.message : 'That time is not available.');
    } finally {
      setPending(false);
    }
  }

  async function confirm() {
    if (!sessionId || !auth.csrfToken) {
      return;
    }
    setPending(true);
    setNotice(null);
    try {
      const next = await api.confirmAssistant(sessionId, auth.csrfToken);
      await queryClient.cancelQueries({ queryKey: ['assistant-session', sessionId] });
      queryClient.setQueryData(['assistant-session', sessionId], next);
      await queryClient.invalidateQueries({ queryKey: ['appointments'] });
    } catch (error) {
      setNotice(error instanceof ApiError ? error.message : 'That visit was not saved.');
    } finally {
      setPending(false);
    }
  }

  const saved =
    turn?.appointment &&
    (turn.outcome === 'booked' ||
      turn.outcome === 'cancelled' ||
      turn.outcome === 'rescheduled' ||
      (turn.outcome === 'loaded' && turn.workflow.phase === 'completed'));
  const choosing =
    turn?.workflow.phase === 'awaiting_slot' || turn?.workflow.phase === 'awaiting_reschedule_slot';
  const reviewing =
    turn?.workflow.phase === 'awaiting_confirmation' ||
    turn?.workflow.phase === 'awaiting_reschedule_confirmation' ||
    turn?.workflow.phase === 'awaiting_cancel_confirmation';
  const lastAssistant = [...(turn?.messages ?? [])]
    .reverse()
    .find((message) => message.senderKind === 'assistant');

  return (
    <PageContainer className="py-8 sm:py-12">
      <PageHeader
        eyebrow="Scheduling"
        title="Clinic assistant"
        description="Ask about a visit. Open times come from the clinic, and nothing is booked until you confirm it."
      />
      <p className="mt-4 text-sm leading-6 text-ink-soft">
        This assistant schedules visits. It does not give medical advice.{' '}
        <Link to={formHref} className="font-semibold text-teal-deep underline">
          Use the booking form
        </Link>
      </p>
      {clinics.length > 1 ? (
        <div className="mt-6 max-w-md">
          <FormField id="assistant-clinic" label="Clinic">
            <Select
              id="assistant-clinic"
              value={clinicId}
              onChange={(event) => {
                setClinicId(event.target.value);
                setSessionId(null);
              }}
            >
              {clinics.map((membership) => (
                <option key={membership.businessId} value={membership.businessId}>
                  {membership.businessName}
                </option>
              ))}
            </Select>
          </FormField>
        </div>
      ) : null}
      <div className="mt-8 grid gap-8 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <section aria-labelledby="conversations-heading">
          <div className="flex items-center justify-between gap-3">
            <h2 id="conversations-heading" className="font-display text-xl font-semibold text-ink">
              Conversations
            </h2>
            <Button disabled={pending} onClick={() => void start()}>
              New
            </Button>
          </div>
          {sessions.isPending ? <LoadingSkeleton label="Loading conversations" /> : null}
          <ul className="mt-3 grid max-h-48 gap-2 overflow-y-auto lg:max-h-none">
            {(sessions.data?.sessions ?? []).map((session) => (
              <li key={session.id}>
                <button
                  type="button"
                  className="focus-ring w-full rounded-md border border-line bg-white px-3 py-2 text-left text-sm text-ink"
                  aria-current={session.id === sessionId ? 'true' : undefined}
                  onClick={() => setSessionId(session.id)}
                >
                  {session.preview ?? 'New conversation'}
                </button>
              </li>
            ))}
          </ul>
        </section>
        <section aria-labelledby="chat-heading" className="min-w-0">
          <h2 id="chat-heading" className="sr-only">
            Messages
          </h2>
          {!sessionId ? (
            <p className="text-base text-ink-soft">Start a conversation to ask about a visit.</p>
          ) : null}
          {conversation.isPending && sessionId ? (
            <LoadingSkeleton label="Loading messages" />
          ) : null}
          <div className="grid gap-4">
            {turn?.messages.map((message) => (
              <ChatMessage key={message.id} message={message} timeZone={timeZone} />
            ))}
            {pending ? <TypingIndicator /> : null}
            {choosing ? (
              <div className="flex flex-col items-start gap-2" aria-label="Open times">
                {turn?.workflow.offeredSlots.map((slot) => (
                  <SlotChoiceCard
                    key={`${slot.staffUserId}-${slot.startsAt}`}
                    slot={slot}
                    timeZone={timeZone}
                    disabled={pending}
                    onSelect={(selected) => void chooseSlot(selected)}
                  />
                ))}
              </div>
            ) : null}
            {reviewing && lastAssistant ? (
              <ConfirmationCard
                title={
                  turn?.workflow.phase === 'awaiting_cancel_confirmation'
                    ? 'Cancel this visit?'
                    : 'Review this visit'
                }
                detail={lastAssistant.body}
                action={
                  turn?.workflow.phase === 'awaiting_cancel_confirmation'
                    ? 'Confirm cancellation'
                    : 'Confirm visit'
                }
                pending={pending}
                onConfirm={() => void confirm()}
              />
            ) : null}
            {saved && turn?.appointment ? (
              <div>
                <h2 className="font-display text-2xl font-semibold text-ink">
                  {savedHeading(turn.outcome, turn.appointment.status)}
                </h2>
                <div className="mt-3">
                  <AppointmentCard appointment={turn.appointment} timeZone={timeZone} />
                </div>
              </div>
            ) : null}
            {notice ? (
              <AssistantNotice
                title="The assistant did not finish"
                message={notice}
                formHref={formHref}
                onRetry={
                  retryText || draft
                    ? () => {
                        void send(retryText || draft);
                      }
                    : undefined
                }
              />
            ) : null}
            {turn && turn.outcome !== 'unavailable' && turn.outcome !== 'invalid_output' ? (
              <SuggestedReplies
                suggestions={turn.suggestions}
                disabled={pending}
                onSelect={(suggestion) => void send(suggestion)}
              />
            ) : null}
          </div>
          {sessionId ? (
            <form
              className="sticky bottom-14 z-10 mt-6 grid gap-3 border-t border-line bg-paper/95 py-3 backdrop-blur-md lg:static lg:bottom-auto lg:border-0 lg:bg-transparent lg:py-0"
              onSubmit={(event) => {
                event.preventDefault();
                void send(draft);
              }}
            >
              <FormField id="assistant-message" label="Message">
                <textarea
                  id="assistant-message"
                  className="focus-ring min-h-24 w-full rounded-md border border-line bg-white px-3 py-2 text-base text-ink"
                  maxLength={2000}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                />
              </FormField>
              <div>
                <Button type="submit" disabled={pending || draft.trim().length === 0}>
                  {pending ? 'Sending…' : 'Send'}
                </Button>
              </div>
            </form>
          ) : null}
        </section>
      </div>
    </PageContainer>
  );
}

function bookingHref(turn: AssistantTurn | undefined) {
  const params = new URLSearchParams();
  if (turn?.manualBooking.serviceId) {
    params.set('serviceId', turn.manualBooking.serviceId);
  }
  if (turn?.manualBooking.date) {
    params.set('date', turn.manualBooking.date);
  }
  const query = params.toString();
  return query ? `/book?${query}` : '/book';
}

function savedHeading(outcome: AssistantTurn['outcome'], status: string) {
  if (outcome === 'cancelled' || status === 'cancelled') {
    return 'The visit is cancelled';
  }
  if (outcome === 'rescheduled') {
    return 'The visit was moved';
  }
  return 'Your visit is booked';
}
