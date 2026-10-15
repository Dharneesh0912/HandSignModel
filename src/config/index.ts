// src/config/index.ts

function optionalEnv(key: string, fallback: string): string {
  const raw = process.env[key];
  if (raw === undefined || raw === null || raw === '') return fallback;
  return raw;
}

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`[config] Missing required env var: ${key}`);
  return value;
}

function numberEnv(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

// ── Warn at load time if any Django URL was not set in .env ──────────
const _djangoUrlKeys = [
  'EMPLOYEE_DJANGO_URL',
  'EMPLOYEE_CHAT_URL',
  'EMPLOYEE_DOCUMENT_UPLOAD_URL',
  'EMPLOYEE_DOCUMENT_VALIDATE_URL',
  'EMPLOYEE_RESOLVE_USER_URL',
  'EMPLOYEE_HEALTH_URL',
] as const;

const _missingDjangoUrls = _djangoUrlKeys.filter((k) => !process.env[k]);
if (_missingDjangoUrls.length) {
  console.warn(
    `[config] ⚠️ These Django URL env vars are not set — falling back to defaults:\n` +
    `         ${_missingDjangoUrls.join(', ')}\n` +
    `         Check D:\\manager-teams-bot\\.env`,
  );
}

export const config = {
  port: numberEnv('PORT', 9986),
  publicBaseUrl: optionalEnv(
    'PUBLIC_BASE_URL',
    'https://g1genai.com',
  ),

  teams: {
    clientId:            optionalEnv('CLIENT_ID', ''),
    clientSecret:        optionalEnv('CLIENT_SECRET', ''),
    tenantId:            optionalEnv('TENANT_ID', ''),
    appId:               optionalEnv('TEAMS_APP_ID', ''),
    oauthConnectionName: optionalEnv('OAUTH_CONNECTION_NAME', ''),
    sharedSecret:        requireEnv('EMPLOYEE_TEAMS_SECRET'),
  },

  django: {
    baseUrl:             optionalEnv('EMPLOYEE_DJANGO_URL', 'http://localhost:8000'),
    chatUrl:             optionalEnv('EMPLOYEE_CHAT_URL', 'http://localhost:8000/manager/api/teams/chat/'),
    documentUploadUrl:   optionalEnv('EMPLOYEE_DOCUMENT_UPLOAD_URL', 'http://localhost:8000/manager/api/teams/documents/upload/'),
    validateEmployeeUrl: optionalEnv('EMPLOYEE_DOCUMENT_VALIDATE_URL', 'http://localhost:8000/manager/api/teams/documents/validate-employee/'),
    resolveUserUrl:      optionalEnv('EMPLOYEE_RESOLVE_USER_URL', 'http://localhost:8000/manager/api/teams/resolve-user/'),
    healthUrl:           optionalEnv('EMPLOYEE_HEALTH_URL', 'http://localhost:8000/manager/api/teams/health/'),
  },

  timeouts: {
    request:     numberEnv('REQUEST_TIMEOUT_MS', 30_000),
    upload:      numberEnv('UPLOAD_TIMEOUT_MS', 120_000),
    // ★ Raised from 15s to 60s. The validate endpoint sometimes needs
    //   a DataFabric Compass round-trip (~6s cold) on top of the DB
    //   call, and the first request after a restart is the slowest.
    validate:    numberEnv('VALIDATE_TIMEOUT_MS', 60_000),
    healthcheck: numberEnv('HEALTHCHECK_TIMEOUT_MS', 5_000),
  },

  retry: {
    maxAttempts: numberEnv('RETRY_MAX_ATTEMPTS', 3),
    baseDelayMs: numberEnv('RETRY_BASE_DELAY_MS', 500),
  },
} as const;