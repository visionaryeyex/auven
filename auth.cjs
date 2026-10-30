const APP_ID = process.env.AUVEN_PRIVY_APP_ID;
const APP_SECRET = process.env.AUVEN_PRIVY_APP_SECRET;
const CHAIN_ID = 4663;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
let clientPromise;

function configured() { return Boolean(APP_ID && APP_SECRET); }

function publicConfig() {
  return configured()
    ? { enabled: true, appId: APP_ID, chainId: CHAIN_ID }
    : { enabled: false, chainId: CHAIN_ID };
}

function identities(user) {
  const linked = user?.linkedAccounts || user?.linked_accounts || [];
  const email = linked.find(item => item.type === 'email' && typeof item.address === 'string')?.address || null;
  const wallets = [...new Set(linked.filter(item => item.type === 'wallet' &&
    (item.chainType || item.chain_type) === 'ethereum' && ADDRESS.test(item.address || '')
  ).map(item => item.address.toLowerCase()))];
  return { email, wallets };
}

async function client() {
  if (!clientPromise) clientPromise = import('@privy-io/node').then(({ PrivyClient }) =>
    new PrivyClient({ appId: APP_ID, appSecret: APP_SECRET })
  );
  return clientPromise;
}

async function userFromToken(token, sdk) {
  if (!configured() || !token || token.split('.').length !== 3) return null;
  try {
    sdk ||= await client();
    let user;
    try {
      // An identity token carries signed linked accounts, so no Privy user lookup is needed.
      user = await sdk.users().get({ id_token: token });
    } catch {
      // Email sessions can be valid before Privy issues an identity token. Verify the
      // access token first, then fetch linked accounts using only its verified user ID.
      const claims = await sdk.utils().auth().verifyAccessToken(token);
      user = await sdk.users()._get(claims.user_id);
    }
    if (!/^did:privy:[a-zA-Z0-9]+$/.test(user?.id || '')) return null;
    const { email, wallets } = identities(user);
    if (!email && !wallets.length) return null;
    return { id: user.id, email, wallets };
  } catch { return null; }
}

module.exports = { configured, publicConfig, userFromToken, identities };
