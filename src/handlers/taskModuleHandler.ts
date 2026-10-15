// src/handlers/taskModuleHandler.ts
//
// Task Module handlers for wide tables ("Open full table" button).
//
// ★ FIX ★ — removed the duplicate `card.action` registration. It is now
// handled once in index.ts. Double-registration in the Teams SDK 2.1.0
// causes one of the two to be silently dropped, and the survivor was
// sometimes returning `undefined` instead of an InvokeResponse, which
// makes Teams show "Something went wrong".

import type { App } from '@microsoft/teams.apps';
import { config } from '../config';

const TABLE_TASK_VERB = 'openTable';

interface TaskFetchValue {
  table_view_id?: string;
  verb?: string;
  data?: {
    table_view_id?: string;
    verb?: string;
  };
}

function extractTableViewId(ctx: any): string | undefined {
  const value: TaskFetchValue | undefined =
    ctx?.activity?.value ?? ctx?.activity?.value?.data;

  if (!value) return undefined;

  if (typeof value.table_view_id === 'string' && value.table_view_id) {
    return value.table_view_id;
  }

  const nested = (value as any).data;
  if (nested && typeof nested.table_view_id === 'string' && nested.table_view_id) {
    return nested.table_view_id;
  }

  return undefined;
}

function buildTableModuleUrl(tableId: string): string {
  const base = config.publicBaseUrl.replace(/\/+$/, '');
  const encoded = encodeURIComponent(tableId);
  return `${base}/manager/api/teams/table-view/?id=${encoded}`;
}

export function registerTaskModuleHandlers(teamsApp: App): void {
  const appAny = teamsApp as any;

  /* ═════════════════════════════════════════════════════════════════
     1. Task Module — "Open full table" button
     ═════════════════════════════════════════════════════════════════ */

  const taskFetchHandler = async (ctx: any) => {
    try {
      const tableId = extractTableViewId(ctx);

      if (!tableId) {
        console.warn('[TaskModule] openTable fired without a table_view_id');
        return {
          task: {
            type: 'message',
            value:
              'This table is no longer available. Please run the query again.',
          },
        };
      }

      const url = buildTableModuleUrl(tableId);

      console.log(
        `[TaskModule] openTable → table_view_id=${tableId} url=${url}`,
      );

      return {
        task: {
          type: 'continue',
          value: {
            title: 'Full Table',
            height: 'large',
            width: 'large',
            url,
          },
        },
      };
    } catch (err) {
      console.error('[TaskModule] openTable handler error:', err);
      return {
        task: {
          type: 'message',
          value: 'Could not open the table. Please try again.',
        },
      };
    }
  };

  try {
    appAny.on(`dialog.open.${TABLE_TASK_VERB}`, taskFetchHandler);
    console.log(
      `[ManagerBot] ✅ Task Module handler registered: dialog.open.${TABLE_TASK_VERB}`,
    );
  } catch (err: any) {
    console.error(
      `[ManagerBot] ❌ Could not register dialog.open.${TABLE_TASK_VERB}:`,
      err?.message,
    );
  }

  try {
    appAny.on(`dialog.submit.${TABLE_TASK_VERB}`, async (_ctx: any) => {
      console.log('[TaskModule] openTable submit (no-op)');
      return { task: { type: 'message', value: '' } };
    });
  } catch {
    /* older SDKs may not allow this — harmless */
  }

  /* ★ REMOVED ★ — the duplicate card.action / message.submit registrations.
     They are now handled ONCE in index.ts. */
}