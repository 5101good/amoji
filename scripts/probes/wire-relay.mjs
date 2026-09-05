// Development-only observation relay. Never writes headers, credentials, or raw prompts.
import { createServer } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { gunzipSync } from 'node:zlib';
import { appendFileSync } from 'node:fs';

export async function startRelay(evidenceFile) {
  const server = createServer(async (req, res) => {
    if (req.url !== '/responses' || req.method !== 'POST') { res.writeHead(404).end(); return; }
    const chunks = [];
    let length = 0;
    for await (const chunk of req) {
      length += chunk.length;
      if (length > 8 * 1024 * 1024) { res.writeHead(413).end(); return; }
      chunks.push(chunk);
    }
    const bytes = Buffer.concat(chunks);
    const record = { at: new Date().toISOString(), bytes: bytes.length, parsed: false, inputImageParts: 0, imageDataUrls: 0, amojiToolCalls: [], amojiToolResults: 0, types: {} };
    try {
      const decoded = req.headers['content-encoding'] === 'gzip' ? gunzipSync(bytes) : bytes;
      const body = JSON.parse(decoded.toString('utf8'));
      record.parsed = true;
      record.model = body.model;
      function visit(value) {
        if (typeof value === 'string') {
          if (/^data:image\//i.test(value)) record.imageDataUrls++;
          if (value.includes('"selection_token"') && value.includes('"candidates"')) record.amojiToolResults++;
          return;
        }
        if (!value || typeof value !== 'object') return;
        if (typeof value.type === 'string') {
          record.types[value.type] = (record.types[value.type] ?? 0) + 1;
          if (['input_image', 'image', 'image_url'].includes(value.type)) record.inputImageParts++;
        }
        if (typeof value.name === 'string' && value.name.includes('amoji')) record.amojiToolCalls.push(value.name);
        for (const child of Object.values(value)) visit(child);
      }
      visit(body.input);
    } catch { record.parseError = 'unreadable request'; }
    appendFileSync(evidenceFile, JSON.stringify(record) + '\n', { mode: 0o600 });
    const upstream = httpsRequest('https://chatgpt.com/backend-api/codex/responses', {
      method: 'POST', headers: { ...req.headers, host: 'chatgpt.com' }, timeout: 90000,
    }, response => {
      res.writeHead(response.statusCode ?? 502, response.headers);
      response.pipe(res);
    });
    upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
    upstream.on('timeout', () => upstream.destroy());
    res.on('close', () => upstream.destroy());
    upstream.end(bytes);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(resolve => server.close(resolve)) };
}
