import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

export interface ModelChoice {
  name: string;
  apiKeyEnv: string;
  model: string;
  providerName: string;
  reasoning: boolean;
  contextWindow: number;
  maxTokens: number;
}

const MODEL_CONFIGS: Record<string, ModelChoice> = {
  'glm-4.7': {
    name: 'GLM-4.7',
    apiKeyEnv: 'ZHIPU_API_KEY_GLM4',
    model: 'glm-4.7',
    providerName: 'zhipu',
    reasoning: false,
    contextWindow: 131072,
    maxTokens: 4096
  },
  'glm-5': {
    name: 'GLM-5',
    apiKeyEnv: 'ZHIPU_API_KEY_GLM5',
    model: 'glm-5',
    providerName: 'zhipu',
    reasoning: true,
    contextWindow: 1048576,
    maxTokens: 8192
  }
};

export interface OpenClawConfig {
  meta?: {
    lastTouchedVersion?: string;
    lastTouchedAt?: string;
  };
  models?: {
    mode?: 'merge' | 'replace';
    providers?: Record<string, {
      baseUrl: string;
      apiKey: string;
      api?: string;
      models: Array<{
        id: string;
        name: string;
        api?: string;
        reasoning: boolean;
        input: Array<'text' | 'image'>;
        cost: {
          input: number;
          output: number;
          cacheRead: number;
          cacheWrite: number;
        };
        contextWindow: number;
        maxTokens: number;
      }>;
    }>;
  };
  agents?: {
    defaults?: {
      sandbox?: {
        mode: string;
        scope: string;
      };
    };
  };
}

/**
 * Generate OpenClaw config for a specific model
 */
export function generateOpenClawConfig(
  userId: string,
  modelChoice: string = 'glm-4.7'
): OpenClawConfig {
  const config = MODEL_CONFIGS[modelChoice];
  if (!config) {
    throw new Error(`Invalid model choice: ${modelChoice}`);
  }

  const apiKey = process.env[config.apiKeyEnv];
  if (!apiKey) {
    throw new Error(`API key not found for ${config.apiKeyEnv}. Please set ${config.apiKeyEnv} in .env file.`);
  }

  return {
    meta: {
      lastTouchedVersion: '1.0.0',
      lastTouchedAt: new Date().toISOString()
    },
    models: {
      mode: 'merge',
      providers: {
        [config.providerName]: {
          baseUrl: 'https://open.bigmodel.cn/api/paas/v4/', // Keep trailing slash
          apiKey: apiKey,
          api: 'openai-completions',
          models: [
            {
              id: config.model,
              name: config.name,
              api: 'openai-completions',
              reasoning: config.reasoning,
              input: ['text'],
              cost: {
                input: 0,
                output: 0,
                cacheRead: 0,
                cacheWrite: 0
              },
              contextWindow: config.contextWindow,
              maxTokens: config.maxTokens
            }
          ]
        }
      }
    },
    agents: {
      defaults: {
        sandbox: {
          mode: 'all',
          scope: 'session'
        }
      }
    }
  };
}

/**
 * Write OpenClaw config to file
 */
export function writeOpenClawConfig(
  userId: string,
  config: OpenClawConfig,
  basePath: string
): string {
  // Config should be placed at basePath/../userId/openclaw.json
  // where basePath is the storage path (e.g., /Users/timo/openclaw/sandboxes/{userId}/storage)
  // So the config path is /Users/timo/openclaw/sandboxes/{userId}/openclaw.json
  const userBasePath = path.join(basePath, '..', userId);
  const configPath = path.join(userBasePath, 'openclaw.json');

  // Ensure directory exists
  const configDir = path.dirname(configPath);
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }

  // Write config file
  fs.writeFileSync(
    configPath,
    JSON.stringify(config, null, 2),
    'utf-8'
  );

  return configPath;
}

/**
 * Get available model choices
 */
export function getAvailableModels(): string[] {
  return Object.keys(MODEL_CONFIGS);
}

/**
 * Get model info
 */
export function getModelInfo(modelChoice: string): ModelChoice | null {
  return MODEL_CONFIGS[modelChoice] || null;
}
