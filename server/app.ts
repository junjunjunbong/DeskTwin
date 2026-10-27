import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { z } from 'zod';
import { WorkspaceSchema } from '../src/domain/workspace';
import { demoReply } from '../src/domain/demoAssistant';
import { ApiError, callMeta, HistorySchema, type MetaConfig } from './meta';

const ChatRequest = z.object({ message: z.string().trim().min(1).max(2000), workspace: WorkspaceSchema, history: HistorySchema.default([]), consent: z.literal(true).optional() });
const PhotoRequest = z.object({ image: z.string().max(1_900_000).regex(/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/), consent: z.literal(true), workspace: WorkspaceSchema });
interface ServerConfig extends MetaConfig { productionRoot?: string; requestsPerMinute?: number; }
const loopback = new Set(['127.0.0.1', 'localhost', '[::1]']);

export function isAllowedRequest(req: IncomingMessage) {
  const host = req.headers.host;
  if (!host) return false;
  try {
    const target = new URL(`http://${host}`);
    if (!loopback.has(target.hostname)) return false;
    const origin = req.headers.origin;
    if (origin) {
      const url = new URL(origin);
      if (!loopback.has(url.hostname) || !['http:', 'https:'].includes(url.protocol)) return false;
      // Vite proxy preserves frontend Host; production is same-origin too.
      if (url.host !== target.host) return false;
    }
    if (req.headers['sec-fetch-site'] === 'cross-site') return false;
    return true;
  } catch { return false; }
}
function json(res: ServerResponse, status: number, value: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' }); res.end(JSON.stringify(value));
}
async function readJSON(req: IncomingMessage): Promise<unknown> {
  if (!req.headers['content-type']?.toLowerCase().startsWith('application/json')) throw new ApiError(415, 'application/json 요청만 지원합니다.');
  const limit = 2_100_000;
  if (Number(req.headers['content-length'] || 0) > limit) { req.resume(); throw new ApiError(413, '요청이 너무 큽니다. 사진 크기를 줄여 주세요.'); }
  const chunks: Buffer[] = []; let bytes = 0;
  for await (const chunk of req) { bytes += chunk.length; if (bytes > limit) throw new ApiError(413, '요청이 너무 큽니다.'); chunks.push(Buffer.from(chunk)); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new ApiError(400, '유효한 JSON 요청이 아닙니다.'); }
}
async function serveStatic(req: IncomingMessage, res: ServerResponse, root: string) {
  if (!['GET', 'HEAD'].includes(req.method || '')) { json(res, 405, { error: '지원하지 않는 요청 방식입니다.' }); return; }
  const pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname);
  const file = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
  const realRoot = await realpath(root);
  if (!(file === realRoot || file.startsWith(realRoot + sep))) throw new ApiError(403, '허용되지 않은 경로입니다.');
  let path = file;
  try { const info = await stat(path); if (!info.isFile()) throw new Error('Not a file'); }
  catch { if (extname(pathname)) { json(res, 404, { error: '파일이 없습니다.' }); return; } path = resolve(realRoot, 'index.html'); }
  const realFile = await realpath(path);
  if (!realFile.startsWith(realRoot + sep)) throw new ApiError(403, '허용되지 않은 파일입니다.');
  const types: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json' };
  const data = await readFile(realFile);
  res.writeHead(200, { 'Content-Type': types[extname(realFile)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': extname(realFile) === '.html' ? 'no-cache' : 'public, max-age=3600', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'", 'Permissions-Policy': 'camera=(), microphone=(), geolocation=()' });
  res.end(req.method === 'HEAD' ? undefined : data);
}

export function createApp(config: ServerConfig) {
  let windowStart = Date.now(); let requests = 0; let active = 0;
  const server = createServer(async (req, res) => {
    try {
      if (!isAllowedRequest(req)) { json(res, 403, { error: '로컬 동일 출처 요청만 허용합니다.' }); return; }
      const path = new URL(req.url || '/', 'http://localhost').pathname;
      if (path === '/api/health' && req.method === 'GET') { json(res, 200, { mode: config.apiKey ? 'meta' : 'demo', model: config.apiKey ? config.model : null, photoAvailable: !!config.apiKey }); return; }
      if (!path.startsWith('/api/')) {
        if (config.productionRoot) await serveStatic(req, res, config.productionRoot);
        else json(res, 404, { error: '개발 UI는 5173 포트를 사용합니다.' });
        return;
      }
      if (!['/api/chat', '/api/photo'].includes(path)) { json(res, 404, { error: '지원하지 않는 API입니다.' }); return; }
      if (req.method !== 'POST') { json(res, 405, { error: 'POST 요청만 지원합니다.' }); return; }
      if (Date.now() - windowStart >= 60_000) { windowStart = Date.now(); requests = 0; }
      if (++requests > (config.requestsPerMinute ?? 20)) throw new ApiError(429, '로컬 요청 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.');
      if (active >= 2) throw new ApiError(429, '이미 요청을 처리 중입니다. 진행 중인 요청을 먼저 완료해 주세요.');
      const body = await readJSON(req);
      if (path === '/api/chat') {
        const data = ChatRequest.parse(body);
        if (!config.apiKey) { json(res, 200, demoReply(data.message, data.workspace)); return; }
        if (!data.consent) throw new ApiError(400, 'Meta 전송에 대한 사용자 동의가 필요합니다.');
        active++;
        try { json(res, 200, await callMeta(config, data.workspace, { message: data.message, history: data.history })); } finally { active--; }
      } else {
        const data = PhotoRequest.parse(body);
        if (!config.apiKey) throw new ApiError(503, '사진 AI 분석에는 Meta API 키가 필요합니다. 직접 기기를 추가할 수 있습니다.');
        active++;
        try { json(res, 200, await callMeta(config, data.workspace, { message: '사진에서 확인되는 기기와 배치만 분석해 주세요.', image: data.image })); } finally { active--; }
      }
    } catch (error) {
      if (res.headersSent || res.destroyed) return;
      if (error instanceof ApiError) json(res, error.status, { error: error.message });
      else if (error instanceof z.ZodError) json(res, 400, { error: '입력 형식이나 기기 구성이 올바르지 않습니다.' });
      else json(res, 500, { error: '요청 처리 중 오류가 발생했습니다. 구성은 자동으로 변경하지 않았습니다.' });
      // Do not log request bodies, images, keys, upstream bodies or device details.
    }
  });
  server.requestTimeout = 45000; server.headersTimeout = 10000;
  return server;
}
