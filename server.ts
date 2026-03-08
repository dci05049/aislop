import Fastify from 'fastify';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  CreateBucketCommand,
  HeadBucketCommand,
} from '@aws-sdk/client-s3';

const BUCKET = 'claude-history';

const s3: S3Client = new S3Client({
  endpoint: 'http://localhost:9000',
  region: 'us-east-1',
  credentials: {
    accessKeyId: 'admin',
    secretAccessKey: 'password123',
  },
  forcePathStyle: true, // required for MinIO
});

async function ensureBucket(): Promise<void> {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: BUCKET }));
  } catch (err: unknown) {
    const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
    if (e.name === 'NotFound' || e.$metadata?.httpStatusCode === 404) {
      await s3.send(new CreateBucketCommand({ Bucket: BUCKET }));
      console.log(`Bucket "${BUCKET}" created.`);
    } else {
      throw err;
    }
  }
}

type ContextItem = Record<string, unknown>;
type UploadContextBody = ContextItem[];

const app: FastifyInstance = Fastify({ logger: true });

app.post<{ Body: UploadContextBody }>(
  '/upload-context',
  async (
    request: FastifyRequest<{ Body: UploadContextBody }>,
    reply: FastifyReply
  ) => {
    const body = request.body;

    if (!Array.isArray(body)) {
      return reply.code(400).send({ error: 'Request body must be a JSON array.' });
    }

    const key = `context-${Date.now()}.json`;

    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: JSON.stringify(body),
        ContentType: 'application/json',
      })
    );

    return reply.code(201).send({ bucket: BUCKET, key });
  }
);

// ── Upload session for cross-machine resume ─────────────────────────────────

interface UploadSessionBody {
  sessionId: string;
  projectPath: string;
  projectKey: string;
  transcript: string;
  historyEntries: Record<string, unknown>[];
}

app.post<{ Body: UploadSessionBody }>(
  '/upload-session',
  async (
    request: FastifyRequest<{ Body: UploadSessionBody }>,
    reply: FastifyReply
  ) => {
    const { sessionId, projectPath, projectKey, transcript, historyEntries } =
      request.body;

    if (!sessionId || !transcript) {
      return reply
        .code(400)
        .send({ error: 'sessionId and transcript are required.' });
    }

    const transcriptKey = `sessions/${sessionId}/transcript.jsonl`;
    const metadataKey = `sessions/${sessionId}/metadata.json`;

    const metadata = {
      sessionId,
      projectPath,
      projectKey,
      historyEntries,
      uploadedAt: new Date().toISOString(),
    };

    await Promise.all([
      s3.send(
        new PutObjectCommand({
          Bucket: BUCKET,
          Key: transcriptKey,
          Body: transcript,
          ContentType: 'text/plain',
        })
      ),
      s3.send(
        new PutObjectCommand({
          Bucket: BUCKET,
          Key: metadataKey,
          Body: JSON.stringify(metadata, null, 2),
          ContentType: 'application/json',
        })
      ),
    ]);

    return reply.code(201).send({
      bucket: BUCKET,
      sessionId,
      keys: [transcriptKey, metadataKey],
    });
  }
);

// ── Pull endpoints for cross-machine resume ─────────────────────────────────

async function streamToString(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf-8');
}

interface SessionSummary {
  sessionId: string;
  projectPath: string;
  projectKey: string;
  uploadedAt: string;
  preview: string;
}

app.get('/sessions', async (_request: FastifyRequest, reply: FastifyReply) => {
  const listResult = await s3.send(
    new ListObjectsV2Command({
      Bucket: BUCKET,
      Prefix: 'sessions/',
      Delimiter: '/',
    })
  );

  const prefixes = listResult.CommonPrefixes ?? [];
  const sessions: SessionSummary[] = [];

  for (const prefix of prefixes) {
    const sessionId = prefix.Prefix!.replace('sessions/', '').replace('/', '');
    try {
      const metaResult = await s3.send(
        new GetObjectCommand({
          Bucket: BUCKET,
          Key: `sessions/${sessionId}/metadata.json`,
        })
      );
      const meta = JSON.parse(
        await streamToString(metaResult.Body as NodeJS.ReadableStream)
      );
      const firstEntry = meta.historyEntries?.[0];
      sessions.push({
        sessionId: meta.sessionId,
        projectPath: meta.projectPath,
        projectKey: meta.projectKey,
        uploadedAt: meta.uploadedAt,
        preview: firstEntry?.display?.slice(0, 100) ?? '',
      });
    } catch {
      sessions.push({ sessionId, projectPath: '', projectKey: '', uploadedAt: '', preview: '' });
    }
  }

  return reply.send(sessions);
});

app.get<{ Params: { id: string } }>(
  '/sessions/:id',
  async (
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply
  ) => {
    const { id } = request.params;

    const [metaResult, transcriptResult] = await Promise.all([
      s3.send(
        new GetObjectCommand({
          Bucket: BUCKET,
          Key: `sessions/${id}/metadata.json`,
        })
      ),
      s3.send(
        new GetObjectCommand({
          Bucket: BUCKET,
          Key: `sessions/${id}/transcript.jsonl`,
        })
      ),
    ]);

    const metadata = JSON.parse(
      await streamToString(metaResult.Body as NodeJS.ReadableStream)
    );
    const transcript = await streamToString(
      transcriptResult.Body as NodeJS.ReadableStream
    );

    return reply.send({ metadata, transcript });
  }
);

async function start(): Promise<void> {
  await ensureBucket();
  await app.listen({ port: 3000, host: '0.0.0.0' });
}

start().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
