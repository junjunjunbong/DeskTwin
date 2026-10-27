import 'dotenv/config';
import { createServer } from 'node:http';
const server = createServer((req, res) => {
  if (req.url === '/api/health' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ mode: 'demo', model: null }));
  } else { res.writeHead(404); res.end(); }
});
server.listen(Number(process.env.PORT ?? 4318), '127.0.0.1', () => console.log('DeskTwin API: http://127.0.0.1:4318 · offline demo'));
