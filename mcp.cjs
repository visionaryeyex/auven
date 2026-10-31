const {randomUUID} = require('node:crypto');

const protocolVersion = '2025-11-25';
const tool = {
  name: 'auven_chat',
  description: 'Send one OpenAI chat request through the AUVEN gateway. AUVEN checks this agent credential, active status, and daily limit, then records the decision in Activity. This tool does not control calls the host agent makes outside AUVEN.',
  inputSchema: {
    type: 'object',
    properties: {
      prompt: {type: 'string', description: 'The prompt to send through AUVEN.'},
      max_tokens: {type: 'integer', minimum: 1, maximum: 4096, default: 256, description: 'Maximum response tokens (1-4096).'}
    },
    required: ['prompt'],
    additionalProperties: false
  }
};

function reply(res, status, data) {
  res.writeHead(status, {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store'});
  res.end(JSON.stringify(data));
}
function rpc(res, id, result) { return reply(res, 200, {jsonrpc: '2.0', id, result}); }
function error(res, id, code, message, status = 200) {
  return reply(res, status, {jsonrpc: '2.0', id, error: {code, message}});
}
async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  let raw = '';
  for await (const part of req) {
    raw += part;
    if (raw.length > 20000) throw Error('request_too_large');
  }
  return JSON.parse(raw);
}
async function handle(req, res, {db, callGateway}) {
  if (req.headers.origin) return reply(res, 403, {error: 'origin_not_allowed'});
  if (req.method === 'GET') return reply(res, 405, {error: 'sse_not_supported'});
  if (req.method !== 'POST') return reply(res, 405, {error: 'method_not_allowed'});
  const credential = (req.headers.authorization || '').replace(/^Bearer /i, '');
  const agent = credential && await db.agentByToken(credential);
  if (!agent) return reply(res, 401, {error: 'invalid_agent_credential'});
  if (!String(req.headers['content-type'] || '').toLowerCase().includes('application/json')) return reply(res, 415, {error: 'json_required'});
  let message;
  try { message = await readBody(req); }
  catch { return error(res, null, -32700, 'Invalid JSON', 400); }
  if (!message || Array.isArray(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string') return error(res, message?.id ?? null, -32600, 'Invalid request', 400);
  if (!Object.hasOwn(message, 'id')) { res.writeHead(202, {'cache-control': 'no-store'}); return res.end(); }
  const id = message.id;
  if (message.method === 'initialize') return rpc(res, id, {protocolVersion, capabilities: {tools: {}}, serverInfo: {name: 'auven', version: '1.0.0'}});
  if (message.method === 'ping') return rpc(res, id, {});
  if (message.method === 'tools/list') return rpc(res, id, {tools: [tool]});
  if (message.method !== 'tools/call') return error(res, id, -32601, 'Method not found');
  if (message.params?.name !== tool.name) return error(res, id, -32602, 'Unknown tool');
  const args = message.params.arguments;
  if (!args || typeof args.prompt !== 'string' || !args.prompt.trim() || args.prompt.length > 16000 || (args.max_tokens !== undefined && (!Number.isInteger(args.max_tokens) || args.max_tokens < 1 || args.max_tokens > 4096))) return error(res, id, -32602, 'Invalid tool arguments');
  const outcome = await callGateway({credential, prompt: args.prompt, maxTokens: args.max_tokens ?? 256, requestId: randomUUID()});
  if (outcome.status !== 200) return rpc(res, id, {isError: true, content: [{type: 'text', text: `AUVEN ${outcome.status}: ${outcome.data.error || 'request_failed'}${outcome.data.event_id ? ` (event ${outcome.data.event_id})` : ''}`}]});
  const answer = outcome.data.result?.choices?.[0]?.message?.content;
  return rpc(res, id, {content: [{type: 'text', text: `${typeof answer === 'string' ? answer : JSON.stringify(outcome.data.result)}\n\nAUVEN event: ${outcome.data.event_id}`}]});
}
module.exports = {handle, tool};
