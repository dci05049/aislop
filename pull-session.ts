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

function deriveProjectKey(projectPath: string): string {
  return projectPath.replace(/\//g, '-');
}

function remapPaths(content: string, oldProjectPath: string, newProjectPath: string): string {
  if (oldProjectPath === newProjectPath) return content;
  // Replace all occurrences of the old project path with the new one
  return content.split(oldProjectPath).join(newProjectPath);
}

async function restoreSession(data: SessionData): Promise<void> {
  const { metadata, transcript } = data;
  const claudeDir = path.join(os.homedir(), '.claude');

  // Use the local CWD to derive the project key so Claude Code can find the session
  const localProjectPath = process.cwd();
  const localProjectKey = deriveProjectKey(localProjectPath);
  const remoteProjectPath = metadata.projectPath;

  const projectDir = path.join(claudeDir, 'projects', localProjectKey);
  const transcriptPath = path.join(projectDir, `${metadata.sessionId}.jsonl`);
  const historyPath = path.join(claudeDir, 'history.jsonl');

  // Create project directory and session-env directory
  const sessionEnvDir = path.join(claudeDir, 'session-env', metadata.sessionId);
  await Promise.all([
    fs.mkdir(projectDir, { recursive: true }),
    fs.mkdir(sessionEnvDir, { recursive: true }),
  ]);

  // Remap paths in transcript from the remote user's paths to local paths
  const remappedTranscript = remapPaths(transcript, remoteProjectPath, localProjectPath);
  await fs.writeFile(transcriptPath, remappedTranscript, { encoding: 'utf-8', mode: 0o600 });
  console.log(`Transcript written → ${transcriptPath}`);

  if (remoteProjectPath !== localProjectPath) {
    console.log(`  (remapped paths: ${remoteProjectPath} → ${localProjectPath})`);
  }

  // Remap paths in history entries and append
  const historyLines = metadata.historyEntries
    .map((entry) => remapPaths(JSON.stringify(entry), remoteProjectPath, localProjectPath))
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
  const localProjectKey = deriveProjectKey(process.cwd());

  const sessions: SessionSummary[] = [];
  for (const s of allSessions) {
    if (!s.projectKey) {
      sessions.push(s);
      continue;
    }
    // Check under the local project key (where we'd restore to), not the remote one
    const localPath = path.join(claudeDir, 'projects', localProjectKey, `${s.sessionId}.jsonl`);
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
