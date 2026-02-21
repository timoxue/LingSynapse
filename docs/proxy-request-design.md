# OpenClaw 智能体代理请求系统设计文档

## 1. 需求概述

用户A 可以通过中继服务发起请求，调用用户B 的 OpenClaw 智能体，需要经过用户B 的审批（通过飞书卡片）后才能执行。

## 2. 架构设计

```
┌────────────────────────────────────────────────────────────────────────────────────┐
│                              飞书平台                                   │
│  ┌──────────────┐    WebSocket      ┌──────────────┐   HTTP API    ┌──────────┐  │
│  │  用户A      │◀────────────────▶│  中继服务     │◀─────────────▶│  用户B   │  │
│  │ (Requestor)  │   (消息接收)      │              │   (卡片发送)   │(审批)   │  │
│  └──────────────┘                   └──────┬───────┘               └──────────┘  │
│                                             │                                      │
│                                       长连接事件                                     │
│                                    ┌───────▼───────┐                               │
│                                    │  事件处理层    │                               │
│                                    │              │                               │
└──────────────────────────────────────────┴──────────────┴────────────────────────────┘
                                             │
                             ┌────────────────┼────────────────┐
                             │                │                │
                             ▼                ▼                ▼
                       ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
                       │ 飞书长连接   │  │  数据库       │  │ OpenClaw     │
                       │ (事件回调)   │  │ (请求存储)   │  │ 容器        │
                       └──────────────┘  └──────────────┘  └──────────────┘
```

## 3. 核心流程

### 3.1 用户A发起请求

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ 用户A 发送: @userB !openclaw "帮我查天气"                             │
│                                                                      │
│                          ▼                                           │
│ ┌────────────────────────────────────────────────────────────────────────┐   │
│ │  中继服务处理                                                   │   │
│ │                                                                  │   │
│ │  1. 解析 @userB 提及和命令                                       │   │
│ │  2. 解析消息内容: "帮我查天气"                                   │   │
│ │  3. 生成请求ID (UUID)                                          │   │
│ │  4. 创建 ProxyRequest 记录 (状态: PENDING)                            │   │
│ │  5. 调用飞书 HTTP API 发送审批卡片给用户B                           │   │
│ │  6. 回复用户A: "已向 @userB 发起 openclaw 调用请求"               │   │
│ │                                                                  │   │
│ └────────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 用户B收到审批卡片

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ 用户B在飞书App中看到:                                             │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────────┐      │
│  │  📋 OpenClaw 调用请求                               │      │
│  ├──────────────────────────────────────────────────────────────────┤      │
│  │  **请求者**: @用户A                                    │      │
│  │  **消息**: 帮我查天气                                    │      │
│  │  **智能体**: openclaw                                    │      │
│  ├──────────────────────────────────────────────────────────────────┤      │
│  │                              [✅ 同意]    [❌ 拒绝]            │◀──── 点击     │
│  └──────────────────────────────────────────────────────────────────┘      │
│                                                                      │
│                          ▼                                           │
│  飞书通过长连接推送卡片交互事件给中继                                  │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 3.3 中继处理审批结果

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ 中继收到长连接事件: P2CardActionTrigger                              │
│                                                                      │
│ ┌────────────────────────────────────────────────────────────────────────┐   │
│ │  1. 解析 action_value: "approve_abc123"                          │   │
│ │  2. 提取操作: approve, 请求ID: abc123                             │   │
│ │  3. 验证操作者是否为请求的目标用户B                                │   │
│ │  4. 检查请求状态是否为 PENDING                                      │   │
│ │                                                                  │   │
│ │  如果同意 (approve):                                             │   │
│ │  ┌──────────────────────────────────────────────────────────────┐    │   │
│ │  │  1. 检查用户B的 openclaw 容器是否运行              │    │   │
│ │  │  2. 通过 wsTunnel 发送消息到用户B的智能体               │    │   │
│ │  │     sendChatMessage(userB, "帮我查天气")                 │    │   │
│ │  │  3. 等待智能体响应 (最多30秒)                            │    │   │
│ │  │  4. 更新 ProxyRequest 状态为 APPROVED                 │    │   │
│ │  │  5. 调用飞书 API 更新卡片状态为"已执行"                │    │   │
│ │  │  6. 发送结果给用户A                                       │    │   │
│ │  └──────────────────────────────────────────────────────────────┘    │   │
│ │                                                                  │   │
│ │  如果拒绝 (reject):                                             │   │
│ │  ┌──────────────────────────────────────────────────────────────┐    │   │
│ │  │  1. 更新 ProxyRequest 状态为 REJECTED                 │    │   │
│ │  │  2. 调用飞书 API 更新卡片状态为"已拒绝"                │    │   │
│ │  │  3. 发送通知给用户A                                       │    │   │
│ │  └──────────────────────────────────────────────────────────────┘    │   │
│ └────────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

## 4. 命令列表

| 命令 | 说明 | 权限 |
|------|------|--------|
| `@userB !openclaw "消息"` | 向用户B发起智能体调用请求 | 所有用户 |
| `!openclaw request status` | 查看自己发起的请求状态 | 所有用户 |
| `!openclaw request list` | 查看待处理的请求（收到的） | 所有用户 |
| `!openclaw request cancel <id>` | 取消自己的请求 | 请求者 |

## 5. 数据库设计

### 5.1 proxy_requests 表

```sql
CREATE TABLE IF NOT EXISTS proxy_requests (
  id TEXT PRIMARY KEY,                    -- 请求ID (UUID)
  requestor_user_id TEXT NOT NULL,         -- 请求者用户A
  target_user_id TEXT NOT NULL,            -- 目标用户B
  agent_name TEXT NOT NULL DEFAULT 'openclaw', -- 智能体名称
  message TEXT NOT NULL,                  -- 请求消息内容
  status TEXT NOT NULL DEFAULT 'pending',  -- 状态
  created_at INTEGER NOT NULL,            -- 创建时间
  updated_at INTEGER NOT NULL,            -- 更新时间
  expires_at INTEGER NOT NULL,           -- 过期时间 (24小时)
  result TEXT,                          -- 执行结果
  card_message_id TEXT,                  -- 飞书消息ID (用于更新卡片)
  -- 索引
  INDEX idx_target_status ON proxy_requests(target_user_id, status),
  INDEX idx_requestor_status ON proxy_requests(requestor_user_id, status),
  INDEX idx_expires ON proxy_requests(expires_at)
);
```

### 5.2 状态枚举

```typescript
enum RequestStatus {
  PENDING = 'pending',      -- 等待审批
  APPROVED = 'approved',    -- 已同意并执行
  REJECTED = 'rejected',    -- 已拒绝
  EXPIRED = 'expired',      -- 已过期
  CANCELLED = 'cancelled',  -- 已取消
}
```

## 6. 类型定义

```typescript
// src/types/proxy-request.ts

export enum RequestStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  EXPIRED = 'expired',
  CANCELLED = 'cancelled',
}

export interface ProxyRequest {
  id: string;
  requestorUserId: string;
  targetUserId: string;
  agentName: string;
  message: string;
  status: RequestStatus;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
  result?: string;
  cardMessageId?: string;
}

// 飞书长连接事件
export interface LarkCardActionEvent {
  event_id: string;
  token: any;
  action: {
    value: string;  // approve_abc123, reject_abc123
    action_value: string;
  };
  operator: {
    user_id: string;
    open_id: string;
  };
  locale: string;
}
```

## 7. 审批卡片设计

### 7.1 待审批状态卡片

```typescript
const pendingCard = {
  config: { wide_screen_mode: true },
  header: {
    template: 'orange',
    title: {
      content: '📋 OpenClaw 调用请求',
      tag: 'plain_text'
    },
  },
  elements: [
    {
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: `**请求者**: @${request.requestorUserId}\n**消息**: ${request.message}\n**智能体**: ${request.agentName}`,
      },
    },
    {
      tag: 'hr',
    },
    {
      tag: 'action',
      actions: [
        {
          tag: 'button',
          text: '✅ 同意',
          type: 'primary',
          value: `approve_${request.id}`,
        },
        {
          tag: 'button',
          text: '❌ 拒绝',
          type: 'danger',
          value: `reject_${request.id}`,
        },
      ],
    },
  ],
};
```

### 7.2 已执行状态卡片

```typescript
const executedCard = {
  config: { wide_screen_mode: true },
  header: {
    template: 'green',
    title: {
      content: '📋 OpenClaw 调用请求',
      tag: 'plain_text'
    },
  },
  elements: [
    {
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: `**请求者**: @${request.requestorUserId}\n**消息**: ${request.message}`,
      },
    },
    {
      tag: 'hr',
    },
    {
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: `**状态**: ✅ 已执行\n**结果**: ${this.truncateResult(request.result)}`,
      },
    },
    {
      tag: 'note',
      elements: [
        {
          tag: 'lark_md',
          content: `本结果由 @${request.targetUserId} 的智能体 OpenClaw 生成，已获得本人授权。`,
        }
      ],
    },
  ],
};
```

### 7.3 已拒绝状态卡片

```typescript
const rejectedCard = {
  config: { wide_screen_mode: true },
  header: {
    template: 'red',
    title: {
      content: '📋 OpenClaw 调用请求',
      tag: 'plain_text'
    },
  },
  elements: [
    {
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: `**请求者**: @${request.requestorUserId}\n**消息**: ${request.message}`,
      },
    },
    {
      tag: 'hr',
    },
    {
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: `**状态**: ❌ 已拒绝`,
      },
    },
  ],
};
```

### 7.4 处理中状态卡片

```typescript
const processingCard = {
  config: { wide_screen_mode: true },
  header: {
    template: 'blue',
    title: {
      content: '📋 OpenClaw 调用请求',
      tag: 'plain_text'
    },
  },
  elements: [
    {
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: `**请求者**: @${request.requestorUserId}\n**消息**: ${request.message}`,
      },
    },
    {
      tag: 'hr',
    },
    {
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: `**状态**: ⏳ 处理中...`,
      },
    },
  ],
};
```

## 8. 新增文件结构

```
src/
├── services/
│   ├── proxy-request-service.ts    # 代理请求服务
│   ├── lark-event-handler.ts      # 飞书长连接事件处理
│   ├── feishu-api.ts           # 新增卡片相关方法
│   └── orchestrator.ts           # 新增代理请求处理逻辑
├── types/
│   └── proxy-request.ts          # 代理请求类型定义
├── utils/
│   ├── mention-parser.ts         # @提及解析工具
│   └── text-formatter.ts        # 文本截断和格式化工具
└── database/
    └── schema.ts                # 数据库表定义 (新增proxy_requests)
```

## 9. 核心API

### 9.1 ProxyRequestService

```typescript
class ProxyRequestService {
  // 创建请求
  createRequest(requestorUserId: string, targetUserId: string, message: string): Promise<ProxyRequest>

  // 处理卡片交互
  handleCardAction(event: LarkCardActionEvent): Promise<void>

  // 同意请求
  private approveRequest(request: ProxyRequest): Promise<void>

  // 拒绝请求
  private rejectRequest(request: ProxyRequest): Promise<void>

  // 取消请求
  cancelRequest(requestId: string, userId: string): Promise<void>

  // 查询请求
  getRequest(id: string): Promise<ProxyRequest | null>
  getPendingRequests(targetUserId: string): Promise<ProxyRequest[]>
  getUserRequests(requestorUserId: string): Promise<ProxyRequest[]>

  // 数据库操作
  private saveRequest(request: ProxyRequest): Promise<void>
  private updateRequestStatus(id: string, status: RequestStatus, result?: string): Promise<void>
  private updateCardStatus(request: ProxyRequest, status: RequestStatus): Promise<void>
  private notifyRequestor(request: ProxyRequest, message: string): Promise<void>

  // 文本截断 (见 11.1 Result Handling)
  private truncateResult(result: string): string
}
```

### 9.2 FeishuAPI (新增)

```typescript
class FeishuAPI {
  // 发送卡片消息
  sendCardMessage(userId: string, card: any): Promise<string>

  // 更新卡片消息
  updateCardMessage(messageId: string, card: any): Promise<void>
}
```

### 9.3 LarkEventHandler

```typescript
class LarkEventHandler {
  // 处理卡片交互事件
  handleCardAction(event: LarkCardActionEvent): Promise<any>

  // 处理其他长连接事件
  handleUrlPreviewGet(event: any): Promise<any>
  // ... 其他事件处理
}
```

## 10. 飞书长连接集成

### 10.1 连接建立

```typescript
class LarkWSClient {
  private client: any;

  constructor(appId: string, appSecret: string, eventHandler: any) {
    // 使用飞书 SDK 建立 WebSocket 长连接
    this.client = lark.ws.Client(
      appId,
      appSecret,
      { event_handler: eventHandler },
      { log_level: lark.LogLevel.INFO }
    );
  }

  start(): void {
    this.client.start();
  }

  stop(): void {
    this.client.stop();
  }
}
```

### 10.2 事件注册

```typescript
const eventHandler = lark.EventDispatcherHandler.builder("", "")
  // 注册卡片交互回调
  .register_p2_card_action_trigger(do_card_action_trigger)
  .build();
```

## 11. 🛡️ 生产环境稳健性设计

### 11.1 响应结果的"截断与格式化" (Result Handling)

**风险**: OpenClaw 智能体返回的结果有时会非常长（比如一份完整的分析报告），飞书卡片的内容区是有字数限制的。

**对策**:

```typescript
class ProxyRequestService {
  private readonly MAX_CARD_RESULT_LENGTH = 2000;

  /**
   * 截断并格式化结果
   */
  private truncateResult(result: string): string {
    if (!result || result.length <= this.MAX_CARD_RESULT_LENGTH) {
      return result;
    }

    const truncated = result.substring(0, this.MAX_CARD_RESULT_LENGTH);
    return `${truncated}...\n\n💡 *完整结果请查看私聊消息*`;
  }
}
```

**卡片显示效果**:
```
**状态**: ✅ 已执行
**结果**: 这是一份详细的分析报告，包含了多个维度的数据...
（此处被截断）

💡 *完整结果请查看私聊消息*
```

### 11.2 并发冲突处理 (Concurrency Control)

**风险**: 如果用户B 疯狂点击"同意"按钮（比如网络延迟导致他点快了），可能会触发多次 wsTunnel.sendChatMessage。

**对策**: 在 handleCardAction 的入口处增加一个**"乐观锁"**。

```typescript
class ProxyRequestService {
  private processingRequests = new Set<string>(); // 正在处理的请求ID

  async handleCardAction(event: LarkCardActionEvent): Promise<void> {
    const actionValue = event.action.value;
    const [action, requestId] = actionValue.split('_');

    // 检查并发冲突 - 如果已经在处理中，直接返回
    if (this.processingRequests.has(requestId)) {
      console.warn(`[ProxyRequest] Request ${requestId} is already being processed`);
      return {
        toast: {
          type: 'warning',
          content: '请求正在处理中，请勿重复操作',
        },
      };
    }

    // 检查数据库状态
    const request = await this.getRequest(requestId);
    if (!request || request.status !== RequestStatus.PENDING) {
      console.warn(`[ProxyRequest] Request ${requestId} not in pending state`);
      return {
        toast: {
          type: 'warning',
          content: '请求不存在或已处理',
        },
      };
    }

    // 验证操作者是否为目标用户
    if (event.operator.user_id !== request.targetUserId) {
      console.warn(`[ProxyRequest] Unauthorized action attempt by ${event.operator.user_id}`);
      return {
        toast: {
          type: 'error',
          content: '无权操作此请求',
        },
      };
    }

    // 标记为处理中（乐观锁）
    this.processingRequests.add(requestId);

    try {
      if (action === 'approve') {
        await this.approveRequest(request);
      } else if (action === 'reject') {
        await this.rejectRequest(request);
      }
    } finally {
      // 无论成功或失败，都释放锁
      this.processingRequests.delete(requestId);
    }
  }
}
```

### 11.3 审计日志与"代持"说明

**细节**: 在给用户A返回结果时，建议增加一行："本结果由 @用户B 的智能体 OpenClaw 生成，已获得本人授权。"

**意义**: 这从合规性上明确了"责任主体"，是企业级 Agent 协作的重要规范。

```typescript
private async approveRequest(request: ProxyRequest): Promise<void> {
  // ... 执行逻辑

  // 通知请求者，包含代持说明
  const message = `✅ 请求已执行\n\n` +
    `${this.truncateResult(response)}\n\n` +
    `---\n` +
    `本结果由 @${request.targetUserId} 的智能体 OpenClaw 生成，已获得本人授权。`;

  await this.notifyRequestor(request, message);
}
```

## 12. 配置项

### 12.1 环境变量 (.env)

```env
# 请求过期时间（小时）
REQUEST_EXPIRY_HOURS=24

# 请求执行超时时间（秒）
REQUEST_TIMEOUT_SECONDS=30

# 卡片结果最大显示长度
MAX_CARD_RESULT_LENGTH=2000

# 飞书应用配置
FEISHU_APP_ID=cli_a902d36ce638dcb2
FEISHU_APP_SECRET=yTaqdnaZqV6gZQA0CiuLKeSLrQDG5Mbu
FEISHU_VERIFICATION_TOKEN=ZuMW590HjIgHZgT18n3vVhMnUKGqTa0n
```

### 12.2 docker-compose.yml

```yaml
services:
  relay-server:
    # ... 现有配置
    environment:
      - REQUEST_EXPIRY_HOURS=24
      - REQUEST_TIMEOUT_SECONDS=30
      - MAX_CARD_RESULT_LENGTH=2000
```

## 13. 错误处理

| 场景 | 处理方式 |
|------|----------|
| 智能体未运行 | 拒绝请求，通知用户B和请求者A |
| 请求已过期 | 自动标记为 EXPIRED，通知用户 |
| 操作者非目标用户 | 拒绝操作，记录日志 |
| 网络超时 | 重试3次，仍失败则标记为失败 |
| 飞书API失败 | 记录日志，返回友好错误提示 |
| 并发操作冲突 | 检测到重复操作时返回警告提示 |

## 14. 安全考虑

1. **权限验证**: 只有目标用户可以审批自己的请求
2. **请求过期**: 24小时未处理自动过期
3. **防重放**: 每个请求ID只能处理一次
4. **消息过滤**: 防止用户向自己发起请求
5. **并发控制**: 乐观锁机制防止重复操作
6. **审计追踪**: 明确标注结果来源和授权关系

## 15. 实施计划

### Phase 1: 基础设施
- [ ] 数据库表创建
- [ ] 类型定义
- [ ] 环境变量配置

### Phase 2: 服务实现
- [ ] ProxyRequestService 核心逻辑
- [ ] FeishuAPI 卡片方法
- [ ] 文本截断工具

### Phase 3: 长连接集成
- [ ] LarkWSClient 实现
- [ ] 事件处理器注册
- [ ] 卡片交互处理

### Phase 4: Orchestrator 集成
- [ ] @提及解析
- [ ] 命令处理
- [ ] 完整流程联调

### Phase 5: 测试与优化
- [ ] 单元测试
- [ ] 集成测试
- [ ] 生产环境验证
