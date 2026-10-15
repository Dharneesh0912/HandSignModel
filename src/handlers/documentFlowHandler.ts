// src/handlers/documentFlowHandler.ts
//
// Document submission flow for the Manager Teams bot.
//
// ★ FLOW ★
//   1. promptDocumentType()        → sends the 2×2 Adaptive Card
//   2. handleDocumentTypeSelection → sets step=ask_employee_id
//   3. handleEmployeeIdInput       → validates self-or-report
//   4. handleDocumentUpload        → uploads file via Django
//   5. handleCancellation          → clears state

import type { Attachment } from '@microsoft/teams.api';
import type { StateManager } from '../services/StateManager';
import type { DocumentUploadService } from '../services/DocumentService';
import type { ConversationState, TeamsUserIdentity } from '../types';

type SendFn = (activity: any) => Promise<unknown>;

/* ─────────────────────────────────────────────────────────────────────
   Document type catalogue.
   ───────────────────────────────────────────────────────────────────── */
export interface DocumentTypeMeta {
  key: string;
  label: string;
  maxFiles: number;
  icon: string;
}

export const DOCUMENT_TYPES: Record<string, DocumentTypeMeta> = {
  emp_id: {
    key: 'emp_id',
    label: 'Employee Identification',
    maxFiles: 1,
    icon: '🆔',
  },
  alt_id: {
    key: 'alt_id',
    label: 'Alternate Identification Number',
    maxFiles: 5,
    icon: '🔄',
  },
  documents: {
    key: 'documents',
    label: 'Employee Documents',
    maxFiles: 5,
    icon: '📄',
  },
  credentials: {
    key: 'credentials',
    label: 'Employee Credentials',
    maxFiles: 5,
    icon: '🎓',
  },
};

/* ─────────────────────────────────────────────────────────────────────
   Cancel-phrase detection
   ───────────────────────────────────────────────────────────────────── */
const CANCEL_PHRASES =
  /^(cancel|never\s*mind|stop|exit|abort|back|go\s*back|quit|end)[\s!?.]*$/i;

export function isCancelMessage(text: string): boolean {
  if (!text) return false;
  return CANCEL_PHRASES.test(text.trim());
}

/* ─────────────────────────────────────────────────────────────────────
   Build the 2×2 Adaptive Card
   ───────────────────────────────────────────────────────────────────── */
function _tile(
  icon: string,
  title: string,
  messageText: string,
  displayText: string,
): Record<string, unknown> {
  return {
    type: 'Column',
    width: 'stretch',
    items: [
      {
        type: 'Container',
        style: 'emphasis',
        roundedCorners: true,
        minHeight: '120px',
        spacing: 'None',
        items: [
          {
            type: 'TextBlock',
            text: `${icon}  ${title}`,
            weight: 'Bolder',
            size: 'Medium',
            wrap: true,
            horizontalAlignment: 'Center',
            spacing: 'Medium',
          },
          {
            type: 'TextBlock',
            text: '1 file only',
            size: 'Small',
            isSubtle: true,
            horizontalAlignment: 'Center',
            spacing: 'None',
          },
          {
            type: 'ActionSet',
            spacing: 'Medium',
            horizontalAlignment: 'Center',
            actions: [
              {
                type: 'Action.Submit',
                title: 'Choose',
                style: 'positive',
                data: {
                  msteams: {
                    type: 'messageBack',
                    text: messageText,
                    displayText,
                  },
                },
              },
            ],
          },
        ],
      },
    ],
  };
}

function buildDocTypeCard(): Record<string, unknown> {
  return {
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    type: 'AdaptiveCard',
    version: '1.5',
    msteams: { width: 'Full' },
    body: [
      {
        type: 'TextBlock',
        text: '📋 Document Submission',
        weight: 'Bolder',
        size: 'Large',
      },
      {
        type: 'TextBlock',
        text:
          'Which document type would you like to submit? ' +
          'Each type accepts ONE file only.',
        wrap: true,
        spacing: 'Small',
      },
      {
        type: 'ColumnSet',
        spacing: 'Medium',
        columns: [
          _tile('🆔', 'Employee Identification', '1', '🆔 Employee ID'),
          _tile('🔄', 'Alternate ID',            '2', '🔄 Alternate ID'),
        ],
      },
      {
        type: 'ColumnSet',
        spacing: 'Small',
        columns: [
          _tile('📄', 'Documents',   '3', '📄 Documents'),
          _tile('🎓', 'Credentials', '4', '🎓 Credentials'),
        ],
      },
    ],
  };
}

/* ─────────────────────────────────────────────────────────────────────
   Step 1 — Prompt for document type (2×2 card)
   ───────────────────────────────────────────────────────────────────── */
export async function promptDocumentType(
  state: ConversationState,
  send: SendFn,
  stateManager: StateManager,
): Promise<void> {
  state.step = 'document_type';
  state.documentType = undefined;
  state.employeeId = undefined;
  state.employeeName = undefined;
  await stateManager.updateState(state.conversationId, state);

  await send({
    type: 'message',
    attachments: [
      {
        contentType: 'application/vnd.microsoft.card.adaptive',
        content: buildDocTypeCard(),
      },
    ],
  });
}

/* ─────────────────────────────────────────────────────────────────────
   Step 2 — User picked a tile → ask for Employee ID (NOT for file)
   ───────────────────────────────────────────────────────────────────── */
export async function handleDocumentTypeSelection(
  state: ConversationState,
  text: string,
  send: SendFn,
  stateManager: StateManager,
): Promise<void> {
  const normalized = text.trim().toLowerCase();

  const numberMap: Record<string, string> = {
    '1': 'emp_id',
    '2': 'alt_id',
    '3': 'documents',
    '4': 'credentials',
  };

  const textMap: Array<[RegExp, string]> = [
    [/employee\s*id(entification)?|^emp_?id$/i, 'emp_id'],
    [/alternate|alt_?id|secondary/i, 'alt_id'],
    [/employee\s*document|^documents?$/i, 'documents'],
    [/credential|certification|certificate/i, 'credentials'],
  ];

  let key: string | undefined = numberMap[normalized];

  if (!key && DOCUMENT_TYPES[normalized]) {
    key = normalized;
  }

  if (!key) {
    for (const [pattern, candidate] of textMap) {
      if (pattern.test(text)) {
        key = candidate;
        break;
      }
    }
  }

  if (!key) {
    await send({
      type: 'message',
      textFormat: 'markdown',
      text: [
        "❓ I didn't recognise that document type.",
        '',
        'Please reply with **1**, **2**, **3**, or **4**, or type **cancel**.',
      ].join('\n'),
    });
    return;
  }

  const meta = DOCUMENT_TYPES[key];

  // ★ Set step to ask_employee_id — NOT awaiting_document. ★
  state.documentType = key;
  state.step = 'ask_employee_id';
  state.employeeId = undefined;
  state.employeeName = undefined;
  await stateManager.updateState(state.conversationId, state);

  await send({
    type: 'message',
    textFormat: 'markdown',
    text: [
      `✅ Selected **${meta.icon} ${meta.label}**.`,
      '',
      'Now please enter the **Employee ID** (numeric digits only).',
      'You can submit for **yourself** or any of your **direct reports**.',
      '',
      'Type **cancel** to stop.',
    ].join('\n'),
  });
}

/* ─────────────────────────────────────────────────────────────────────
   Step 3 — User typed an Employee ID → validate
   ───────────────────────────────────────────────────────────────────── */
export async function handleEmployeeIdInput(
  state: ConversationState,
  text: string,
  send: SendFn,
  stateManager: StateManager,
  documentService: DocumentUploadService,
  identity: TeamsUserIdentity,
): Promise<void> {
  const empId = text.replace(/\D/g, '');
  if (!empId) {
    await send({
      type: 'message',
      textFormat: 'markdown',
      text:
        '⚠️ The Employee ID must contain digits. ' +
        'Please try again, or type **cancel**.',
    });
    return;
  }

  await send({
    type: 'message',
    textFormat: 'markdown',
    text: `🔍 Validating employee **${empId}**…`,
  });

  try {
    const result = await documentService.validateEmployee(empId, identity);

    if (!result.found) {
      await send({
        type: 'message',
        textFormat: 'markdown',
        text: [
          `❌ Employee **${empId}** was not found in the system, ` +
            `or you don't have access to them.`,
          '',
          'You can only submit documents for **yourself** or your ' +
            '**direct reports**.',
          'Please check the ID and try again — or type **cancel**.',
        ].join('\n'),
      });
      return;
    }

    state.employeeId = empId;
    state.employeeName = result.employee_name ?? '';
    state.step = 'awaiting_document';
    await stateManager.updateState(state.conversationId, state);

    const scope = result.is_self
      ? '_(your own record)_'
      : '_(direct report)_';

    await send({
      type: 'message',
      textFormat: 'markdown',
      text: [
        `✅ Verified **${result.employee_name}** (ID: \`${empId}\`) ${scope}`,
        '',
        'Now please **attach the document** using the 📎 paperclip ' +
          'button in the message bar.',
        '',
        'Accepted types: **PDF, JPG, PNG** · max **20 MB**',
        '',
        'Type **cancel** to stop.',
      ].join('\n'),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Validation failed';
    await send({
      type: 'message',
      textFormat: 'markdown',
      text:
        `❌ Could not validate that employee: ${msg}\n\n` +
        'Type **cancel** to stop.',
    });
  }
}

/* ─────────────────────────────────────────────────────────────────────
   Step 4 — User attached a file → upload
   ───────────────────────────────────────────────────────────────────── */
export async function handleDocumentUpload(
  state: ConversationState,
  attachments: Attachment[],
  send: SendFn,
  documentService: DocumentUploadService,
  stateManager: StateManager,
  identity: TeamsUserIdentity,
): Promise<void> {
  if (!state.employeeId || !state.documentType) {
    await send({
      type: 'message',
      textFormat: 'markdown',
      text:
        '⚠️ Something went wrong with the flow. ' +
        'Please start over by typing **submit document**.',
    });
    await stateManager.clearState(state.conversationId);
    return;
  }

  const validAttachments: Attachment[] = [];
  for (const att of attachments) {
    const check = documentService.validateFile(att);
    if (!check.valid) {
      await send({
        type: 'message',
        textFormat: 'markdown',
        text: `❌ **${att.name ?? 'file'}**: ${check.error}`,
      });
      continue;
    }
    validAttachments.push(att);
  }

  if (validAttachments.length === 0) {
    await send({
      type: 'message',
      textFormat: 'markdown',
      text:
        '⚠️ No valid files to upload. Please attach a PDF, JPG, ' +
        'or PNG, or type **cancel**.',
    });
    return;
  }

  state.step = 'processing';
  await stateManager.updateState(state.conversationId, state);

  await send({
    type: 'message',
    textFormat: 'markdown',
    text:
      `⏳ Uploading **${validAttachments.length}** file(s) for ` +
      `**${state.employeeName || state.employeeId}**…`,
  });

  try {
    const result = await documentService.uploadDocuments(
      state,
      validAttachments,
      identity,
    );

    if (result.success) {
      state.step = 'completed';
      await stateManager.updateState(state.conversationId, state);

      await send({
        type: 'message',
        textFormat: 'markdown',
        text: [
          '✅ **Document submitted successfully.**',
          '',
          `**Request ID:** \`${result.request_id ?? '—'}\``,
          `**Status:** ${result.status ?? 'processing'}`,
          '',
          "You'll be notified when the processing completes. You can " +
            'also check the **Documents** tab in the web UI.',
          '',
          'What else can I help you with?',
        ].join('\n'),
      });

      await stateManager.clearState(state.conversationId);
    } else {
      state.step = 'awaiting_document';
      await stateManager.updateState(state.conversationId, state);

      await send({
        type: 'message',
        textFormat: 'markdown',
        text: [
          `❌ **Upload failed:** ${result.error ?? 'unknown error'}`,
          '',
          'Please try attaching the file again, or type **cancel**.',
        ].join('\n'),
      });
    }
  } catch (err) {
    state.step = 'awaiting_document';
    await stateManager.updateState(state.conversationId, state);

    const msg = err instanceof Error ? err.message : 'unknown error';
    await send({
      type: 'message',
      textFormat: 'markdown',
      text: [
        `❌ **Upload error:** ${msg}`,
        '',
        'Please try again, or type **cancel**.',
      ].join('\n'),
    });
  }
}

/* ─────────────────────────────────────────────────────────────────────
   Cancellation
   ───────────────────────────────────────────────────────────────────── */
export async function handleCancellation(
  conversationId: string,
  send: SendFn,
  stateManager: StateManager,
): Promise<void> {
  await stateManager.clearState(conversationId);
  await send({
    type: 'message',
    textFormat: 'markdown',
    text: [
      '👍 **No worries — the request has been cancelled.**',
      '',
      'Feel free to ask me anything, or pick a tile from the menu below.',
    ].join('\n'),
  });
}