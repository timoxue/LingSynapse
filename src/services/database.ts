import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import type { User, Session } from '../types';

const dbDir = path.dirname(process.env.DATABASE_PATH || './database/openclaw_relay.db');
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(process.env.DATABASE_PATH || './database/openclaw_relay.db');

// 启用外键约束
db.pragma('foreign_keys = ON');

// 创建用户表（基础结构）
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    feishu_user_id TEXT UNIQUE NOT NULL,
    token TEXT UNIQUE NOT NULL,
    token_expires_at DATETIME NOT NULL,
    ws_connected BOOLEAN DEFAULT 0,
    last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// 数据库迁移：添加飞书 token 列（如果不存在）
try {
  db.exec('ALTER TABLE users ADD COLUMN feishu_access_token TEXT');
} catch (e) {
  // 列已存在，忽略错误
}

try {
  db.exec('ALTER TABLE users ADD COLUMN feishu_refresh_token TEXT');
} catch (e) {
  // 列已存在，忽略错误
}

try {
  db.exec("ALTER TABLE users ADD COLUMN feishu_token_expires_at DATETIME");
} catch (e) {
  // 列已存在，忽略错误
}

// 创建会话表
db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    ws_id TEXT NOT NULL,
    connected_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )
`);

// 创建配置表
db.exec(`
  CREATE TABLE IF NOT EXISTS config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    expires_at DATETIME,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// 创建代理请求表
db.exec(`
  CREATE TABLE IF NOT EXISTS proxy_requests (
    id TEXT PRIMARY KEY,
    requestor_user_id TEXT NOT NULL,
    target_user_id TEXT NOT NULL,
    agent_name TEXT NOT NULL DEFAULT 'openclaw',
    message TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    result TEXT,
    card_message_id TEXT
  )
`);

// 创建索引
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_users_feishu_id ON users(feishu_user_id);
  CREATE INDEX IF NOT EXISTS idx_users_token ON users(token);
  CREATE INDEX IF NOT EXISTS idx_sessions_ws_id ON sessions(ws_id);
  CREATE INDEX IF NOT EXISTS idx_config_key ON config(key);
  CREATE INDEX IF NOT EXISTS idx_proxy_target_status
  ON proxy_requests(target_user_id, status);
  CREATE INDEX IF NOT EXISTS idx_proxy_requestor_status
  ON proxy_requests(requestor_user_id, status);
  CREATE INDEX IF NOT EXISTS idx_proxy_expires
  ON proxy_requests(expires_at);
`);

// 暴露数据库实例
export const getDb = () => db;

export const database = {
  getDb: () => db,
  // 用户操作
  createUser: (feishuUserId: string, token: string, expiresAt: Date): User => {
    const stmt = db.prepare(`
      INSERT INTO users (feishu_user_id, token, token_expires_at)
      VALUES (?, ?, ?)
    `);
    const result = stmt.run(feishuUserId, token, expiresAt.toISOString());
    return database.getUserById(result.lastInsertRowid as number)!;
  },

  createUserWithFeishuTokens: (
    feishuUserId: string,
    token: string,
    tokenExpiresAt: Date,
    feishuAccessToken: string,
    feishuRefreshToken: string,
    feishuTokenExpiresAt: Date
  ): User => {
    const stmt = db.prepare(`
      INSERT INTO users (
        feishu_user_id, token, token_expires_at,
        feishu_access_token, feishu_refresh_token, feishu_token_expires_at
      )
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      feishuUserId,
      token,
      tokenExpiresAt.toISOString(),
      feishuAccessToken,
      feishuRefreshToken,
      feishuTokenExpiresAt.toISOString()
    );
    return database.getUserById(result.lastInsertRowid as number)!;
  },

  getUserByFeishuId: (feishuUserId: string): User | undefined => {
    const stmt = db.prepare('SELECT * FROM users WHERE feishu_user_id = ?');
    return stmt.get(feishuUserId) as User | undefined;
  },

  getUserByToken: (token: string): User | undefined => {
    const stmt = db.prepare("SELECT * FROM users WHERE token = ? AND token_expires_at > datetime('now', 'localtime')");
    return stmt.get(token) as User | undefined;
  },

  getUserById: (id: number): User | undefined => {
    const stmt = db.prepare('SELECT * FROM users WHERE id = ?');
    return stmt.get(id) as User | undefined;
  },

  updateUserToken: (id: number, token: string, expiresAt: Date): void => {
    const stmt = db.prepare(`
      UPDATE users SET token = ?, token_expires_at = ? WHERE id = ?
    `);
    stmt.run(token, expiresAt.toISOString(), id);
  },

  updateUserAndFeishuTokens: (
    id: number,
    token: string,
    tokenExpiresAt: Date,
    feishuAccessToken: string,
    feishuRefreshToken: string,
    feishuTokenExpiresAt: Date
  ): void => {
    const stmt = db.prepare(`
      UPDATE users
      SET token = ?, token_expires_at = ?,
          feishu_access_token = ?, feishu_refresh_token = ?, feishu_token_expires_at = ?
      WHERE id = ?
    `);
    stmt.run(
      token,
      tokenExpiresAt.toISOString(),
      feishuAccessToken,
      feishuRefreshToken,
      feishuTokenExpiresAt.toISOString(),
      id
    );
  },

  setWsConnected: (userId: number, connected: boolean): void => {
    const stmt = db.prepare(`
      UPDATE users SET ws_connected = ?, last_seen = datetime('now') WHERE id = ?
    `);
    stmt.run(connected ? 1 : 0, userId);
  },

  updateLastSeen: (userId: number): void => {
    const stmt = db.prepare("UPDATE users SET last_seen = datetime('now') WHERE id = ?");
    stmt.run(userId);
  },

  // 会话操作
  createSession: (userId: number, wsId: string): Session => {
    const stmt = db.prepare(`
      INSERT INTO sessions (user_id, ws_id) VALUES (?, ?)
    `);
    const result = stmt.run(userId, wsId);
    const stmt2 = db.prepare('SELECT * FROM sessions WHERE id = ?');
    return stmt2.get(result.lastInsertRowid as number) as Session;
  },

  deleteSession: (wsId: string): void => {
    const stmt = db.prepare('DELETE FROM sessions WHERE ws_id = ?');
    stmt.run(wsId);
  },

  getSessionByWsId: (wsId: string): Session | undefined => {
    const stmt = db.prepare('SELECT * FROM sessions WHERE ws_id = ?');
    return stmt.get(wsId) as Session | undefined;
  },

  getUserByWsId: (wsId: string): User | undefined => {
    const stmt = db.prepare(`
      SELECT u.* FROM users u
      INNER JOIN sessions s ON u.id = s.user_id
      WHERE s.ws_id = ?
    `);
    return stmt.get(wsId) as User | undefined;
  },

  // 配置操作 - 用于存储应用级别的token
  getConfig: (key: string): string | undefined => {
    const stmt = db.prepare(`
      SELECT value FROM config
      WHERE key = ?
      AND (expires_at IS NULL OR expires_at > datetime('now', 'localtime'))
      ORDER BY updated_at DESC
      LIMIT 1
    `);
    const result = stmt.get(key) as { value: string } | undefined;
    return result?.value;
  },

  getConfigWithExpiry: (key: string): { value: string; expiresAt: number } | undefined => {
    const stmt = db.prepare(`
      SELECT value, expires_at FROM config
      WHERE key = ?
      AND (expires_at IS NULL OR expires_at > datetime('now', 'localtime'))
      ORDER BY updated_at DESC
      LIMIT 1
    `);
    const result = stmt.get(key) as { value: string; expires_at: string | null } | undefined;
    if (!result) return undefined;
    return {
      value: result.value,
      expiresAt: result.expires_at ? new Date(result.expires_at).getTime() / 1000 : Infinity,
    };
  },

  setConfig: (key: string, value: string, expiresAt?: Date): void => {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO config (key, value, expires_at, updated_at)
      VALUES (?, ?, ?, datetime('now'))
    `);
    stmt.run(key, value, expiresAt ? expiresAt.toISOString() : null);
  },

  deleteConfig: (key: string): void => {
    const stmt = db.prepare('DELETE FROM config WHERE key = ?');
    stmt.run(key);
  },

  // Proxy request operations
  createProxyRequest: (data: {
    id: string;
    requestorUserId: string;
    targetUserId: string;
    agentName: string;
    message: string;
    expiresAt: number;
  }): void => {
    const now = Math.floor(Date.now() / 1000);
    const stmt = db.prepare(`
      INSERT INTO proxy_requests (
        id, requestor_user_id, target_user_id, agent_name,
        message, status, created_at, updated_at, expires_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      data.id,
      data.requestorUserId,
      data.targetUserId,
      data.agentName,
      data.message,
      'pending',
      now,
      now,
      data.expiresAt
    );
  },

  getProxyRequest: (id: string): Record<string, any> | undefined => {
    const stmt = db.prepare('SELECT * FROM proxy_requests WHERE id = ?');
    const row = stmt.get(id) as any;
    if (!row) return undefined;
    return {
      id: row.id,
      requestorUserId: row.requestor_user_id,
      targetUserId: row.target_user_id,
      agentName: row.agent_name,
      message: row.message,
      status: row.status,
      createdAt: new Date((row.created_at as number) * 1000),
      updatedAt: new Date((row.updated_at as number) * 1000),
      expiresAt: new Date((row.expires_at as number) * 1000),
      result: row.result,
      cardMessageId: row.card_message_id,
    };
  },

  updateProxyRequest: (
    id: string,
    updates: Partial<{
      status: string;
      result: string;
      cardMessageId: string;
    }>
  ): boolean => {
    const fields: string[] = [];
    const values: any[] = [];

    if (updates.status !== undefined) {
      fields.push('status = ?');
      values.push(updates.status);
    }
    if (updates.result !== undefined) {
      fields.push('result = ?');
      values.push(updates.result);
    }
    if (updates.cardMessageId !== undefined) {
      fields.push('card_message_id = ?');
      values.push(updates.cardMessageId);
    }

    if (fields.length === 0) return false;

    fields.push('updated_at = ?');
    values.push(Math.floor(Date.now() / 1000));
    values.push(id);

    const stmt = db.prepare(`
      UPDATE proxy_requests
      SET ${fields.join(', ')}
      WHERE id = ?
    `);

    const result = stmt.run(...values);
    return result.changes > 0;
  },

  getPendingRequests: (targetUserId: string): Record<string, any>[] => {
    const now = Math.floor(Date.now() / 1000);
    const stmt = db.prepare(`
      SELECT * FROM proxy_requests
      WHERE target_user_id = ? AND status = 'pending' AND expires_at > ?
      ORDER BY created_at DESC
    `);
    return stmt.all(targetUserId, now) as Record<string, any>[];
  },

  getUserRequests: (requestorUserId: string): Record<string, any>[] => {
    const stmt = db.prepare(`
      SELECT * FROM proxy_requests
      WHERE requestor_user_id = ?
      ORDER BY created_at DESC
      LIMIT 10
    `);
    return stmt.all(requestorUserId) as Record<string, any>[];
  },

  cancelProxyRequest: (id: string, requestorUserId: string): boolean => {
    const now = Math.floor(Date.now() / 1000);
    const stmt = db.prepare(`
      UPDATE proxy_requests
      SET status = 'cancelled', updated_at = ?
      WHERE id = ? AND requestor_user_id = ? AND status = 'pending'
    `);
    const result = stmt.run(now, id, requestorUserId);
    return result.changes > 0;
  },
};

export default db;
