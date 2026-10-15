// src/handlers/normalQueryHandler.ts
import type { ActivityLike, IMessageActivity } from '@microsoft/teams.api';
import type { TeamsIdentityService } from '../services/TeamsIdentityService';
import type { ManagerAgentClient } from '../services/ManagerAgentClient';
import type { StateManager } from '../services/StateManager';
import { isAuthRequired, isSuccess } from '../types';
import { setPendingQuery } from '../services/PendingQueryStore';

export type SendFn = (activity: ActivityLike) => Promise<unknown>;

interface TeamsApi {
  conversations: {
    getMemberById(convId: string, userId: string): Promise<unknown>;
    updateActivity(
      conversationId: string,
      activityId: string,
      params: ActivityLike,
    ): Promise<unknown>;
  };
}

const POLL_INTERVAL_MS  = 3000;
const POLL_MAX_ATTEMPTS = 40;

const PROGRESS_THINKING   = '💭 Thinking…';
const PROGRESS_ANALYSING  = '🔍 Analysing…';
const PROGRESS_PROCESSING = '⚙️ Processing…';

const MILESTONE_ANALYSING_MS  = 4000;
const MILESTONE_PROCESSING_MS = 9000;


export async function handleNormalQuery(
  userText: string,
  conversationId: string,
  send: SendFn,
  activity: IMessageActivity,
  api: TeamsApi,
  identityService: TeamsIdentityService,
  managerClient: ManagerAgentClient,
  stateManager?: StateManager,
): Promise<void> {
  const teamsId = activity.from?.id;
  if (!teamsId) {
    await send({
      type: 'message',
      textFormat: 'markdown',
      text: '❌ I could not identify your Teams account. Please try again.',
    });
    return;
  }

  let progressId: string | undefined;
  const milestoneTimers: NodeJS.Timeout[] = [];

  const clearMilestones = () => {
    while (milestoneTimers.length) {
      const t = milestoneTimers.shift();
      if (t) clearTimeout(t);
    }
  };

  const editProgress = async (text: string): Promise<void> => {
    if (!progressId) return;
    try {
      await api.conversations.updateActivity(conversationId, progressId, {
        type: 'message', textFormat: 'markdown', text,
      });
    } catch (err) {
      console.warn('[ManagerBot] progress edit failed:', err);
    }
  };

  const editProgressToCard = async (card: unknown): Promise<void> => {
    const attachment = {
      contentType: 'application/vnd.microsoft.card.adaptive',
      content: card,
    };
    if (!progressId) {
      await send({ type: 'message', attachments: [attachment] });
      return;
    }
    try {
      await api.conversations.updateActivity(conversationId, progressId, {
        type: 'message', attachments: [attachment],
      });
    } catch (err) {
      console.warn('[ManagerBot] card edit failed, sending new activity:', err);
      await send({ type: 'message', attachments: [attachment] });
    }
  };

  const editProgressToText = async (text: string): Promise<void> => {
    if (!progressId) {
      await send({ type: 'message', textFormat: 'markdown', text });
      return;
    }
    try {
      await api.conversations.updateActivity(conversationId, progressId, {
        type: 'message', textFormat: 'markdown', text,
      });
    } catch (err) {
      console.warn('[ManagerBot] text edit failed, sending new activity:', err);
      await send({ type: 'message', textFormat: 'markdown', text });
    }
  };

  const scheduleMilestones = () => {
    milestoneTimers.push(
      setTimeout(() => { void editProgress(PROGRESS_ANALYSING); },  MILESTONE_ANALYSING_MS),
    );
    milestoneTimers.push(
      setTimeout(() => { void editProgress(PROGRESS_PROCESSING); }, MILESTONE_PROCESSING_MS),
    );
  };

  try {
    try {
      const resource: any = await send({
        type: 'message', textFormat: 'markdown', text: PROGRESS_THINKING,
      });
      progressId =
        resource?.id ??
        resource?.activity?.id ??
        resource?.activityId ??
        undefined;
    } catch (err) {
      console.warn('[ManagerBot] could not send initial progress activity:', err);
      progressId = undefined;
    }

    scheduleMilestones();

    const identity = await identityService.getIdentity(activity, api, conversationId);
    const response = (await managerClient.chat(
      identity,
      userText,
      conversationId,
    )) as any;

    /* ── Sign-in required: remember the query so we can resume it ── */
    if (isAuthRequired(response)) {
      clearMilestones();

      const aad = identity.aad_object_id ?? '';
      if (aad && userText) {
        setPendingQuery(conversationId, aad, userText);
      }

      // ★ Mark that a pending query exists, so the handler knows
      // to replay it exactly once after sign-in, not on every message.
      if (stateManager) {
        await stateManager.updateState(conversationId, {
          inforSignedIn: false,
          pendingQueryStored: true,
        });
      }

      await editProgressToText(
        [
          '🔐 **One-time Infor Sign-in Required**\n',
          'To use the Manager Assistant in Teams, please sign in once.',
          `👉 **[Click here to sign in](${response.signin_url})**`,
          '',
          `_I'll automatically resume your request — **"${userText}"** — as soon as you sign in._`,
        ].join('\n'),
      );
      return;
    }

    /* ── Success: mark signed-in for this conversation ───────────── */
    if (isSuccess(response)) {
      if (stateManager) {
        await stateManager.updateState(conversationId, {
          inforSignedIn: true,
        });
      }
    }

    if (response && response.pending === true && response.request_id) {
      const final = await _pollUntilReady(managerClient, response.request_id);
      clearMilestones();

      if (!final) {
        await editProgressToText(
          'Sorry, the request is taking longer than expected. Please try again.',
        );
        return;
      }

      // ★ NEW ★ — Django may return {ok: false, error: ...} mid-poll.
      // Surface the real error instead of a generic message.
      if ((final as any).ok === false) {
        const errMsg =
          (final as any).error ??
          (final as any).message ??
          'The request could not be completed.';
        await editProgressToText(`❌ ${errMsg}`);
        return;
      }

      if (final.card) {
        await editProgressToCard(final.card);
        return;
      }
      await editProgressToText(final.response_text || "I couldn't process that response.");
      return;
    }

    if (isSuccess(response) && response.card) {
      clearMilestones();
      await editProgressToCard(response.card);
      return;
    }

    if (isSuccess(response)) {
      clearMilestones();
      await editProgressToText(response.response_text || "I couldn't process that response.");
      return;
    }

    clearMilestones();
    await editProgressToText("I couldn't process that response. Please try again.");
  } catch (err) {
    console.error('[ManagerBot] handleNormalQuery error:', err);
    clearMilestones();
    const message =
      err instanceof Error && /HTTP 403/.test(err.message)
        ? "You don't have permission to access that information."
        : "Sorry, I'm having trouble reaching the Manager system right now. Please try again in a moment.";
    await editProgressToText(message);
  } finally {
    clearMilestones();
  }
}


async function _pollUntilReady(
  client: ManagerAgentClient,
  requestId: string,
): Promise<any | null> {
  for (let i = 0; i < POLL_MAX_ATTEMPTS; i++) {
    await _sleep(POLL_INTERVAL_MS);
    try {
      const status = (await client.pollStatus(requestId)) as any;
      if (status && status.pending === true) continue;
      return status;
    } catch (err) {
      console.warn('[ManagerBot] poll error:', err);
    }
  }
  return null;
}

function _sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}