import type { ConversationState } from '../types';

export class StateManager {
  private readonly states = new Map<string, ConversationState>();

  async getState(conversationId: string): Promise<ConversationState> {
    return (
      this.states.get(conversationId) ?? {
        step: 'initial',
        conversationId,
        welcomeShown: false,
        inforSignedIn: false,
      }
    );
  }

  async updateState(
    conversationId: string,
    updates: Partial<ConversationState>,
  ): Promise<void> {
    const current = await this.getState(conversationId);
    this.states.set(conversationId, { ...current, ...updates });
  }

  async clearState(conversationId: string): Promise<void> {
    // Preserve `welcomeShown` and `inforSignedIn` across clears — only the
    // document flow state is reset.
    const current = this.states.get(conversationId);
    this.states.set(conversationId, {
      step: 'initial',
      conversationId,
      welcomeShown: current?.welcomeShown ?? false,
      inforSignedIn: current?.inforSignedIn ?? false,
    });
  }
}