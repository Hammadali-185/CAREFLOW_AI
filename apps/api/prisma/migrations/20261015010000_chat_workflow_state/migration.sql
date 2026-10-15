-- Server-owned scheduling phase for a chat. This is not a transcript and not a booking.
ALTER TABLE "chat_sessions" ADD COLUMN "workflow_state" JSONB NOT NULL DEFAULT '{}';

ALTER TABLE "chat_sessions" ADD CONSTRAINT "chat_sessions_workflow_object_chk" CHECK (jsonb_typeof("workflow_state") = 'object');
ALTER TABLE "chat_sessions" ADD CONSTRAINT "chat_sessions_workflow_secrets_chk" CHECK (NOT ("workflow_state" ?| ARRAY['password', 'password_hash', 'token', 'token_hash', 'prompt', 'completion']));
