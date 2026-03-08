import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import type { SessionEndInput } from './types';
import { readStdin } from './transcript';

interface HistoryEntry {
  sessionId?: string;
  [key: string]: unknown;
}

function deriveProjectKey(projectPath: string): string {
  return projectPath.replace(/\//g, '-');
}

async function readHistoryEntries(sessionId: string): Promise<HistoryEntry[]> {
  const historyPath = path.join(os.homedir(), '.claude', 'history.jsonl');
  try {
    const raw = await fs.readFile(historyPath, 'utf-8');
    return raw
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as HistoryEntry)
      .filter((entry) => entry.sessionId === sessionId);
  } catch {
    return [];
  }
}

async function main(): Promise<void> {
  const session = JSON.parse(await readStdin()) as SessionEndInput;

  // Read transcript as raw string (preserves exact JSONL format)
  const transcript = await fs.readFile(session.transcript_path, 'utf-8');

  // Read history entries for this session
  const historyEntries = await readHistoryEntries(session.session_id);

  const projectKey = deriveProjectKey(session.cwd);

  const payload = {
    sessionId: session.session_id,
    projectPath: session.cwd,
    projectKey,
    transcript,
    historyEntries,
  };

  const response = await fetch('http://localhost:3000/upload-session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Upload failed (${response.status}): ${text}`);
  }

  const result = await response.json() as { bucket: string; sessionId: string; keys: string[] };
  console.log(`Session saved → s3://${result.bucket}/sessions/${result.sessionId}/`);
}

main().catch((err: unknown) => {
  console.error('on-session-end error:', err);
  process.exit(1);
});
