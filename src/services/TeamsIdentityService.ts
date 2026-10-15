import type { IMessageActivity } from '@microsoft/teams.api';
import type { TeamsUserIdentity } from '../types';
import { consumeToken } from './TeamsTokenStore';

interface TeamsApi {
  conversations: { getMemberById(convId: string, userId: string): Promise<unknown>; };
}

export class TeamsIdentityService {
  async getIdentity(
    activity: IMessageActivity,
    api: TeamsApi,
    conversationId: string,
  ): Promise<TeamsUserIdentity> {
    const teamsId = activity.from?.id ?? '';
    let email = '';
    let aadObjectId = (activity.from?.aadObjectId ?? '').trim();

    if (teamsId) {
      try {
        const member = (await api.conversations.getMemberById(conversationId, teamsId)) as {
          email?: string; userPrincipalName?: string; aadObjectId?: string;
        } | null;
        email = (member?.email ?? member?.userPrincipalName ?? '').toLowerCase().trim();
        aadObjectId = (member?.aadObjectId ?? aadObjectId ?? '').trim();
      } catch (err) {
        console.error('[MgrIdentity] getMemberById failed:', err);
      }
    }

    let azure_token: string | undefined;
    if (aadObjectId) {
      try { azure_token = await consumeToken(aadObjectId); } catch (_) {}
    }

    return {
      email,
      aad_object_id: aadObjectId,
      azure_token,
      teams_user_id: teamsId,
      conversation_id: conversationId,
    };
  }
}