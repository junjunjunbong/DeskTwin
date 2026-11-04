import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { z } from 'zod';
import { IdSchema, WorkspaceSchema } from '../src/domain/workspace';
import { PhotoSelectionSchema } from '../src/domain/sceneProposal';
import { demoReply } from '../src/domain/demoAssistant';
import {
  ApiError,
  callMeta,
  callMetaPhotoObjects,
  callMetaScene,
  HistorySchema,
  type MetaConfig,
} from './meta';
import { HardwareRequestError, HardwareService } from './hardware';

const ChatRequest = z.object({
  message: z.string().trim().min(1).max(2000),
  workspace: WorkspaceSchema,
  history: HistorySchema.default([]),
  focusDeviceId: IdSchema.nullable().optional(),
  consent: z.literal(true).optional(),
});
const PhotoObjectsRequest = z.object({
  image: z
    .string()
    .max(1_900_000)
    .regex(/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/),
  consent: z.literal(true),
  workspace: WorkspaceSchema,
  context: z.string().trim().max(2000).optional(),
});
const PhotoRequest = PhotoObjectsRequest.extend({
  selection: PhotoSelectionSchema.optional(),
});
interface ServerConfig extends MetaConfig {
  productionRoot?: string;
  requestsPerMinute?: number;
  hardware?: HardwareService;
  photoTwoStage?: boolean;
}
const loopback = new Set(['127.0.0.1', 'localhost', '[::1]']);

export function isAllowedRequest(req: IncomingMessage) {
  const host = req.headers.host;
  if (!host) return false;
  try {
    const target = new URL(`http://${host}`);
    if (!loopback.has(target.hostname) || target.host !== host) return false;
    const origin = req.headers.origin;
    if (origin) {
      const url = new URL(origin);
      if (!loopback.has(url.hostname) || !['http:', 'https:'].includes(url.protocol)) return false;
      // Vite proxy preserves frontend Host; production is same-origin too.
      if (url.host !== target.host || url.origin !== origin) return false;
    }
    if (req.headers['sec-fetch-site'] === 'cross-site') return false;
    return true;
  } catch {
    return false;
  }
}
function json(res: ServerResponse, status: number, value: unknown) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  });
  res.end(JSON.stringify(value));
}
async function readJSON(req: IncomingMessage): Promise<unknown> {
  if (!req.headers['content-type']?.toLowerCase().startsWith('application/json'))
    throw new ApiError(415, 'Only application/json requests are supported.');
  // Bounded 128-part shapes can exceed the old 16-part workspace budget.
  const limit = 8_000_000;
  if (Number(req.headers['content-length'] || 0) > limit) {
    req.resume();
    throw new ApiError(413, 'The request is too large. Reduce the image size.');
  }
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > limit) throw new ApiError(413, 'The request is too large.');
    chunks.push(Buffer.from(chunk));
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new ApiError(400, 'The request is not valid JSON.');
  }
}
async function serveStatic(req: IncomingMessage, res: ServerResponse, root: string) {
  if (!['GET', 'HEAD'].includes(req.method || '')) {
    json(res, 405, { error: 'Unsupported request method.' });
    return;
  }
  const pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname);
  const file = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
  const realRoot = await realpath(root);
  if (!(file === realRoot || file.startsWith(realRoot + sep)))
    throw new ApiError(403, 'This path is not allowed.');
  let path = file;
  try {
    const info = await stat(path);
    if (!info.isFile()) throw new Error('Not a file');
  } catch {
    if (extname(pathname)) {
      json(res, 404, { error: 'File not found.' });
      return;
    }
    path = resolve(realRoot, 'index.html');
  }
  const realFile = await realpath(path);
  if (!realFile.startsWith(realRoot + sep)) throw new ApiError(403, 'This file is not allowed.');
  const types: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.woff2': 'font/woff2',
    '.json': 'application/json',
  };
  const data = await readFile(realFile);
  res.writeHead(200, {
    'Content-Type': types[extname(realFile)] || 'application/octet-stream',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': extname(realFile) === '.html' ? 'no-cache' : 'public, max-age=3600',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy':
      "default-src 'self'; script-src 'self'; worker-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  });
  res.end(req.method === 'HEAD' ? undefined : data);
}

export function createApp(config: ServerConfig) {
  const hardware = config.hardware ?? new HardwareService();
  let windowStart = Date.now();
  let requests = 0;
  let active = 0;
  async function providerRequest(
    req: IncomingMessage,
    res: ServerResponse,
    run: (signal: AbortSignal) => Promise<unknown>,
  ) {
    // Acquire after body parsing too: several uploads may finish in the same event-loop turn.
    if (active >= 2)
      throw new ApiError(429, 'Requests are already in progress. Please wait for them to finish.');
    const controller = new AbortController();
    const disconnect = () => {
      if (!res.writableEnded)
        controller.abort(new DOMException('The client disconnected.', 'AbortError'));
    };
    // IncomingMessage.close also fires when a normal request body ends; it is not cancellation.
    req.once('aborted', disconnect);
    res.once('close', disconnect);
    if (req.aborted || res.destroyed) disconnect();
    active++;
    try {
      const result = await run(controller.signal);
      if (!controller.signal.aborted && !res.destroyed) json(res, 200, result);
    } finally {
      active--;
      req.removeListener('aborted', disconnect);
      res.removeListener('close', disconnect);
    }
  }
  const server = createServer(async (req, res) => {
    try {
      if (!isAllowedRequest(req)) {
        json(res, 403, { error: 'Only local same-origin requests are allowed.' });
        return;
      }
      const path = new URL(req.url || '/', 'http://localhost').pathname;
      if (path === '/api/health' && req.method === 'GET') {
        json(res, 200, {
          mode: config.apiKey ? 'meta' : 'demo',
          model: config.apiKey ? config.model : null,
          photoAvailable: !!config.apiKey,
          photoTwoStage: config.photoTwoStage === true,
        });
        return;
      }
      if (path.startsWith('/api/hardware/')) {
        // A cross-origin page cannot add this header without a preflight, which
        // this same-origin API never permits. Tokens additionally isolate tabs.
        if (req.headers['x-desktwin-hardware'] !== '1')
          throw new ApiError(403, 'Use the DeskTwin hardware panel to access local detection.');
        const origin = req.headers.origin ?? new URL(`http://${req.headers.host}`).origin;
        if (path === '/api/hardware/session' && req.method === 'GET') {
          json(res, 200, await hardware.createSession(origin));
          return;
        }
        const token = req.headers['x-desktwin-hardware-token'];
        if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token))
          throw new ApiError(403, 'A local hardware session is required.');
        if (path === '/api/hardware/snapshot' && req.method === 'GET') {
          json(res, 200, await hardware.snapshot(token, origin));
          return;
        }
        if (path === '/api/hardware/start' && req.method === 'POST') {
          z.strictObject({ consent: z.literal(true) }).parse(await readJSON(req));
          json(res, 200, await hardware.start(token, origin));
          return;
        }
        if (path === '/api/hardware/stop' && req.method === 'POST') {
          z.strictObject({}).parse(await readJSON(req));
          json(res, 200, hardware.stop(token, origin));
          return;
        }
        throw new ApiError(405, 'Unsupported hardware endpoint or request method.');
      }
      if (!path.startsWith('/api/')) {
        if (config.productionRoot) await serveStatic(req, res, config.productionRoot);
        else json(res, 404, { error: 'The development UI uses port 5173.' });
        return;
      }
      if (!['/api/chat', '/api/photo', '/api/photo/objects'].includes(path)) {
        json(res, 404, { error: 'This API endpoint is not supported.' });
        return;
      }
      if (req.method !== 'POST') {
        json(res, 405, { error: 'Only POST requests are supported.' });
        return;
      }
      if (Date.now() - windowStart >= 60_000) {
        windowStart = Date.now();
        requests = 0;
      }
      if (++requests > (config.requestsPerMinute ?? 20))
        throw new ApiError(
          429,
          'The local request limit has been reached. Please try again shortly.',
        );
      const body = await readJSON(req);
      if (path === '/api/chat') {
        const data = ChatRequest.parse(body);
        if (
          data.focusDeviceId &&
          !data.workspace.devices.some((device) => device.id === data.focusDeviceId)
        )
          throw new ApiError(
            400,
            'The conversation target is no longer in this workspace. Choose a current device.',
          );
        if (!config.apiKey) {
          json(res, 200, demoReply(data.message, data.workspace, data.focusDeviceId));
          return;
        }
        if (!data.consent)
          throw new ApiError(400, 'Your consent is required before sending data to Meta.');
        await providerRequest(req, res, (signal) =>
          callMeta(config, data.workspace, {
            message: data.message,
            history: data.history,
            focusDeviceId: data.focusDeviceId,
            signal,
          }),
        );
      } else if (path === '/api/photo/objects') {
        const data = PhotoObjectsRequest.parse(body);
        if (!config.apiKey)
          throw new ApiError(
            503,
            'Photo analysis requires a Meta API key. You can add devices manually.',
          );
        await providerRequest(req, res, (signal) =>
          callMetaPhotoObjects(config, data.workspace, {
            image: data.image,
            context: data.context,
            signal,
          }),
        );
      } else {
        const data = PhotoRequest.parse(body);
        if (!config.apiKey)
          throw new ApiError(
            503,
            'Photo analysis requires a Meta API key. You can add devices manually.',
          );
        await providerRequest(req, res, (signal) =>
          callMetaScene(config, data.workspace, {
            image: data.image,
            context: data.context,
            selection: data.selection,
            signal,
          }),
        );
      }
    } catch (error) {
      if (res.headersSent || res.destroyed) return;
      if (error instanceof ApiError || error instanceof HardwareRequestError)
        json(res, error.status, { error: error.message });
      else if (error instanceof z.ZodError)
        json(res, 400, { error: 'The input format or workspace configuration is invalid.' });
      else
        json(res, 500, {
          error: 'An error occurred while processing the request. Your workspace was not changed.',
        });
      // Do not log request bodies, images, keys, upstream bodies or device details.
    }
  });
  server.requestTimeout = 45000;
  server.headersTimeout = 10000;
  server.on('close', () => hardware.close());
  return server;
}
