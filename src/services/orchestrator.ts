import { dockerOrchestrator } from './docker-orchestrator';
import { feishuWebSocket } from './feishu-websocket';
import { tokenService } from './token';
import { UserSandboxState, DockerContainerInfo, IgniteOptions, FeishuWSMessage } from '../types';

/**
 * Core Orchestrator with State Machine
 *
 * Manages user sandbox states and coordinates Docker containers and Feishu WebSocket.
 * Implements a state machine pattern to track user sandbox lifecycle.
 */
export class SynapseOrchestrator {
  // In-memory state machine: userId -> UserSandboxState
  private stateMachine: Map<string, UserSandboxState> = new Map();
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    // Start periodic cleanup of inactive states
    this.startCleanupInterval();
  }

  /**
   * Get or create user state
   */
  getUserState(userId: string): UserSandboxState {
    let state = this.stateMachine.get(userId);

    if (!state) {
      state = {
        userId,
        userToken: this.generateUserToken(userId),
        containerInfo: null,
        awaitingConfirmation: false,
        lastActivity: new Date(),
      };
      this.stateMachine.set(userId, state);
      console.log(`[Orchestrator] Created new state for user ${userId}`);
    } else {
      // Update last activity
      state.lastActivity = new Date();
    }

    return state;
  }

  /**
   * Generate user-specific token using tokenService
   */
  private generateUserToken(userId: string): string {
    return tokenService.getOrCreateUserToken(userId);
  }

  /**
   * Handle incoming Feishu messages
   */
  async handleFeishuMessage(message: FeishuWSMessage): Promise<void> {
    const userId = message.event.sender.sender_id.user_id;
    const content = message.event.message.content;

    console.log(`[Orchestrator] Handling message from user ${userId}: ${content}`);

    // Get or create user state
    const state = this.getUserState(userId);

    // If user has no container and not awaiting confirmation, send ignition card
    if (!state.containerInfo && !state.awaitingConfirmation) {
      await this.sendIgnitionCard(userId);
      state.awaitingConfirmation = true;
      return;
    }

    // If user has a running container, forward message to it
    if (state.containerInfo && state.containerInfo.status === 'running') {
      await this.forwardToContainer(userId, content);
    } else if (state.awaitingConfirmation) {
      // User sent message while awaiting confirmation
      await feishuWebSocket.sendTextMessage(
        userId,
        'Please click the "Ignite Sandbox" button to start your sandbox.'
      );
    }
  }

  /**
   * Handle card button clicks (for ignition)
   */
  async handleCardInteraction(userId: string, action: string): Promise<void> {
    console.log(`[Orchestrator] Handling card interaction from user ${userId}: ${action}`);

    const state = this.getUserState(userId);

    if (action === 'ignite') {
      // Ignite sandbox
      state.awaitingConfirmation = false;
      await this.igniteSandbox(userId);
    } else if (action === 'cancel') {
      // Cancel ignition
      state.awaitingConfirmation = false;
      await feishuWebSocket.sendTextMessage(userId, 'Ignition cancelled.');
    }
  }

  /**
   * Ignite sandbox: Create Docker container for user
   */
  private async igniteSandbox(userId: string): Promise<void> {
    const state = this.getUserState(userId);

    console.log(`[Orchestrator] Igniting sandbox for user ${userId}`);

    try {
      const options: IgniteOptions = {
        userId,
        userToken: state.userToken,
      };

      const containerInfo = await dockerOrchestrator.igniteSandbox(options);
      state.containerInfo = containerInfo;
      state.lastActivity = new Date();

      await feishuWebSocket.sendTextMessage(
        userId,
        `Sandbox ignited successfully! Container ID: ${containerInfo.containerId.substring(0, 12)}`
      );

      console.log(`[Orchestrator] Sandbox ignited for user ${userId}: ${containerInfo.containerId}`);
    } catch (error) {
      console.error(`[Orchestrator] Failed to ignite sandbox for user ${userId}:`, error);
      await feishuWebSocket.sendTextMessage(
        userId,
        'Failed to ignite sandbox. Please try again later.'
      );
    }
  }

  /**
   * Forward messages to container (stub for now, Task 6 will complete)
   */
  private async forwardToContainer(userId: string, message: string): Promise<void> {
    const state = this.getUserState(userId);

    if (!state.containerInfo) {
      console.warn(`[Orchestrator] No container for user ${userId}`);
      return;
    }

    console.log(`[Orchestrator] Forwarding message to container ${state.containerInfo.containerId}`);
    console.log(`[Orchestrator] Message: ${message}`);

    // TODO: Implement in Task 6 - Forward to container via WebSocket proxy
    // For now, just log the message
    console.log(`[Orchestrator] Message forwarding will be implemented in Task 6`);
  }

  /**
   * Stop user's sandbox
   */
  async stopSandbox(userId: string): Promise<void> {
    const state = this.stateMachine.get(userId);

    if (!state || !state.containerInfo) {
      console.log(`[Orchestrator] No sandbox to stop for user ${userId}`);
      return;
    }

    console.log(`[Orchestrator] Stopping sandbox for user ${userId}`);

    try {
      await dockerOrchestrator.stopSandbox(userId);
      state.containerInfo = null;
      state.awaitingConfirmation = false;
      state.lastActivity = new Date();

      await feishuWebSocket.sendTextMessage(userId, 'Sandbox stopped successfully.');
      console.log(`[Orchestrator] Sandbox stopped for user ${userId}`);
    } catch (error) {
      console.error(`[Orchestrator] Failed to stop sandbox for user ${userId}:`, error);
      await feishuWebSocket.sendTextMessage(
        userId,
        'Failed to stop sandbox. Please try again later.'
      );
    }
  }

  /**
   * Get all user states
   */
  getActiveStates(): UserSandboxState[] {
    return Array.from(this.stateMachine.values());
  }

  /**
   * Clean up inactive states (> 1 hour inactive)
   */
  private cleanupInactiveStates(): void {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const statesToCleanup: string[] = [];

    for (const [userId, state] of this.stateMachine.entries()) {
      if (state.lastActivity < oneHourAgo) {
        statesToCleanup.push(userId);
      }
    }

    if (statesToCleanup.length > 0) {
      console.log(`[Orchestrator] Cleaning up ${statesToCleanup.length} inactive states`);

      for (const userId of statesToCleanup) {
        const state = this.stateMachine.get(userId);
        if (state?.containerInfo) {
          // Stop container if running
          dockerOrchestrator.stopSandbox(userId).catch((error) => {
            console.error(`[Orchestrator] Failed to stop container for user ${userId}:`, error);
          });
        }
        this.stateMachine.delete(userId);
        console.log(`[Orchestrator] Cleaned up state for user ${userId}`);
      }
    }
  }

  /**
   * Start periodic cleanup interval (every 5 minutes)
   */
  private startCleanupInterval(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanupInactiveStates();
    }, 5 * 60 * 1000); // 5 minutes

    console.log('[Orchestrator] Cleanup interval started (every 5 minutes)');
  }

  /**
   * Stop cleanup interval
   */
  stopCleanupInterval(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
      console.log('[Orchestrator] Cleanup interval stopped');
    }
  }

  /**
   * Send ignition card to user
   */
  private async sendIgnitionCard(userId: string): Promise<void> {
    const card = {
      config: {
        wide_screen_mode: true,
      },
      header: {
        title: {
          tag: 'plain_text' as const,
          content: 'Ignite Your Sandbox',
        },
        template: 'blue' as const,
      },
      elements: [
        {
          tag: 'div',
          text: {
            tag: 'lark_md' as const,
            content: 'Click the button below to ignite your personal sandbox. This will create a secure container for your session.',
          },
        },
        {
          tag: 'action',
          actions: [
            {
              tag: 'button' as const,
              text: {
                tag: 'plain_text' as const,
                content: 'Ignite Sandbox',
              },
              type: 'primary' as const,
              value: {
                action: 'ignite',
              },
            },
            {
              tag: 'button' as const,
              text: {
                tag: 'plain_text' as const,
                content: 'Cancel',
              },
              type: 'default' as const,
              value: {
                action: 'cancel',
              },
            },
          ],
        },
      ],
    };

    // Send card via Feishu API (using sendPostMessage for card content)
    // Note: For interactive cards, we need to use the card msg_type
    try {
      // Since feishuWebSocket doesn't have sendCardMessage, we'll use the text message as fallback
      // In production, we should implement sendCardMessage in feishu-websocket.ts
      await feishuWebSocket.sendTextMessage(
        userId,
        'Ignite Your Sandbox\n\nClick the button below to ignite your personal sandbox. This will create a secure container for your session.\n\n(Note: Interactive card UI will be implemented in a future update. For now, please reply with "ignite" to start your sandbox.)'
      );
    } catch (error) {
      console.error(`[Orchestrator] Failed to send ignition card to user ${userId}:`, error);
    }
  }

  /**
   * Initialize orchestrator with Feishu WebSocket
   */
  async initialize(): Promise<void> {
    console.log('[Orchestrator] Initializing orchestrator...');

    // Register message handler with Feishu WebSocket
    feishuWebSocket.onMessage(async (message) => {
      await this.handleFeishuMessage(message);
    });

    console.log('[Orchestrator] Orchestrator initialized');
  }

  /**
   * Shutdown orchestrator
   */
  async shutdown(): Promise<void> {
    console.log('[Orchestrator] Shutting down orchestrator...');

    // Stop cleanup interval
    this.stopCleanupInterval();

    // Stop all containers
    const states = this.getActiveStates();
    for (const state of states) {
      if (state.containerInfo) {
        try {
          await dockerOrchestrator.stopSandbox(state.userId);
        } catch (error) {
          console.error(`[Orchestrator] Failed to stop container for user ${state.userId}:`, error);
        }
      }
    }

    // Clear state machine
    this.stateMachine.clear();

    console.log('[Orchestrator] Orchestrator shut down');
  }
}

// Export singleton instance
export const orchestrator = new SynapseOrchestrator();
