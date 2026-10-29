const SUPABASE_URL = process.env.AUVEN_SUPABASE_URL?.replace(/\/$/, '');
const PUBLISHABLE_KEY = process.env.AUVEN_SUPABASE_PUBLISHABLE_KEY;
const CHAIN_ID = 4663;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

function configured() {
  return Boolean(SUPABASE_URL && PUBLISHABLE_KEY);
}

function publicConfig() {
  return configured()
    ? { enabled: true, url: SUPABASE_URL, publishableKey: PUBLISHABLE_KEY, chainId: CHAIN_ID }
    : { enabled: false, chainId: CHAIN_ID };
}

function walletIdentity(user) {
  const identity = user?.identities?.find(item =>
    item.provider === 'web3' &&
    item.identity_data?.chain === 'ethereum' &&
    String(item.identity_data?.network) === String(CHAIN_ID) &&
    ADDRESS.test(item.identity_data?.address || '')
  );
  return identity ? identity.identity_data.address.toLowerCase() : null;
}

async function userFromToken(token) {
  if (!configured() || !token || token.split('.').length !== 3) return null;
  try {
    const response = await fetch(SUPABASE_URL + '/auth/v1/user', {
      headers: { apikey: PUBLISHABLE_KEY, authorization: 'Bearer ' + token },
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) return null;
    const user = await response.json();
    if (!/^[0-9a-f-]{36}$/i.test(user.id || '')) return null;
    const email = user.email_confirmed_at ? user.email : null;
    const wallet = walletIdentity(user);
    if (!email && !wallet) return null;
    return {
      id: user.id,
      email,
      wallet
    };
  } catch { return null; }
}

module.exports = { configured, publicConfig, userFromToken, walletIdentity };
