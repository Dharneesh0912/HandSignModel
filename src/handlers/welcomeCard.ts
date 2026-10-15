// src/handlers/welcomeCard.ts
//
// Welcome card + "not in upload mode" card — theme-adaptive.
//
// Welcome-tile buttons use `Action.Submit` with
// `msteams.type = "messageBack"` ONLY. There is intentionally NO
// `verb` in the data — that prevents Teams from sending an
// `adaptiveCard/action` invoke, which was causing the
// "Something went wrong. Please try again." toast.

export const WELCOME_TRIGGERS =
  /^(hi+|hello+|hey+|yo|start|menu|help|good\s+(morning|afternoon|evening)|what can you (do|help)(\s+me)?|hi there|hey there)[\s!?.]*$/i;

interface WelcomeAction {
  title: string;
  subtitle: string;
  prompt: string;
}

const ACTIONS: WelcomeAction[] = [
  {
    title: 'Leave Balance',
    subtitle: 'Time-off & accruals',
    prompt: 'What is my leave balance?',
  },
  {
    title: 'My Profile',
    subtitle: 'Your employee details',
    prompt: 'Show my employee details',
  },
  {
    title: 'My Team',
    subtitle: 'Your direct reports',
    prompt: 'Show me my direct reports',
  },
  {
    title: 'AI Help',
    subtitle: 'See what I can do',
    prompt: 'What can you help me with?',
  },
];

/* ══════════════════════════════════════════════════════════════════
   Welcome card
   ══════════════════════════════════════════════════════════════════ */
export function buildWelcomeCard(
  userName?: string,
  imageUrl?: string,
): Record<string, unknown> {
  const greeting = userName ? `Welcome, ${userName}!` : 'Welcome!';

  return {
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    type: 'AdaptiveCard',
    version: '1.5',
    msteams: { width: 'Full' },
    body: [
      {
        type: 'Container',
        style: 'emphasis',
        roundedCorners: true,
        bleed: true,
        spacing: 'None',
        items: [
          {
            type: 'TextBlock',
            text: greeting,
            weight: 'Bolder',
            size: 'Large',
            wrap: true,
            spacing: 'None',
          },
          {
            type: 'TextBlock',
            text: 'How can I assist you with your team today?',
            size: 'Small',
            isSubtle: true,
            wrap: true,
            spacing: 'None',
          },
        ],
      },

      ...(imageUrl
        ? [
            {
              type: 'Image',
              url: imageUrl,
              size: 'Large',
              horizontalAlignment: 'Center',
              altText: 'Manager Assistant',
              spacing: 'Medium',
            },
          ]
        : []),

      {
        type: 'ColumnSet',
        spacing: 'Medium',
        columns: ACTIONS.map((action) => ({
          type: 'Column',
          width: 'stretch',
          verticalContentAlignment: 'Top',
          items: [tile(action)],
        })),
      },

      {
        type: 'Container',
        style: 'emphasis',
        roundedCorners: true,
        spacing: 'Medium',
        items: [
          {
            type: 'RichTextBlock',
            spacing: 'None',
            inlines: [
              { type: 'TextRun', text: 'Tip: ', weight: 'Bolder' },
              {
                type: 'TextRun',
                text: 'Click any tile, or simply type your question — e.g. ',
              },
              {
                type: 'TextRun',
                text: '"show leave balances for my team"',
                italic: true,
              },
              { type: 'TextRun', text: '.' },
            ],
          },
        ],
      },
    ],
  };
}

/* ══════════════════════════════════════════════════════════════════
   One tile.

   ★ CRITICAL ★ — the button data contains ONLY `msteams.messageBack`.
   No `verb`, no top-level `prompt`. Adding a `verb` causes Teams to
   send an `adaptiveCard/action` invoke, which the SDK handles by
   returning an error toast because the response shape isn't right.

   With `messageBack` only, the click is posted as a normal message
   (visible on the user's side) and routed through the message handler.
   ══════════════════════════════════════════════════════════════════ */
function tile(action: WelcomeAction): Record<string, unknown> {
  return {
    type: 'Container',
    style: 'emphasis',
    roundedCorners: true,
    spacing: 'None',
    minHeight: '170px',
    items: [
      {
        type: 'TextBlock',
        text: action.title,
        weight: 'Bolder',
        size: 'Medium',
        horizontalAlignment: 'Center',
        wrap: false,
        spacing: 'Medium',
      },
      {
        type: 'TextBlock',
        text: action.subtitle,
        size: 'Small',
        isSubtle: true,
        horizontalAlignment: 'Center',
        wrap: false,
        spacing: 'None',
      },
      {
        type: 'ActionSet',
        spacing: 'Large',
        horizontalAlignment: 'Center',
        actions: [
          {
            type: 'Action.Submit',
            title: 'Send',
            style: 'positive',
            data: {
              msteams: {
                type: 'messageBack',
                text: action.prompt,
                displayText: action.prompt,
              },
            },
          },
        ],
      },
    ],
  };
}

/* ══════════════════════════════════════════════════════════════════
   "Not in document upload mode" card.
   ══════════════════════════════════════════════════════════════════ */
export function buildNotInUploadModeCard(): Record<string, unknown> {
  return {
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    type: 'AdaptiveCard',
    version: '1.5',
    msteams: { width: 'Full' },
    body: [
      {
        type: 'Container',
        style: 'emphasis',
        roundedCorners: true,
        spacing: 'None',
        items: [
          {
            type: 'TextBlock',
            text: '📎 File Received',
            weight: 'Bolder',
            size: 'Medium',
            wrap: true,
            spacing: 'None',
          },
          {
            type: 'TextBlock',
            text: "I'm not currently in document submission mode.",
            size: 'Small',
            isSubtle: true,
            wrap: true,
            spacing: 'None',
          },
        ],
      },
      {
        type: 'TextBlock',
        text:
          "To upload a document, please start the flow first. I'll guide you through:",
        wrap: true,
        spacing: 'Medium',
      },
      {
        type: 'Container',
        style: 'emphasis',
        roundedCorners: true,
        spacing: 'Small',
        items: [
          {
            type: 'TextBlock',
            text: '1.  Select the document type',
            size: 'Small',
            wrap: true,
            spacing: 'None',
          },
          {
            type: 'TextBlock',
            text: '2.  Enter the Employee ID',
            size: 'Small',
            wrap: true,
            spacing: 'None',
          },
          {
            type: 'TextBlock',
            text: '3.  Attach your file when prompted',
            size: 'Small',
            wrap: true,
            spacing: 'None',
          },
        ],
      },
    ],
    actions: [
      {
        type: 'Action.Submit',
        title: '📄 Start Document Upload',
        style: 'positive',
        data: {
          // ★ No `verb` here either — messageBack only.
          msteams: {
            type: 'messageBack',
            text: 'I want to submit a document',
            displayText: '📄 Start Document Upload',
          },
        },
      },
    ],
  };
}