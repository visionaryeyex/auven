# Connect an agent to AUVEN

AUVEN controls requests made through its gateway. Your agent continues to run in your own application. Give each agent its own AUVEN credential and send its supported OpenAI chat requests to AUVEN instead of directly to OpenAI.

## Register and save the credential

1. Sign in to the AUVEN dashboard and create a workspace.
2. Open **Agents → Connect agent**. Enter a name, purpose, and daily budget in USD.
3. Copy the credential shown after registration. It is displayed only once; AUVEN stores a hash. Store it in your application's server-side secret manager as `AUVEN_AGENT_CREDENTIAL`.
4. Keep `AUVEN_OPENAI_API_KEY` on the AUVEN server. The agent does not need this key.

You can also register an agent through `POST /api/agents` using a workspace session or the workspace admin token. The API accepts `name`, `purpose`, and `daily_limit_cents` as an integer. Its response contains the agent's ID, one-time credential, and signed passport.

## Send a request

```javascript
const requestId = crypto.randomUUID();
const response = await fetch('https://YOUR_AUVEN_DOMAIN/api/gateway/chat', {
  method: 'POST',
  headers: {
    authorization: `Bearer ${process.env.AUVEN_AGENT_CREDENTIAL}`,
    'idempotency-key': requestId,
    'content-type': 'application/json'
  },
  body: JSON.stringify({
    messages: [{ role: 'user', content: 'Summarize this report.' }],
    max_tokens: 200
  })
});
const data = await response.json();
if (!response.ok) throw new Error(`${response.status}: ${data.error}`);
console.log(data.event_id, data.result);
```

The route accepts a nonempty `messages` array and `max_tokens` from 1 to 4096. It returns an `event_id` and the provider response under `result`. Use a unique `Idempotency-Key` of 8–128 characters for each logical call. If you retry an uncertain call, reuse the same key; AUVEN returns `409 duplicate_request` rather than forwarding it twice. A new call gets a new key.

The gateway checks that the credential belongs to an active agent, estimates budget from `max_tokens`, reserves that amount, forwards the request, and records the result. This estimate is **not** exact provider billing. Start with a low limit and review activity before increasing it. The policy applies only to requests routed through AUVEN; direct provider calls remain outside this gateway.

## Responses to handle

| Status | Error | What to do |
| --- | --- | --- |
| 400 | `idempotency_key_required` or `invalid_request` | Correct the header or JSON body. |
| 401 | `invalid_agent_credential` | Check the server-side credential; register a new agent if it was lost. |
| 403 | `agent_stopped` or `budget_exceeded` | Ask the workspace owner to resume the agent or review its daily limit. |
| 409 | `duplicate_request` | Treat this as an already-seen logical request. Inspect the returned event. |
| 503 | `provider_not_configured` | The AUVEN operator must set `AUVEN_OPENAI_API_KEY`. |
| 502 | `provider_error` or `provider_unavailable` | Inspect Activity and retry according to your application policy with a new logical request ID only when appropriate. |

## Review evidence

The workspace owner can stop or resume the agent and inspect **Activity**. A signed passport is created when the agent is registered. An activity checkpoint is created with `POST /api/checkpoints` and `{"agent_id":"AGENT_ID"}` using a workspace session or admin token. The resulting proof can be exported and checked with `node verify.cjs proof.json`.

Publishing a proof commitment to Robinhood Chain mainnet is a separate owner action. It requires a funded backend signer, costs gas, and does not put the activity details or the ML-DSA signature onchain.
