/**
 * Simple test script for Feishu WebSocket client
 *
 * Usage:
 * 1. Set up environment variables in .env file:
 *    FEISHU_APP_ID=your_app_id
 *    FEISHU_APP_SECRET=your_app_secret
 *    FEISHU_ENCRYPT_KEY=your_encrypt_key
 *    FEISHU_VERIFICATION_TOKEN=your_verification_token
 *
 * 2. Run: npx tsx test-feishu-ws.ts
 */

import 'dotenv/config';
import { feishuWebSocket } from './src/services/feishu-websocket';

// Verify environment variables are loaded
console.log('[ENV] Loaded environment variables:');
console.log(`  FEISHU_APP_ID: ${process.env.FEISHU_APP_ID ? '✓' : '✗ missing'}`);
console.log(`  FEISHU_APP_SECRET: ${process.env.FEISHU_APP_SECRET ? '✓' : '✗ missing'}`);
console.log(`  FEISHU_ENCRYPT_KEY: ${process.env.FEISHU_ENCRYPT_KEY ? '✓' : '✗ missing'}`);
console.log(`  FEISHU_VERIFICATION_TOKEN: ${process.env.FEISHU_VERIFICATION_TOKEN ? '✓' : '✗ missing'}`);
console.log('');

async function testFeishuWebSocket() {
  try {
    console.log('=== Feishu WebSocket Test ===\n');

    // Register message handler
    feishuWebSocket.onMessage((message) => {
      console.log('\n[TEST] Received message from Feishu:');
      console.log(`  Sender: ${message.event.sender.sender_id.user_id}`);
      console.log(`  Chat: ${message.event.message.chat_id}`);
      console.log(`  Content: ${message.event.message.content}`);
    });

    // Start WebSocket connection
    console.log('Starting WebSocket connection...');
    await feishuWebSocket.start();
    console.log('WebSocket connected!\n');

    // Keep the connection alive
    console.log('Listening for messages... (Press Ctrl+C to stop)');
    
    // Example: Send a test message (uncomment and replace user_id)
    // const userId = 'your_feishu_user_id';
    // const success = await feishuWebSocket.sendTextMessage(userId, 'Hello from WebSocket test!');
    // console.log(`Message sent: ${success}`);

  } catch (error) {
    console.error('Test failed:', error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\nShutting down...');
  feishuWebSocket.stop();
  process.exit(0);
});

// Run test
testFeishuWebSocket();
