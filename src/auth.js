import { createClient } from '@supabase/supabase-js';

let client = null;
let config = { enabled: false, chainId: 4663 };

const ready = (async () => {
  try {
    const response = await fetch('/api/auth/config', { cache: 'no-store' });
    if (!response.ok) return;
    config = await response.json();
    if (!config.enabled) return;
    client = createClient(config.url, config.publishableKey, {
      auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true }
    });
    client.auth.onAuthStateChange(() => window.dispatchEvent(new Event('auven-auth-change')));
    await client.auth.getSession();
  } catch (error) { console.error('AUVEN authentication could not start', error); }
})();

async function session() {
  await ready;
  return client ? (await client.auth.getSession()).data.session : null;
}

async function accessToken() { return (await session())?.access_token || null; }

function assertClient() {
  if (!client) throw new Error('Email and wallet sign-in are not configured yet.');
  return client;
}

async function emailLink(email) {
  const { error } = await assertClient().auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.origin + '/?auven=auth' }
  });
  if (error) throw error;
}

async function ethereumWallet() {
  const wallet = window.ethereum;
  if (!wallet?.request) throw new Error('Install or open an EVM browser wallet to continue.');
  const chainId = '0x' + config.chainId.toString(16);
  const current = await wallet.request({ method: 'eth_chainId' });
  if (current?.toLowerCase() !== chainId.toLowerCase()) {
    try { await wallet.request({ method: 'wallet_switchEthereumChain', params: [{ chainId }] }); }
    catch (error) {
      if (error.code !== 4902) throw error;
      await wallet.request({ method: 'wallet_addEthereumChain', params: [{
        chainId,
        chainName: 'Robinhood Chain',
        nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
        rpcUrls: ['https://rpc.mainnet.chain.robinhood.com'],
        blockExplorerUrls: ['https://robinhoodchain.blockscout.com']
      }] });
    }
  }
  return wallet;
}

async function walletSignIn() {
  const wallet = await ethereumWallet();
  const { error } = await assertClient().auth.signInWithWeb3({
    chain: 'ethereum', wallet,
    statement: 'Sign in to AUVEN on Robinhood Chain.'
  });
  if (error) throw error;
}

async function linkWallet() {
  const wallet = await ethereumWallet();
  const addresses = await wallet.request({ method: 'eth_requestAccounts' });
  const address = addresses?.[0];
  if (!address) throw new Error('No wallet address was selected.');
  const jwt = await accessToken();
  if (!jwt) throw new Error('Sign in before linking a wallet.');
  const headers = { 'content-type': 'application/json', authorization: 'Bearer ' + jwt };
  const challengeResponse = await fetch('/api/profile/wallet/challenge', {
    method: 'POST', headers, body: JSON.stringify({ address })
  });
  const challenge = await challengeResponse.json();
  if (!challengeResponse.ok) throw new Error(challenge.error || 'Could not create wallet challenge.');
  const bytes = new TextEncoder().encode(challenge.message);
  const hexMessage = '0x' + Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  const signature = await wallet.request({ method: 'personal_sign', params: [hexMessage, address] });
  const linkResponse = await fetch('/api/profile/wallet/link', {
    method: 'POST', headers, body: JSON.stringify({ nonce: challenge.nonce, signature })
  });
  const linked = await linkResponse.json();
  if (!linkResponse.ok) throw new Error(linked.error || 'Could not link wallet.');
  return linked;
}

async function addEmail(email) {
  const { error } = await assertClient().auth.updateUser({ email });
  if (error) throw error;
}

async function signOut() {
  if (client) await client.auth.signOut();
}

window.auvenAuth = {
  ready, enabled: () => Boolean(client), session, accessToken,
  emailLink, walletSignIn, linkWallet, addEmail, signOut
};
