import fetch from 'node-fetch';
import { config } from '../config';
import type {
  TeamsUserIdentity,
  EmployeeChatRequest,
  EmployeeDjangoResponse,
} from '../types';
import { isAuthRequired } from '../types';
import { withRetry, isTransientHttpError } from '../utils/retry';

let __fetchImpl: typeof fetch = fetch;

export function __setFetchForTests(fn: typeof fetch): () => void {
  const prev = __fetchImpl;
  __fetchImpl = fn;
  return () => { __fetchImpl = prev; };
}

export class ManagerAgentClient {
  private readonly headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Teams-Secret': config.teams.sharedSecret,
  };

  async chat(
    identity: TeamsUserIdentity,
    message: string,
    conversationId: string,
  ): Promise<EmployeeDjangoResponse> {
    if (!identity.email && !identity.azure_token && !identity.aad_object_id) {
      throw new Error('[ManagerAgent] email/azure_token/aad_object_id required');
    }
    if (!message) throw new Error('[ManagerAgent] message required');
    if (!conversationId) throw new Error('[ManagerAgent] conversation_id required');

    const body: EmployeeChatRequest = {
      azure_token: identity.azure_token,
      email: identity.email,
      aad_object_id: identity.aad_object_id,
      message,
      conversation_id: conversationId,
    };

    return withRetry(() => this._postChat(body), {
      maxAttempts: config.retry.maxAttempts,
      baseDelayMs: config.retry.baseDelayMs,
      shouldRetry: isTransientHttpError,
    });
  }

  private async _postChat(body: EmployeeChatRequest): Promise<EmployeeDjangoResponse> {
    let res: Awaited<ReturnType<typeof fetch>>;
    try {
      res = await this._fetchWithTimeout(
        config.django.chatUrl,
        { method: 'POST', headers: this.headers, body: JSON.stringify(body) },
        config.timeouts.request,
      );
    } catch (err) {
      throw new Error(`[ManagerAgent] network error: ${err instanceof Error ? err.message : String(err)}`);
    }

    if (res.status === 401) {
      let payload: Record<string, unknown>;
      try { payload = (await res.json()) as Record<string, unknown>; }
      catch { throw new Error('[ManagerAgent] HTTP 401 — non-JSON'); }

      if (payload['error'] === 'infor_auth_required') {
        return {
          ok: false,
          error: 'infor_auth_required',
          message: (payload['message'] as string) || 'Please complete Infor sign-in.',
          signin_url: (payload['signin_url'] as string) || '',
          aad_object_id: (payload['aad_object_id'] as string) || body.aad_object_id,
          email: (payload['email'] as string) || body.email,
        } as EmployeeDjangoResponse;
      }
      throw new Error(`[ManagerAgent] HTTP 401: ${JSON.stringify(payload).slice(0, 200)}`);
    }

    if (res.status === 403) {
      const text = await res.text().catch(() => '');
      let errBody: Record<string, unknown> = {};
      try { errBody = JSON.parse(text); } catch {}
      throw new Error(`[ManagerAgent] HTTP 403: ${(errBody['error'] as string) || text.slice(0, 200)}`);
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`[ManagerAgent] HTTP ${res.status}: ${text.slice(0, 300)}`);
    }

    const rawBody = await res.text();
    let data: EmployeeDjangoResponse;
    try {
      data = JSON.parse(rawBody) as EmployeeDjangoResponse;
    } catch {
      // ★ NEW ★ — Surface the first 300 chars so you can see whether
      //   Django returned HTML (login redirect / proxy error page) or
      //   genuinely malformed JSON.
      const preview = rawBody.slice(0, 300).replace(/\s+/g, ' ');
      console.error(
        `[ManagerAgent] non-JSON response from ${config.django.chatUrl}\n` +
        `  HTTP ${res.status}\n` +
        `  Content-Type: ${res.headers.get('content-type')}\n` +
        `  Body preview: ${preview}`,
      );
      throw new Error(
        `[ManagerAgent] failed to parse JSON (HTTP ${res.status}). ` +
        `Is Django reachable at ${config.django.chatUrl}? ` +
        `First 120 chars: ${preview.slice(0, 120)}`,
      );
    }

    if ((data as any).ok === true && (data as any).pending === true && typeof (data as any).request_id === 'string') {
      return data;
    }

    if (!data.ok) {
      if (isAuthRequired(data)) return data;
      throw new Error(`[ManagerAgent] Django ok=false: ${JSON.stringify(data).slice(0, 300)}`);
    }
    return data;
  }

  async pollStatus(requestId: string) {
    if (!requestId) throw new Error('[ManagerAgent] requestId required');
    const base = config.django.chatUrl.replace(/\/chat\/?$/, '');
    const url = `${base}/chat/status/?request_id=${encodeURIComponent(requestId)}`;

    let res: Awaited<ReturnType<typeof fetch>>;
    try {
      res = await this._fetchWithTimeout(
        url,
        { method: 'GET', headers: { 'X-Teams-Secret': config.teams.sharedSecret, Accept: 'application/json' } },
        config.timeouts.request,
      );
    } catch (err) {
      throw new Error(`[ManagerAgent] poll network error: ${err instanceof Error ? err.message : String(err)}`);
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`[ManagerAgent] poll HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    let data: any;
    try { data = await res.json(); }
    catch { throw new Error('[ManagerAgent] poll failed to parse JSON'); }
    if (data && data.pending === true) {
      return { ok: true, pending: true, request_id: requestId };
    }
    return data as EmployeeDjangoResponse;
  }

  async healthCheck(): Promise<boolean> {
    try {
      const res = await this._fetchWithTimeout(
        config.django.healthUrl,
        { method: 'GET', headers: { 'X-Teams-Secret': config.teams.sharedSecret } },
        config.timeouts.healthcheck,
      );
      return res.ok;
    } catch { return false; }
  }

  private async _fetchWithTimeout(url: string, options: Parameters<typeof fetch>[1], timeoutMs: number) {
    const controller = new AbortController();
    const timerId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await __fetchImpl(url, { ...options, signal: controller.signal });
    } finally { clearTimeout(timerId); }
  }
}