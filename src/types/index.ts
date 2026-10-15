// src/types/index.ts
import type { Attachment } from '@microsoft/teams.api';

export interface TeamsUserIdentity {
  email: string;
  aad_object_id: string;
  azure_token?: string;
  teams_user_id?: string;
  conversation_id?: string;
}

export interface EmployeeChatRequest {
  azure_token?: string;
  email: string;
  aad_object_id: string;
  message: string;
  conversation_id: string;
}

export type AdaptiveCard = Record<string, unknown>;

export interface EmployeeChatSuccessResponse {
  ok: true;
  response_text: string;
  card?: AdaptiveCard;
  metadata?: Record<string, unknown>;
}

export interface EmployeeAuthRequiredResponse {
  ok: false;
  error: 'infor_auth_required';
  message: string;
  signin_url: string;
  aad_object_id: string;
  email: string;
}

export interface EmployeeErrorResponse {
  ok: false;
  error: string;
  message?: string;
}

export type EmployeeDjangoResponse =
  | EmployeeChatSuccessResponse
  | EmployeeAuthRequiredResponse
  | EmployeeErrorResponse;

export function isAuthRequired(r: EmployeeDjangoResponse): r is EmployeeAuthRequiredResponse {
  return !r.ok && (r as EmployeeAuthRequiredResponse).error === 'infor_auth_required';
}

export function isSuccess(r: EmployeeDjangoResponse): r is EmployeeChatSuccessResponse {
  return r.ok === true;
}

export type DocumentStep =
  | 'initial'
  | 'document_type'
  | 'ask_employee_id'
  | 'awaiting_document'
  | 'processing'
  | 'completed';

export interface PendingQuery {
  /** The original message the user wanted to ask */
  query: string;
  /** AAD object id that initiated the query (used to verify the same user returns) */
  aadObjectId: string;
  /** UNIX ms timestamp — used to expire stale pending queries */
  createdAt: number;
}

export interface ConversationState {
  step: DocumentStep;
  conversationId: string;
  documentType?: string;
  employeeId?: string;
  employeeName?: string;
  welcomeShown?: boolean;
  /** Set when the user has completed Infor sign-in once in this conversation */
  inforSignedIn?: boolean;
  /** Marker: a query was deferred because sign-in was required */
  pendingQueryStored?: boolean;
}

export interface DocumentTypeMeta {
  key: string;
  label: string;
  maxFiles: number;
  icon: string;
}

export interface EmployeeValidationResult {
  found: boolean;
  is_active: boolean;
  employee_name?: string;
  employee?: {
    id: string;
    name: string;
    is_active: boolean;
  };
  is_self?: boolean;
}

export interface DocumentUploadResult {
  success: boolean;
  request_id?: string;
  status?: string;
  error?: string;
}

// Re-export so welcomeCard keeps compiling
export type { Attachment };