import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

const SERVER = 'http://localhost:3000';

interface SessionSummary {
  sessionId: string;
  projectPath: string;
  projectKey: string;
  uploadedAt: string;
  preview: string;
}

interface SessionMetadata {
  sessionId: string;
  projectPath: string;
  projectKey: string;
  historyEntries: Record<string, unknown>[];
  uploadedAt: string;
}

interface SessionData {
  metadata: SessionMetadata;
  transcript: string;
}

async function listSessions(): Promise<SessionSummary[]> {
  const res = await fetch(`${SERVER}/sessions`);
  if (!res.ok) throw new Error(`Failed to list sessions: ${res.status}`);
  return res.json() as Promise<SessionSummary[]>;
}

async function downloadSession(sessionId: string): Promise<SessionData> {
  const res = await fetch(`${SERVER}/sessions/${sessionId}`);
  if (!res.ok) throw new Error(`Failed to download session ${sessionId}: ${res.status}`);
  return res.json() as Promise<SessionData>;
}

async function restoreSession(data: SessionData): Promise<void> {
  const { metadata, transcript } = data;
  const claudeDir = path.join(os.homedir(), '.claude');
  const projectDir = path.join(claudeDir, 'projects', metadata.projectKey);
  const transcriptPath = path.join(projectDir, `${metadata.sessionId}.jsonl`);
  const historyPath = path.join(claudeDir, 'history.jsonl');

  // Create project directory
  await fs.mkdir(projectDir, { recursive: true });

  // Write transcript
  await fs.writeFile(transcriptPath, transcript, 'utf-8');
  console.log(`Transcript written → ${transcriptPath}`);

  // Append history entries
  const historyLines = metadata.historyEntries
    .map((entry) => JSON.stringify(entry))
    .join('\n');
  await fs.appendFile(historyPath, historyLines + '\n', 'utf-8');
  console.log(`History entries appended → ${historyPath}`);
}

async function main(): Promise<void> {
  const sessionId = process.argv[2];

  if (sessionId) {
    // Direct restore by session ID
    console.log(`Downloading session ${sessionId}...`);
    const data = await downloadSession(sessionId);
    await restoreSession(data);
    console.log(`\nSession restored. Run \`claude --resume\` to continue.`);
    return;
  }

  // List available sessions, filter out already-pulled ones
  const allSessions = await listSessions();
  const claudeDir = path.join(os.homedir(), '.claude');

  const sessions: SessionSummary[] = [];
  for (const s of allSessions) {
    if (!s.projectKey) {
      sessions.push(s);
      continue;
    }
    const localPath = path.join(claudeDir, 'projects', s.projectKey, `${s.sessionId}.jsonl`);
    try {
      await fs.access(localPath);
      // File exists — already pulled, skip
    } catch {
      sessions.push(s);
    }
  }

  if (sessions.length === 0) {
    console.log('No new sessions to pull.');
    return;
  }

  console.log('Available sessions:\n');
  sessions.forEach((s, i) => {
    console.log(`  [${i + 1}] ${s.sessionId}`);
    console.log(`      Project: ${s.projectPath}`);
    console.log(`      Uploaded: ${s.uploadedAt}`);
    console.log(`      Preview: ${s.preview}`);
    console.log();
  });

  // Read selection from stdin
  process.stdout.write('Enter session number: ');
  const input = await new Promise<string>((resolve) => {
    process.stdin.setEncoding('utf-8');
    process.stdin.once('data', (chunk: string) => resolve(chunk.trim()));
  });

  const index = parseInt(input, 10) - 1;
  if (isNaN(index) || index < 0 || index >= sessions.length) {
    console.error('Invalid selection.');
    process.exit(1);
  }

  const selected = sessions[index]!;
  console.log(`\nDownloading session ${selected.sessionId}...`);
  const data = await downloadSession(selected.sessionId);
  await restoreSession(data);
  console.log(`\nSession restored. Run \`claude --resume\` to continue.`);
}

main().catch((err: unknown) => {
  console.error('pull-session error:', err);
  process.exit(1);
});
