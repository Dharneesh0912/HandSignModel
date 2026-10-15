// src/index.ts
import 'dotenv/config';
import { App } from '@microsoft/teams.apps';
import type { IMessageActivity } from '@microsoft/teams.api';

import { config } from './config';
import { TeamsIdentityService } from './services/TeamsIdentityService';
import { ManagerAgentClient } from './services/ManagerAgentClient';
import { DocumentUploadService } from './services/DocumentService';
import { StateManager } from './services/StateManager';
import { handleIncomingMessage } from './handlers/messageHandler';
import { registerTaskModuleHandlers } from './handlers/taskModuleHandler';
import { djangoProxyMiddleware } from './middleware/DjangoProxy';

process.env.PORT = process.env.PORT || '9986';

const identityService = new TeamsIdentityService();
const managerClient   = new ManagerAgentClient();
const documentService = new DocumentUploadService();
const stateManager    = new StateManager();

const teamsApp = new App({
  clientId:     config.teams.clientId,
  clientSecret: config.teams.clientSecret,
  tenantId:     config.teams.tenantId,
} as any);

const appAny = teamsApp as any;

/* ─────────────────────────────────────────────────────────────────────
   Normal message handler — always registered first.
   Handles: user text, greeting welcome card, file uploads,
   doc-flow, and the messageBack clicks from Adaptive Cards.
   ──────────────────────────────────────────────────────────────────── */
teamsApp.on('message', async ({ send, activity, api }) => {
  const act = activity as IMessageActivity;
  console.log(
    `[ManagerBot] ← Teams message from ${act.from?.name ?? 'unknown'}`,
  );
  try {
    await handleIncomingMessage(act, send, api, {
      identityService,
      managerClient,
      documentService,
      stateManager,
    });
  } catch (err) {
    console.error('[ManagerBot] Handler error:', err);
  }
});


/* ─────────────────────────────────────────────────────────────────────
   Card-action ACK handlers.

   ★ FIX ★ — Return an explicit InvokeResponse so Teams does NOT show
   the red "Something went wrong. Please try again." toast.
   Welcome tiles use `Action.Submit` with `msteams.type = "messageBack"`,
   so the real query flows through the normal message handler above.
   These handlers only need to ACK the invoke.
   ──────────────────────────────────────────────────────────────────── */
/* ─────────────────────────────────────────────────────────────────────
   Card-action handlers.

   ★ REAL FIX ★ — Teams SDK v2.1.0 fires `card.action` for every
   `Action.Submit`. If the handler does not return an
   `AdaptiveCardActionResponse` with the correct shape, Teams shows
   "Something went wrong. Please try again."

   The correct shape for a silent ACK is a card with an empty body.
   Returning `undefined` or `{ body: {} }` does NOT work — the SDK
   rejects both.
   ──────────────────────────────────────────────────────────────────── */
/* ─────────────────────────────────────────────────────────────────────
   Silent ACK for every Adaptive Card action.

   Teams sends an `adaptiveCard/action` invoke for every Action.Submit
   click and waits ~2s for a well-formed InvokeResponse. If the shape
   is wrong (or the handler is missing), Teams shows
   "Unable to reach the app" / "Response sent to app".

   The `messageBack` buttons already deliver the real query through the
   normal message handler, so this ACK only needs to stop the toast.
   ──────────────────────────────────────────────────────────────────── */
function emptyCardAck(): any {
  return {
    status: 200,
    body: {
      statusCode: 200,
      type: 'application/vnd.microsoft.card.adaptive',
      value: {
        $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
        type: 'AdaptiveCard',
        version: '1.5',
        body: [],
      },
    },
  };
}

// Register every known spelling the SDK might emit.
teamsApp.on('card.action' as any,              async () => emptyCardAck());
teamsApp.on('card.action.askPrompt' as any,    async () => emptyCardAck());
teamsApp.on('adaptiveCard/action' as any,      async () => emptyCardAck());
teamsApp.on('message.submit' as any,           async () => emptyCardAck());
/* ─────────────────────────────────────────────────────────────────────
   Task Module handlers — wide tables ("Open full table" button).
   ──────────────────────────────────────────────────────────────────── */
registerTaskModuleHandlers(teamsApp);
/* ─────────────────────────────────────────────────────────────────────
   Raw safety net: short-circuit any Adaptive Card invoke with a 200
   before the Teams SDK tries (and possibly fails) to handle it.
   ──────────────────────────────────────────────────────────────────── */
function installCardActionSafetyNet(): void {
  const candidates: any[] = [];
  if (typeof appAny.express === 'function') {
    try { candidates.push(appAny.express()); } catch {}
  }
  const adapter: any = appAny.server?._adapter;
  if (adapter && typeof adapter.use === 'function') candidates.push(adapter);
  if (typeof appAny.use === 'function') candidates.push(appAny);
  if (appAny.server && typeof appAny.server.use === 'function') {
    candidates.push(appAny.server);
  }

  for (const target of candidates) {
    if (!target || typeof target.use !== 'function') continue;
    try {
      target.use((req: any, res: any, next: any) => {
        const isInvoke =
          req?.body?.type === 'invoke' &&
          typeof req?.body?.name === 'string' &&
          (req.body.name === 'adaptiveCard/action' ||
           req.body.name.startsWith('card.action') ||
           req.body.name === 'message/submitAction');

        if (!isInvoke) return next();

        console.log(`[CardAck] short-circuiting invoke: ${req.body.name}`);
        res.status(200).json({
          statusCode: 200,
          type: 'application/vnd.microsoft.card.adaptive',
          value: {
            $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
            type: 'AdaptiveCard',
            version: '1.5',
            body: [],
          },
        });
      });
      console.log('[ManagerBot] ✅ card-action safety net installed');
      return;
    } catch (err: any) {
      console.warn('[ManagerBot] safety net install failed:', err?.message);
    }
  }
  console.warn('[ManagerBot] ⚠️ could not install card-action safety net');
}
/* ─────────────────────────────────────────────────────────────────────
   Install the Django reverse proxy via multiple fallbacks.
   ──────────────────────────────────────────────────────────────────── */
function tryInstallProxy(): boolean {
  if (typeof appAny.express === 'function') {
    try {
      const expressApp = appAny.express();
      if (expressApp && typeof expressApp.use === 'function') {
        expressApp.use(djangoProxyMiddleware);
        console.log(
          '[ManagerBot] ✅ Django proxy installed via app.express().use()',
        );
        return true;
      }
    } catch (err: any) {
      console.warn('[ManagerBot] app.express().use() failed:', err?.message);
    }
  }

  const adapter: any = appAny.server?._adapter;
  if (adapter && typeof adapter.use === 'function') {
    try {
      adapter.use(djangoProxyMiddleware);
      console.log(
        '[ManagerBot] ✅ Django proxy installed via app.server._adapter.use()',
      );
      return true;
    } catch (err: any) {
      console.warn(
        '[ManagerBot] app.server._adapter.use() failed:',
        err?.message,
      );
    }
  }

  if (typeof appAny.use === 'function') {
    try {
      appAny.use(djangoProxyMiddleware);
      console.log('[ManagerBot] ✅ Django proxy installed via app.use()');
      return true;
    } catch (err: any) {
      console.warn('[ManagerBot] app.use() failed:', err?.message);
    }
  }

  try {
    const candidates = [
      appAny.server,
      appAny.server?.express,
      appAny.server?.app,
      appAny._server,
      appAny._app,
    ];
    for (const c of candidates) {
      if (c && typeof c.use === 'function') {
        c.use(djangoProxyMiddleware);
        console.log(
          '[ManagerBot] ✅ Django proxy installed via internal candidate',
        );
        return true;
      }
    }
  } catch (err: any) {
    console.warn('[ManagerBot] internal candidate scan failed:', err?.message);
  }

  return false;
}

/* ─────────────────────────────────────────────────────────────────────
   Boot
   ──────────────────────────────────────────────────────────────────── */
(async () => {
  console.log('[ManagerBot] Starting Manager Agent Teams Bot');
  console.log(`[ManagerBot] Django base: ${process.env.EMPLOYEE_DJANGO_URL}`);
  console.log(`[ManagerBot] Public base: ${process.env.PUBLIC_BASE_URL}`);
  console.log(`[ManagerBot] Target port: ${process.env.PORT}`);

  const missing: string[] = [];
  if (!process.env.EMPLOYEE_DJANGO_URL) missing.push('EMPLOYEE_DJANGO_URL');
  if (!process.env.EMPLOYEE_CHAT_URL)   missing.push('EMPLOYEE_CHAT_URL');
  if (!process.env.EMPLOYEE_TEAMS_SECRET) missing.push('EMPLOYEE_TEAMS_SECRET');
  if (missing.length) {
    console.error(
      `[ManagerBot] ❌ Missing required env vars: ${missing.join(', ')}. ` +
        `Check D:\\manager-teams-bot\\.env`,
    );
    process.exit(1);
  }

  const healthy = await managerClient.healthCheck().catch(() => false);
  console.log(healthy ? '✅ Django reachable' : '⚠️ Django not reachable');

  const proxyInstalled = tryInstallProxy();
  if (!proxyInstalled) {
    console.error(
      '[ManagerBot] ❌ CRITICAL: Django reverse proxy was NOT installed. ' +
        'All /manager/* URLs through ngrok will return 404.',
    );
  }
  installCardActionSafetyNet();   // ← ADD THIS LINE
  console.log('[ManagerBot] Calling teamsApp.start()...');
  try {
    await teamsApp.start(Number(process.env.PORT));
    console.log('[ManagerBot] ✅ Teams SDK started');
  } catch (err: any) {
    console.error('[ManagerBot] ❌ teamsApp.start() failed:', err?.message);
    if (err?.stack) console.error(err.stack);
    process.exit(1);
  }

  console.log(`\n[ManagerBot] Ready.`);
  console.log(`[ManagerBot]   /api/messages       → Teams SDK`);
  console.log(
    `[ManagerBot]   /manager/*          → Django (${process.env.EMPLOYEE_DJANGO_URL})`,
  );
  console.log(`[ManagerBot]   Public base URL     → ${process.env.PUBLIC_BASE_URL}`);
})();