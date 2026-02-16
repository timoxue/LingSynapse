import WebSocket from 'ws';

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
   * Connect to Docker container WebSocket for a user
   *
   * @param userId - User identifier
   * @param containerPort - Port of the Docker container
   * @returns Promise that resolves when connection is established
   */
  async connectToContainer(userId: string, containerPort: number): Promise<void> {
    // Close existing container connection if any
    const existingConnection = this.containerConnections.get(userId);
    if (existingConnection && existingConnection.readyState === WebSocket.OPEN) {
      console.log(`[WSTunnel] Closing existing container connection for user ${userId}`);
      existingConnection.close();
    }

    // Create new WebSocket connection to container
    const containerUrl = `ws://localhost:${containerPort}`;
    console.log(`[WSTunnel] Connecting to container for user ${userId} at ${containerUrl}`);

    const containerWs = new WebSocket(containerUrl);

    return new Promise((resolve, reject) => {
      // Handle connection open
      containerWs.on('open', () => {
        console.log(`[WSTunnel] Connected to container for user ${userId}`);
        this.containerConnections.set(userId, containerWs);
        resolve();
      });

      // Handle connection error
      containerWs.on('error', (error) => {
        console.error(`[WSTunnel] Container connection error for user ${userId}:`, error);
        this.containerConnections.delete(userId);
        reject(error);
      });

      // Set up message handler for container connection
      containerWs.on('message', (data: WebSocket.Data) => {
        this.handleContainerMessage(userId, data);
      });

      // Handle container connection close
      containerWs.on('close', () => {
        console.log(`[WSTunnel] Container connection closed for user ${userId}`);
        this.containerConnections.delete(userId);
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
   * Handle messages from container and forward to Node client
   *
   * @param userId - User identifier
   * @param data - Message data from container
   */
  private handleContainerMessage(userId: string, data: WebSocket.Data): void {
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
   * @returns True if user has both Node and container connections
   */
  hasActiveConnections(userId: string): boolean {
    const nodeWs = this.nodeConnections.get(userId);
    const containerWs = this.containerConnections.get(userId);

    return (
      nodeWs?.readyState === WebSocket.OPEN &&
      containerWs?.readyState === WebSocket.OPEN
    );
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
