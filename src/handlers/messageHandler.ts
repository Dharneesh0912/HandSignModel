// src/handlers/messageHandler.ts
//
// Central Teams message handler for the Manager Agent bot.

import type {
  ActivityLike,
  Attachment,
  IMessageActivity,
} from '@microsoft/teams.api';
import type { TeamsIdentityService } from '../services/TeamsIdentityService';
import type { ManagerAgentClient } from '../services/ManagerAgentClient';
import type { DocumentUploadService } from '../services/DocumentService';
import type { StateManager } from '../services/StateManager';
import { detectDocumentIntent } from '../utils/intentDetection';
import { handleNormalQuery } from './normalQueryHandler';
import {
  buildWelcomeCard,
  buildNotInUploadModeCard,
  WELCOME_TRIGGERS,
} from './welcomeCard';
import { takePendingQuery } from '../services/PendingQueryStore';
import {
  handleCancellation,
  handleDocumentTypeSelection,
  handleDocumentUpload,
  handleEmployeeIdInput,
  isCancelMessage,
  promptDocumentType,
} from './documentFlowHandler';

export type SendFn = (activity: ActivityLike) => Promise<unknown>;

const PENDING_QUERY_MAX_REPLAY_MS = 5 * 60 * 1000;

const CONTINUATION_PHRASES =
  /^(yes|y|yeah|yep|ok|okay|go ahead|continue|resume|proceed|please do|do it|sure)$/i;

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

export interface HandlerDeps {
  identityService: TeamsIdentityService;
  managerClient: ManagerAgentClient;
  documentService: DocumentUploadService;
  stateManager: StateManager;
}

/* ─────────────────────────────────────────────────────────────────────
   Attachment extraction.
   ──────────────────────────────────────────────────────────────────── */
export function extractAttachments(
  activity: IMessageActivity,
): Attachment[] {
  const raw = (activity.attachments ?? []) as Attachment[];
  const FILE_CONTENT_TYPES = new Set([
    'application/vnd.microsoft.teams.file.download.info',
    'application/pdf',
    'image/jpeg',
    'image/jpg',
    'image/png',
    'application/vnd.microsoft.card.thumbnail',
  ]);
  return raw.filter((a) => {
    const ct = (a.contentType ?? '').toLowerCase();
    if (FILE_CONTENT_TYPES.has(ct)) return true;
    const content: any = (a as any).content;
    if (content && typeof content.downloadUrl === 'string') return true;
    if (typeof (a as any).contentUrl === 'string' && (a as any).contentUrl) {
      return true;
    }
    return false;
  });
}

// ── Duplicate-activity guard ─────────────────────────────────────────
const _seenActivityIds = new Map<string, string[]>();
const SEEN_WINDOW = 20;

function isDuplicateActivity(
  conversationId: string,
  activityId: string,
): boolean {
  if (!activityId) return false;
  const seen = _seenActivityIds.get(conversationId) ?? [];
  if (seen.includes(activityId)) return true;
  seen.push(activityId);
  if (seen.length > SEEN_WINDOW) seen.shift();
  _seenActivityIds.set(conversationId, seen);
  return false;
}

async function sendWelcomeCard(
  conversationId: string,
  activity: IMessageActivity,
  api: TeamsApi,
  send: SendFn,
  deps: HandlerDeps,
): Promise<void> {
  let displayName: string | undefined;
  try {
    const identity = await deps.identityService.getIdentity(
      activity,
      api,
      conversationId,
    );
    displayName =
      (identity as any).display_name ||
      (identity as any).name ||
      (activity.from as any)?.name;
  } catch {
    displayName = (activity.from as any)?.name;
  }

  console.log('[ManagerBot] sending welcome card (greeting detected)');
  try {
    await send({
      type: 'message',
      attachments: [
        {
          contentType: 'application/vnd.microsoft.card.adaptive',
          content: buildWelcomeCard(displayName),
        },
      ],
    });
  } catch (err) {
    console.error('[ManagerBot] welcome card send failed:', err);
  }
}

export async function handleIncomingMessage(
  activity: IMessageActivity,
  send: SendFn,
  api: TeamsApi,
  deps: HandlerDeps,
): Promise<void> {
  const conversationId = activity.conversation?.id ?? 'default';

  const activityId = activity.id ?? '';
  if (isDuplicateActivity(conversationId, activityId)) {
    console.log(`[ManagerBot] duplicate activity ignored: ${activityId}`);
    return;
  }

  // ── Extract the effective user text ──────────────────────────────
  let rawText: string = activity.text ?? '';
  const maybeValue = (activity as any).value;
  if (!rawText && maybeValue && typeof maybeValue === 'object') {
    const v =
      maybeValue.__value__ ??
      maybeValue.value ??
      maybeValue.text ??
      '';
    if (typeof v === 'string' && v.trim()) {
      rawText = v;
    }
  }

  const userText = rawText
    .replace(/<[^>]+>/g, '')
    .replace(/\u00A0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const attachments = extractAttachments(activity);
  const state = await deps.stateManager.getState(conversationId);

  let effectiveText = userText;
  if (effectiveText.startsWith('__ask__:')) {
    effectiveText = effectiveText.slice('__ask__:'.length).trim();
  }

  console.log(
    '[ManagerBot][DEBUG] text=' +
      JSON.stringify(effectiveText) +
      ' attachments=' +
      attachments.length +
      ' step=' +
      state.step,
  );

  // ── Welcome-card gate ────────────────────────────────────────────
  const isGreeting =
    !!effectiveText && WELCOME_TRIGGERS.test(effectiveText);
  const shouldWelcome = !state.welcomeShown && isGreeting;

  console.log(
    `[ManagerBot] step='${state.step}' raw='${rawText.slice(0, 60)}' ` +
      `effective='${effectiveText}' welcomeShown=${!!state.welcomeShown} ` +
      `isGreeting=${isGreeting} shouldWelcome=${shouldWelcome} ` +
      `signedIn=${!!state.inforSignedIn} pendingStored=${!!state.pendingQueryStored}`,
  );

  // ── ★ HIGHEST PRIORITY ★ ────────────────────────────────────────
  // File-only activity while NOT in the doc flow → not-in-mode card.
  const inDocFlow =
    state.step === 'document_type' ||
    state.step === 'ask_employee_id' ||
    state.step === 'awaiting_document' ||
    state.step === 'processing';

  if (!effectiveText && attachments.length > 0 && !inDocFlow) {
    console.log(
      `[ManagerBot] file-only activity (${attachments.length} attachment[s]) while NOT in doc flow — sending not-in-mode card`,
    );
    await send({
      type: 'message',
      attachments: [
        {
          contentType: 'application/vnd.microsoft.card.adaptive',
          content: buildNotInUploadModeCard(),
        },
      ],
    });
    return;
  }

  // Welcome FIRST, then return.
  if (shouldWelcome) {
    state.welcomeShown = true;
    state.step = 'initial';
    await deps.stateManager.updateState(conversationId, state);
    await sendWelcomeCard(conversationId, activity, api, send, deps);
    return;
  }

  // ── 1. Global cancellation ───────────────────────────────────────
  if (
    effectiveText &&
    isCancelMessage(effectiveText) &&
    state.step !== 'initial' &&
    state.step !== 'completed'
  ) {
    await handleCancellation(conversationId, send, deps.stateManager);

    console.log('[ManagerBot] cancel done — re-showing welcome card');
    await sendWelcomeCard(conversationId, activity, api, send, deps);
    return;
  }

  // ── 2. State-machine dispatch (document flow) ────────────────────
  switch (state.step) {
    case 'document_type':
      await handleDocumentTypeSelection(
        state,
        effectiveText,
        send,
        deps.stateManager,
      );
      return;

    case 'ask_employee_id': {
      if (!effectiveText) {
        await send({
          type: 'message',
          textFormat: 'markdown',
          text: 'Please enter the **Employee ID** (numeric digits only), or type **cancel** to stop.',
        });
        return;
      }
      const identity = await deps.identityService.getIdentity(
        activity,
        api,
        conversationId,
      );
      await handleEmployeeIdInput(
        state,
        effectiveText,
        send,
        deps.stateManager,
        deps.documentService,
        identity,
      );
      return;
    }

    case 'awaiting_document': {
      if (attachments.length === 0) {
        await send({
          type: 'message',
          textFormat: 'markdown',
          text: [
            '📎 **Attachment needed** — please upload the document using the **paperclip button** in the message bar.',
            'Type **cancel** to stop.',
          ].join('\n'),
        });
        return;
      }
      const identity = await deps.identityService.getIdentity(
        activity,
        api,
        conversationId,
      );
      await handleDocumentUpload(
        state,
        attachments,
        send,
        deps.documentService,
        deps.stateManager,
        identity,
      );
      return;
    }

    case 'processing':
      await send({
        type: 'message',
        textFormat: 'markdown',
        text:
          "⏳ **Your document is still being processed.** You'll be notified once it's complete.",
      });
      return;

    case 'completed':
      await deps.stateManager.clearState(conversationId);
      break;
  }

  // ── 3. Auto-resume pending query after sign-in ───────────────────
  if (state.pendingQueryStored && state.inforSignedIn) {
    const identity = await deps.identityService.getIdentity(
      activity,
      api,
      conversationId,
    );
    const aad = identity.aad_object_id ?? '';

    await deps.stateManager.updateState(conversationId, {
      pendingQueryStored: false,
    });

    const isContinuation =
      !effectiveText || CONTINUATION_PHRASES.test(effectiveText.trim());

    if (isContinuation) {
      const pending = takePendingQuery(conversationId, aad);
      if (pending) {
        const ageMs = Date.now() - pending.createdAt;
        if (ageMs <= PENDING_QUERY_MAX_REPLAY_MS) {
          console.log(
            `[ManagerBot] resuming pending query (age=${Math.round(ageMs / 1000)}s): "${pending.query}"`,
          );
          await send({
            type: 'message',
            textFormat: 'markdown',
            text: `_Resuming your earlier request: **${pending.query}**_`,
          });
          await handleNormalQuery(
            pending.query,
            conversationId,
            send,
            activity,
            api,
            deps.identityService,
            deps.managerClient,
            deps.stateManager,
          );
          return;
        }
        console.log(
          `[ManagerBot] dropping stale pending query (age=${Math.round(ageMs / 1000)}s > ${PENDING_QUERY_MAX_REPLAY_MS / 1000}s)`,
        );
      }
    } else {
      takePendingQuery(conversationId, aad);
      console.log(
        `[ManagerBot] discarding pending query — user typed a fresh message: "${effectiveText}"`,
      );
    }
  }

  // ── 4. Intent detection on fresh message ─────────────────────────
  if (effectiveText) {
    const { isIntent, confidence } = detectDocumentIntent(effectiveText);

    if (isIntent && confidence >= 0.4) {
      await promptDocumentType(state, send, deps.stateManager);
      return;
    }

    // ── 5. Normal message → Django ───────────────────────────────
    await handleNormalQuery(
      effectiveText,
      conversationId,
      send,
      activity,
      api,
      deps.identityService,
      deps.managerClient,
      deps.stateManager,
    );
    return;
  }

  // ── 6. Attachment without text and not in flow (fallback) ────────
  if (attachments.length > 0) {
    console.log(
      '[ManagerBot] file received while NOT in upload mode — sending not-in-mode card (fallback)',
    );
    await send({
      type: 'message',
      attachments: [
        {
          contentType: 'application/vnd.microsoft.card.adaptive',
          content: buildNotInUploadModeCard(),
        },
      ],
    });
    return;
  }

  // ── 7. Bare activity with no text and no attachments ─────────────
  if (!state.welcomeShown) {
    state.welcomeShown = true;
    await deps.stateManager.updateState(conversationId, state);
  }
}