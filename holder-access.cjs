const Token = require('./token.cjs');

function config() {
  const minimum = (process.env.AUVEN_HOLDER_MIN_TOKENS || '').trim();
  const model = (process.env.AUVEN_HOLDER_MODEL || '').trim();
  const multiplier = Number(process.env.AUVEN_HOLDER_ESTIMATE_MULTIPLIER);
  const dailyLimit = Number(process.env.AUVEN_HOLDER_DAILY_REQUEST_LIMIT);
  return {
    enabled: Boolean(minimum && model && /^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(minimum) && Number(minimum) > 0 && Number.isFinite(multiplier) && multiplier >= 1 && multiplier <= 100 && Number.isInteger(dailyLimit) && dailyLimit >= 1 && dailyLimit <= 100),
    minimum,
    model,
    multiplier,
    dailyLimit
  };
}

function rawMinimum(value, decimals) {
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) throw Error('invalid_holder_minimum');
  const [whole, fraction = ''] = value.split('.');
  if (fraction.length > decimals) throw Error('invalid_holder_minimum');
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt((fraction || '').padEnd(decimals, '0') || '0');
}

function evaluate(snapshot) {
  const policy = config();
  if (!policy.enabled) return { enabled: false, eligible: false };
  const balance = BigInt(snapshot?.total_balance_raw || '0');
  const minimum = rawMinimum(policy.minimum, snapshot.decimals);
  return {
    enabled: true,
    eligible: balance >= minimum,
    minimum_tokens: policy.minimum,
    model: policy.model,
    daily_request_limit: policy.dailyLimit,
    balance: snapshot.total_balance || '0',
    observed_slot: snapshot.slot || null
  };
}

async function forWorkspace(workspaceId, accounts, auth, token = Token) {
  if (!config().enabled) return { enabled: false, eligible: false };
  const users = await accounts.privyIdsForWorkspace(workspaceId);
  const linked = await Promise.all(users.map(id => auth.walletsForUser(id)));
  const wallets = [...new Set(linked.flat())];
  if (!wallets.length) return { ...evaluate({ total_balance_raw: '0', decimals: 6 }), eligible: false };
  return evaluate(await token.readWallets(wallets));
}

module.exports = { config, rawMinimum, evaluate, forWorkspace };
