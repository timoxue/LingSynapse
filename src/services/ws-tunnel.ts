import WebSocket from 'ws';
import * as net from 'net';

/**
 * WebSocket Tunnel Service
 *
 * Implements a transparent three-way pipe (三通管道) between:
 * - Node client (PC) connection
 * - Docker container WebSocket connection
 * - Relay server (this service)
 *
 * Each user has their own Node connection and their own Docker container.
 * The tunnel service manages bidirectional message forwarding between these connections.
 */
export class WSTunnelService {
  // Map of user ID to Node WebSocket connection (PC side)
  private nodeConnections: Map<string, WebSocket> = new Map();

  // Map of user ID to Container WebSocket connection (Docker side)
  private containerConnections: Map<string, WebSocket> = new Map();

  /**
   * Check if a TCP port is reachable
   */
  private async isPortReachable(host: string, port: number, timeout: number = 2000): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = new net.Socket();

      socket.setTimeout(timeout);

      socket.on('connect', () => {
        socket.destroy();
        resolve(true);
      });

      socket.on('timeout', () => {
        socket.destroy();
        resolve(false);
      });

      socket.on('error', () => {
        socket.destroy();
        resolve(false);
      });

      socket.connect(port, host);
    });
  }

  /**
   * Register Node (PC) connection for a user
   *
   * @param userId - User identifier
   * @param ws - WebSocket connection from Node client
   */
  registerNodeConnection(userId: string, ws: WebSocket): void {
    // Close existing connection if any
    const existingConnection = this.nodeConnections.get(userId);
    if (existingConnection && existingConnection.readyState === WebSocket.OPEN) {
      console.log(`[WSTunnel] Closing existing Node connection for user ${userId}`);
      existingConnection.close();
    }

    // Register new connection
    this.nodeConnections.set(userId, ws);
    console.log(`[WSTunnel] Registered Node connection for user ${userId}`);

    // Set up message handler for Node connection
    ws.on('message', (data: WebSocket.Data) => {
      this.handleNodeMessage(userId, data);
    });

    // Handle Node connection close
    ws.on('close', () => {
      console.log(`[WSTunnel] Node connection closed for user ${userId}`);
      this.nodeConnections.delete(userId);

      // Also disconnect container when Node disconnects
      this.disconnectContainer(userId);
    });

    // Handle Node connection error
    ws.on('error', (error) => {
      console.error(`[WSTunnel] Node connection error for user ${userId}:`, error);
    });
  }

  /**
   * Connect to Docker container WebSocket for a user with port check and retry logic
   *
   * @param userId - User identifier
   * @param containerPort - Port of Docker container (unused when connecting via container name)
   * @param gatewayToken - Gateway authentication token (optional)
   * @returns Promise that resolves when connection is established
   */
  async connectToContainer(userId: string, containerPort: number, gatewayToken?: string): Promise<void> {
    // Close existing container connection if any
    const existingConnection = this.containerConnections.get(userId);
    if (existingConnection && existingConnection.readyState === WebSocket.OPEN) {
      console.log(`[WSTunnel] Closing existing container connection for user ${userId}`);
      existingConnection.close();
    }

    // Container name format: openclaw-sandbox-{userId}
    // Relay server is in the same Docker network (synapse-net), so we can connect via container name
    const containerName = `openclaw-sandbox-${userId}`;
    const containerUrl = `ws://${containerName}:18789`;
    console.log(`[WSTunnel] Connecting to container ${containerName} for user ${userId} at ${containerUrl}`);

    // Retry logic: check port first, then try WebSocket connection
    const maxRetries = 15;
    const retryDelay = 1000; // 1 second between checks

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      console.log(`[WSTunnel] Connection attempt ${attempt}/${maxRetries} for user ${userId}`);

      // Step 1: Check if port is reachable
      const portReachable = await this.isPortReachable(containerName, 18789, 1000);
      console.log(`[WSTunnel] Port 18789 check for ${containerName}: ${portReachable ? 'REACHABLE' : 'NOT REACHABLE'}`);

      if (!portReachable) {
        if (attempt < maxRetries) {
          console.log(`[WSTunnel] Port not reachable, retrying in ${retryDelay / 1000} seconds...`);
          await new Promise(resolve => setTimeout(resolve, retryDelay));
          continue;
        } else {
          throw new Error(`Port 18789 not reachable after ${maxRetries} attempts`);
        }
      }

      // Step 2: Try WebSocket connection
      try {
        await this.tryConnect(userId, containerName, containerUrl, gatewayToken);
        console.log(`[WSTunnel] Successfully connected to container for user ${userId}`);
        return;
      } catch (error: any) {
        console.log(`[WSTunnel] WebSocket connection attempt ${attempt} failed for user ${userId}: ${error.message}`);

        if (attempt < maxRetries) {
          console.log(`[WSTunnel] Retrying in ${retryDelay / 1000} seconds...`);
          await new Promise(resolve => setTimeout(resolve, retryDelay));
        } else {
          console.error(`[WSTunnel] All connection attempts failed for user ${userId}`);
          throw error;
        }
      }
    }
  }

  /**
   * Try to connect to container WebSocket with Gateway handshake
   */
  private tryConnect(userId: string, containerName: string, containerUrl: string, gatewayToken?: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const containerWs = new WebSocket(containerUrl);

      // Set connection timeout (longer for handshake)
      const timeout = setTimeout(() => {
        containerWs.terminate();
        reject(new Error('Connection timeout'));
      }, 15000); // 15 second timeout

      // Store gateway token for use in message handler
      (containerWs as any).gatewayToken = gatewayToken;
      (containerWs as any).userId = userId;

      // Handle connection open - wait for Gateway challenge
      containerWs.on('open', () => {
        clearTimeout(timeout);
        console.log(`[WSTunnel] Connected to container for user ${userId}, waiting for Gateway challenge`);

        // Store gateway token and userId on ws object for later use
        (containerWs as any).gatewayToken = gatewayToken;
        (containerWs as any).userId = userId;

        // Add to connections map BEFORE setting up message handler
        this.containerConnections.set(userId, containerWs);

        // Set up message handler for container connection
        containerWs.on('message', (data: WebSocket.Data) => {
          this.handleContainerMessage(userId, data);
        });

        // Handle container connection close
        containerWs.on('close', () => {
          console.log(`[WSTunnel] Container connection closed for user ${userId}`);
          this.containerConnections.delete(userId);
        });

        // Resolve immediately
        resolve();
      });

      // Handle connection error
      containerWs.on('error', (error: any) => {
        clearTimeout(timeout);
        containerWs.terminate();
        reject(error);
      });
    });
  }

  /**
   * Handle messages from Node client and forward to container
   *
   * @param userId - User identifier
   * @param data - Message data from Node client
   */
  private handleNodeMessage(userId: string, data: WebSocket.Data): void {
    const containerWs = this.containerConnections.get(userId);

    if (!containerWs || containerWs.readyState !== WebSocket.OPEN) {
      console.warn(`[WSTunnel] No active container connection for user ${userId}, cannot forward message`);
      return;
    }

    try {
      // Forward message to container
      containerWs.send(data);
      console.log(`[WSTunnel] Forwarded message from Node to container for user ${userId}`);
    } catch (error) {
      console.error(`[WSTunnel] Error forwarding message to container for user ${userId}:`, error);
    }
  }

  /**
   * Send a chat message directly to the container
   * This is used when messages come from Feishu (instead of Node client)
   *
   * @param userId - User identifier
   * @param text - Message text to send
   */
  async sendChatMessage(userId: string, text: string): Promise<void> {
    const containerWs = this.containerConnections.get(userId);

    if (!containerWs || containerWs.readyState !== WebSocket.OPEN) {
      console.warn(`[WSTunnel] No active container connection for user ${userId}, cannot send message`);
      return;
    }

    // Check if handshake is complete
    if (!(containerWs as any).handshakeComplete) {
      console.warn(`[WSTunnel] Handshake not complete for user ${userId}, cannot send message`);
      return;
    }

    try {
      // Send Gateway chat request
      const chatRequest = {
        type: 'req',
        id: Date.now(),
        method: 'chat',
        params: {
          message: text,
        },
      };

      containerWs.send(JSON.stringify(chatRequest));
      console.log(`[WSTunnel] Sent chat message to container for user ${userId}: ${text}`);
    } catch (error) {
      console.error(`[WSTunnel] Error sending chat message to container for user ${userId}:`, error);
    }
  }

  /**
   * Handle messages from container and forward to Node client
   *
   * @param userId - User identifier
   * @param data - Message data from container
   */
  private handleContainerMessage(userId: string, data: WebSocket.Data): void {
    const containerWs = this.containerConnections.get(userId);

    if (!containerWs) {
      console.warn(`[WSTunnel] No container connection for user ${userId}`);
      return;
    }

    try {
      const messageStr = data.toString();
      const message = JSON.parse(messageStr);

      console.log(`[WSTunnel] Received message from container for user ${userId}:`, message.type);

      // Handle connect.challenge event - Gateway sends this first
      if (message.type === 'event' && message.event === 'connect.challenge') {
        console.log(`[WSTunnel] Received connect.challenge, sending connect response`);

        // Send Gateway connect response
        const gatewayToken = (containerWs as any).gatewayToken;
        const connectRequest: any = {
          type: 'req',
          id: `connect_${Date.now()}`,
          method: 'connect',
          params: {
            minProtocol: 3,
            maxProtocol: 3,
            client: {
              id: 'cli',
              version: '1.2.3',
              platform: 'macos',
              mode: 'cli'
            },
            role: 'operator',
            scopes: ['operator.read', 'operator.write'],
            caps: [],
            commands: [],
            permissions: {},
            locale: 'en-US',
            userAgent: `lingsynapse-relay/1.0.0`
          },
        };

        // Add token if available - use auth object
        if (gatewayToken) {
          connectRequest.params.auth = { token: gatewayToken };
          console.log(`[WSTunnel] Using gateway token for connection`);
        }

        containerWs.send(JSON.stringify(connectRequest));
        console.log(`[WSTunnel] Sent Gateway connect response for user ${userId}`);
        return;
      }

      // Handle hello-ok event - handshake complete
      if (message.type === 'res' && message.ok === true && message.payload?.type === 'hello-ok') {
        console.log(`[WSTunnel] Gateway handshake complete for user ${userId} (hello-ok)`);
        (containerWs as any).handshakeComplete = true;
        return;
      }

      // Handle error responses
      if (message.type === 'res' && message.ok === false) {
        console.error(`[WSTunnel] Gateway error for user ${userId}:`, message.error?.message);
        return;
      }

      // Handle chat response
      if (message.type === 'res' && message.method === 'chat') {
        const text = message.result?.text || message.result?.content || '';
        if (text) {
          // Send to Feishu via orchestrator
          console.log(`[WSTunnel] Chat response for user ${userId}: ${text}`);
          // TODO: Send to Feishu message callback
        }
        return;
      }

    } catch (error) {
      console.error(`[WSTunnel] Error parsing container message for user ${userId}:`, error);
    }

    // Original: Forward to Node client (if exists)
    const nodeWs = this.nodeConnections.get(userId);

    if (!nodeWs || nodeWs.readyState !== WebSocket.OPEN) {
      console.warn(`[WSTunnel] No active Node connection for user ${userId}, cannot forward message`);
      return;
    }

    try {
      // Forward message to Node client
      nodeWs.send(data);
      console.log(`[WSTunnel] Forwarded message from container to Node for user ${userId}`);
    } catch (error) {
      console.error(`[WSTunnel] Error forwarding message to Node for user ${userId}:`, error);
    }
  }

  /**
   * Disconnect container connection for a user
   *
   * @param userId - User identifier
   */
  disconnectContainer(userId: string): void {
    const containerWs = this.containerConnections.get(userId);
    if (containerWs && containerWs.readyState === WebSocket.OPEN) {
      console.log(`[WSTunnel] Disconnecting container for user ${userId}`);
      containerWs.close();
      this.containerConnections.delete(userId);
    }
  }

  /**
   * Disconnect Node connection for a user
   *
   * @param userId - User identifier
   */
  disconnectNode(userId: string): void {
    const nodeWs = this.nodeConnections.get(userId);
    if (nodeWs && nodeWs.readyState === WebSocket.OPEN) {
      console.log(`[WSTunnel] Disconnecting Node for user ${userId}`);
      nodeWs.close();
      this.nodeConnections.delete(userId);
    }

    // Also disconnect container when Node disconnects
    this.disconnectContainer(userId);
  }

  /**
   * Get connection counts
   *
   * @returns Object with node and container connection counts
   */
  getConnectionCounts(): { nodeConnections: number; containerConnections: number } {
    return {
      nodeConnections: this.nodeConnections.size,
      containerConnections: this.containerConnections.size,
    };
  }

  /**
   * Check if user has active connections
   *
   * @param userId - User identifier
   * @returns True if user has active container connection
   */
  hasActiveConnections(userId: string): boolean {
    const containerWs = this.containerConnections.get(userId);
    return containerWs?.readyState === WebSocket.OPEN;
  }

  /**
   * Disconnect all connections for a user
   *
   * @param userId - User identifier
   */
  disconnectAll(userId: string): void {
    this.disconnectNode(userId);
    this.disconnectContainer(userId);
  }

  /**
   * Shutdown all connections (for graceful shutdown)
   */
  shutdown(): void {
    console.log('[WSTunnel] Shutting down all connections...');

    // Close all Node connections
    for (const [userId, nodeWs] of this.nodeConnections.entries()) {
      if (nodeWs.readyState === WebSocket.OPEN) {
        console.log(`[WSTunnel] Closing Node connection for user ${userId}`);
        nodeWs.close();
      }
    }

    this.nodeConnections.clear();

    // Close all container connections
    for (const [userId, containerWs] of this.containerConnections.entries()) {
      if (containerWs.readyState === WebSocket.OPEN) {
        console.log(`[WSTunnel] Closing container connection for user ${userId}`);
        containerWs.close();
      }
    }

    this.containerConnections.clear();
    console.log('[WSTunnel] All connections closed');
  }
}

// Export singleton instance
export const wsTunnel = new WSTunnelService();
