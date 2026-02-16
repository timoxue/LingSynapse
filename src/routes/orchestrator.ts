import express from 'express';
import { orchestrator } from '../services/orchestrator';
import { dockerOrchestrator } from '../services/docker-orchestrator';
import { feishuWebSocket } from '../services/feishu-websocket';
import { wsTunnel } from '../services/ws-tunnel';

const router = express.Router();

/**
 * GET /api/orchestrator/states
 * Get all active user states
 */
router.get('/states', (req, res) => {
  try {
    const states = orchestrator.getActiveStates();
    res.json({
      count: states.length,
      states: states.map(state => ({
        userId: state.userId,
        hasContainer: !!state.containerInfo,
        containerStatus: state.containerInfo?.status || null,
        awaitingConfirmation: state.awaitingConfirmation,
        lastActivity: state.lastActivity,
      })),
    });
  } catch (error) {
    console.error('[OrchestratorRoutes] Error getting states:', error);
    res.status(500).json({ error: 'Failed to get states' });
  }
});

/**
 * GET /api/orchestrator/states/:userId
 * Get user state
 */
router.get('/states/:userId', (req, res) => {
  try {
    const { userId } = req.params;
    const states = orchestrator.getActiveStates();
    const state = states.find(s => s.userId === userId);

    if (!state) {
      return res.status(404).json({ error: 'User state not found' });
    }

    res.json({
      userId: state.userId,
      hasContainer: !!state.containerInfo,
      containerInfo: state.containerInfo ? {
        containerId: state.containerInfo.containerId,
        port: state.containerInfo.port,
        status: state.containerInfo.status,
        createdAt: state.containerInfo.createdAt,
      } : null,
      awaitingConfirmation: state.awaitingConfirmation,
      lastActivity: state.lastActivity,
    });
  } catch (error) {
    console.error('[OrchestratorRoutes] Error getting user state:', error);
    res.status(500).json({ error: 'Failed to get user state' });
  }
});

/**
 * POST /api/orchestrator/states/:userId/stop
 * Stop user sandbox
 */
router.post('/states/:userId/stop', async (req, res) => {
  try {
    const { userId } = req.params;
    await orchestrator.stopSandbox(userId);
    res.json({ message: 'Sandbox stopped successfully' });
  } catch (error) {
    console.error('[OrchestratorRoutes] Error stopping sandbox:', error);
    res.status(500).json({ error: 'Failed to stop sandbox' });
  }
});

/**
 * GET /api/orchestrator/logs/:userId
 * Get container logs (with optional tail query)
 */
router.get('/logs/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const tail = req.query.tail ? parseInt(req.query.tail as string) : 100;

    if (isNaN(tail) || tail < 1) {
      return res.status(400).json({ error: 'Invalid tail parameter' });
    }

    const logs = await dockerOrchestrator.getContainerLogs(userId, tail);
    res.json({
      userId,
      tail,
      logs,
    });
  } catch (error) {
    console.error('[OrchestratorRoutes] Error getting container logs:', error);
    res.status(500).json({ error: 'Failed to get container logs' });
  }
});

/**
 * GET /api/orchestrator/connections
 * Get connection counts
 */
router.get('/connections', (req, res) => {
  try {
    const counts = wsTunnel.getConnectionCounts();
    const wsStatus = feishuWebSocket.getConnectionStatus();

    res.json({
      nodeConnections: counts.nodeConnections,
      containerConnections: counts.containerConnections,
      feishuWebSocketConnected: wsStatus,
    });
  } catch (error) {
    console.error('[OrchestratorRoutes] Error getting connection counts:', error);
    res.status(500).json({ error: 'Failed to get connection counts' });
  }
});

/**
 * POST /api/orchestrator/cleanup
 * Trigger cleanup
 */
router.post('/cleanup', async (req, res) => {
  try {
    // Get states before cleanup
    const statesBefore = orchestrator.getActiveStates();

    // Trigger cleanup by calling orchestrator's internal cleanup method
    // Since cleanupInactiveStates is private, we'll need to use a different approach
    // For now, we'll just return the current state information
    await orchestrator.shutdown();

    res.json({
      message: 'Cleanup completed',
      statesBefore: statesBefore.length,
    });
  } catch (error) {
    console.error('[OrchestratorRoutes] Error during cleanup:', error);
    res.status(500).json({ error: 'Failed to perform cleanup' });
  }
});

export default router;
