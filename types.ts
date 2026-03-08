export interface SessionEndInput {
  session_id: string;
  transcript_path: string;
  cwd: string;
  permission_mode: 'default' | 'plan' | 'acceptEdits' | 'dontAsk' | 'bypassPermissions';
  hook_event_name: 'SessionEnd';
  reason: 'clear' | 'logout' | 'prompt_input_exit' | 'bypass_permissions_disabled' | 'other';
}

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string; signature: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: unknown };

export interface UserMessage {
  role: 'user';
  content: string | ContentBlock[];
}

export interface AssistantMessage {
  model: string;
  id: string;
  type: 'message';
  role: 'assistant';
  content: ContentBlock[];
}

export interface BaseEntry {
  parentUuid: string | null;
  isSidechain: boolean;
  userType: string;
  cwd: string;
  sessionId: string;
  version: string;
  gitBranch: string;
  uuid: string;
  timestamp: string;
  permissionMode: string;
}

export interface UserEntry extends BaseEntry {
  type: 'user';
  message: UserMessage;
}

export interface AssistantEntry extends BaseEntry {
  type: 'assistant';
  message: AssistantMessage;
}

export interface FileHistorySnapshot {
  type: 'file-history-snapshot';
  messageId: string;
  snapshot: {
    messageId: string;
    trackedFileBackups: Record<string, unknown>;
    timestamp: string;
  };
  isSnapshotUpdate: boolean;
}

export type TranscriptEntry = UserEntry | AssistantEntry | FileHistorySnapshot;
