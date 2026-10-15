import fetch from 'node-fetch';
import * as path from 'path';
import type { Attachment } from '@microsoft/teams.api';
import { config } from '../config';
import type {
  ConversationState,
  DocumentUploadResult,
  EmployeeValidationResult,
  TeamsUserIdentity,
} from '../types';

interface ValidateApiResponse {
  ok: boolean;
  found?: boolean;
  is_active?: boolean;
  employee_name?: string;
  employee_id?: string;
  employee?: { id: string; name: string; is_active: boolean };
  is_self?: boolean;
  error?: string;
}

interface DocumentApiResponse {
  success: boolean;
  request_id?: string;
  request_numbers?: string[];
  error?: string;
}

export class DocumentUploadService {
  private readonly secret = config.teams.sharedSecret;

  validateFile(attachment: Attachment): { valid: boolean; error?: string } {
    const MAX_BYTES = 20 * 1024 * 1024;
    const contentSize = (attachment as Attachment & { contentSize?: number }).contentSize;
    if (contentSize !== undefined && contentSize > MAX_BYTES) {
      return { valid: false, error: `File exceeds 20 MB limit` };
    }
    const allowedMimeTypes = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png'];
    const allowedExtensions = ['.pdf', '.jpg', '.jpeg', '.png'];
    const contentType = attachment.contentType ?? '';
    const ext = path.extname(attachment.name ?? '').toLowerCase();
    if (!allowedMimeTypes.includes(contentType) && !allowedExtensions.includes(ext)) {
      return { valid: false, error: `Unsupported type "${contentType || ext}"` };
    }
    return { valid: true };
  }

  async validateEmployee(
    employeeId: string,
    identity: TeamsUserIdentity,
  ): Promise<EmployeeValidationResult> {
    const res = await this._fetchWithTimeout(
      config.django.validateEmployeeUrl,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Teams-Secret': this.secret },
        body: JSON.stringify({
          employee_id: employeeId,
          aad_object_id: identity.aad_object_id,
          email: identity.email,
        }),
      },
      config.timeouts.validate,
    );

    if (res.status === 401) {
      return { found: false, is_active: false, employee_name: '' };
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Validate HTTP ${res.status}: ${body.slice(0, 200)}`);
    }
    const data = (await res.json()) as ValidateApiResponse;
    if (!data.ok) {
      if (data.error && data.error.toLowerCase().includes('own')) {
        throw new Error(data.error);
      }
      throw new Error(data.error ?? 'Validation failed');
    }
    return {
      found: data.found ?? false,
      is_active: data.is_active ?? false,
      employee_name: data.employee_name ?? data.employee?.name ?? '',
      employee: data.employee,
      is_self: data.is_self,
    };
  }

  async uploadDocuments(
    state: ConversationState,
    attachments: Attachment[],
    identity: TeamsUserIdentity,
  ): Promise<DocumentUploadResult> {
    const files: Array<{ name: string; size: number; content_type: string; data: string }> = [];
    for (const att of attachments) {
      let buf: Buffer;
      try { buf = await this._downloadFile(att); }
      catch (err) {
        return { success: false, error: `Download failed: ${err instanceof Error ? err.message : String(err)}` };
      }
      files.push({
        name: att.name ?? 'document',
        size: buf.length,
        content_type: this._getMimeType(att.name ?? ''),
        data: buf.toString('base64'),
      });
    }

    const body = {
      target_employee_id: state.employeeId,
      document_type: state.documentType,
      files,
      aad_object_id: identity.aad_object_id,
      email: identity.email,
    };

    let res: Awaited<ReturnType<typeof fetch>>;
    try {
      res = await this._fetchWithTimeout(
        config.django.documentUploadUrl,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Teams-Secret': this.secret },
          body: JSON.stringify(body),
        },
        config.timeouts.upload,
      );
    } catch (err) {
      return { success: false, error: `Network error: ${err instanceof Error ? err.message : String(err)}` };
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { success: false, error: `Upload failed (HTTP ${res.status}): ${text.slice(0, 200)}` };
    }
    const data = (await res.json()) as DocumentApiResponse;
    if (data.success) {
      return {
        success: true,
        request_id: data.request_numbers?.join(', ') ?? data.request_id,
        status: 'processing',
      };
    }
    return { success: false, error: data.error ?? 'Submission failed' };
  }

  private _getMimeType(filename: string): string {
    const ext = filename.split('.').pop()?.toLowerCase() ?? '';
    const map: Record<string, string> = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png' };
    return map[ext] ?? 'application/octet-stream';
  }

  private async _downloadFile(attachment: Attachment): Promise<Buffer> {
    const content = (attachment as Attachment & { content?: { downloadUrl?: string } }).content;
    const downloadUrl = content?.downloadUrl ?? attachment.contentUrl;
    if (!downloadUrl) throw new Error('no downloadUrl');
    const res = await this._fetchWithTimeout(downloadUrl, {}, 60_000);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  private async _fetchWithTimeout(url: string, options: Parameters<typeof fetch>[1], timeoutMs: number) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try { return await fetch(url, { ...options, signal: controller.signal }); }
    finally { clearTimeout(timer); }
  }
}