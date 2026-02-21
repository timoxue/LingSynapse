// src/utils/text-utils.ts

const MAX_CARD_RESULT_LENGTH = 2000;

/**
 * Truncate result text for card display
 */
export function truncateResult(result: string): string {
  if (!result || result.length <= MAX_CARD_RESULT_LENGTH) {
    return result;
  }

  const truncated = result.substring(0, MAX_CARD_RESULT_LENGTH);
  return `${truncated}...\n\n💡 *完整结果请查看私聊消息*`;
}

/**
 * Parse @mentions from message text
 * Format: @userId or @user_name
 */
export function parseMentions(text: string): string[] {
  const mentionRegex = /@([a-zA-Z0-9_-]+)/g;
  const matches: string[] = [];
  let match;

  while ((match = mentionRegex.exec(text)) !== null) {
    matches.push(match[1]);
  }

  return matches;
}

/**
 * Extract command and message from text
 * Format: @user !command message
 */
export function parseProxyCommand(text: string): {
  targetUser: string | null;
  command: string | null;
  message: string;
} {
  const trimmed = text.trim();

  // Check for @mention followed by command
  const mentionMatch = trimmed.match(/^@(\S+)\s+(\S+)\s*(.*)$/);
  if (mentionMatch) {
    return {
      targetUser: mentionMatch[1],
      command: mentionMatch[2].replace(/^!/, ''),
      message: mentionMatch[3] || '',
    };
  }

  return { targetUser: null, command: null, message: trimmed };
}
