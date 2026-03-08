import * as fs from 'fs/promises';
import type { TranscriptEntry } from './types';

export async function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk: string) => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
  });
}

export async function parseTranscript(transcriptPath: string): Promise<TranscriptEntry[]> {
  const raw = await fs.readFile(transcriptPath, 'utf-8');
  return raw
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as TranscriptEntry);
}
