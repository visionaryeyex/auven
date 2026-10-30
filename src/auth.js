import React, { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { PrivyProvider, usePrivy, useLogin, useLinkAccount, useIdentityToken } from '@privy-io/react-auth';
import { defineChain } from 'viem';

let config = { enabled: false, chainId: 4663 };
let bridge = null;
let finishSdkReady;
const sdkReady = new Promise(resolve => { finishSdkReady = resolve; });
let lastIdentity = null;
let fallbackToken = null;
let fallbackTokenUntil = 0;
let fallbackTokenPromise = null;
let lastUserId = null;

function Bridge() {
  const { ready, authenticated, user, getAccessToken, logout } = usePrivy();
  const { identityToken } = useIdentityToken();
  const { login } = useLogin();
  const { linkEmail, linkWallet } = useLinkAccount({
    onSuccess: () => window.dispatchEvent(new Event('auven-auth-change'))
  });
  bridge = { ready, authenticated, user, identityToken, getAccessToken, logout, login, linkEmail, linkWallet };
  const identity = ready ? `${authenticated}:${user?.id || ''}:${Boolean(identityToken)}:${JSON.stringify(user?.linkedAccounts || [])}` : null;
  useEffect(() => {
    if (!ready) return;
    finishSdkReady();
    const userId = authenticated ? user?.id || null : null;
    if (userId !== lastUserId) {
      lastUserId = userId;
      fallbackToken = null;
      fallbackTokenUntil = 0;
      fallbackTokenPromise = null;
    }
    if (identity !== lastIdentity) {
      lastIdentity = identity;
      window.dispatchEvent(new Event('auven-auth-change'));
    }
  }, [ready, identity]);
  return null;
}

const ready = (async () => {
  try {
    const response = await fetch('/api/auth/config', { cache: 'no-store' });
    if (!response.ok) return;
    config = await response.json();
    if (!config.enabled) return;
    const chain = defineChain({
      id: config.chainId,
      name: 'Robinhood Chain',
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: { default: { http: ['https://rpc.mainnet.chain.robinhood.com'] } },
      blockExplorers: { default: { name: 'Robinhood Chain Explorer', url: 'https://robinhoodchain.blockscout.com' } }
    });
    const root = document.createElement('div');
    root.id = 'privy-root';
    document.body.append(root);
    createRoot(root).render(React.createElement(PrivyProvider, {
      appId: config.appId,
      config: {
        loginMethods: ['email', 'wallet'],
        appearance: { theme: 'light', accentColor: '#7457ef' },
        defaultChain: chain,
        supportedChains: [chain],
        embeddedWallets: { ethereum: { createOnLogin: 'off' } }
      }
    }, React.createElement(Bridge)));
    await Promise.race([
      sdkReady,
      new Promise((_, reject) => setTimeout(() => reject(new Error('Privy did not become ready')), 12000))
    ]);
  } catch (error) {
    config.enabled = false;
    console.error('AUVEN authentication could not start', error);
  }
})();

async function accessToken() {
  await ready;
  if (!bridge?.authenticated) return null;
  if (bridge.identityToken) return bridge.identityToken;
  if (fallbackToken && Date.now() < fallbackTokenUntil) return fallbackToken;
  if (!fallbackTokenPromise) fallbackTokenPromise = bridge.getAccessToken()
    .then(token => {
      fallbackToken = token;
      fallbackTokenUntil = token ? Date.now() + 20 * 60 * 1000 : 0;
      return token;
    })
    .finally(() => { fallbackTokenPromise = null; });
  return fallbackTokenPromise;
}

function assertBridge() {
  if (!bridge?.ready) throw new Error('Privy sign-in is not configured yet.');
  return bridge;
}

async function emailLogin() { assertBridge().login({ loginMethods: ['email'] }); }
async function walletSignIn() { assertBridge().login({ loginMethods: ['wallet'], walletChainType: 'ethereum-only' }); }
async function linkWallet() { assertBridge().linkWallet(); }
async function addEmail() { assertBridge().linkEmail(); }
async function signOut() {
  fallbackToken = null;
  fallbackTokenUntil = 0;
  if (bridge?.authenticated) await bridge.logout();
}

window.auvenAuth = {
  ready, enabled: () => Boolean(config.enabled && bridge?.ready),
  signedIn: () => Boolean(bridge?.authenticated), accessToken,
  emailLogin, walletSignIn, linkWallet, addEmail, signOut
};
