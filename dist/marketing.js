const showcase = document.querySelector('#feature-showcase');
if (showcase) {
  const tabs = [...showcase.querySelectorAll('[data-showcase]')];
  const panels = [...showcase.querySelectorAll('[data-panel]')];
  const activate = (name, focus = false) => {
    tabs.forEach((tab) => {
      const active = tab.dataset.showcase === name;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
      if (active && focus) tab.focus();
    });
    panels.forEach((panel) => { panel.hidden = panel.dataset.panel !== name; });
  };
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => activate(tab.dataset.showcase));
    tab.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft' && event.key !== 'Home' && event.key !== 'End') return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      activate(tabs[next].dataset.showcase, true);
    });
  });
  const fromHash = () => {
    const name = location.hash.slice(1);
    if (['identity', 'control', 'proof'].includes(name)) {
      activate(name);
      showcase.scrollIntoView({behavior:'smooth', block:'start'});
    }
  };
  window.addEventListener('hashchange', fromHash);
  if (location.hash) fromHash();
}

const copyToken = document.querySelector('[data-copy-token]');
if (copyToken) {
  let resetLabel;
  copyToken.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(document.querySelector('#token-address').textContent.trim());
      copyToken.textContent = 'Copied';
    } catch {
      copyToken.textContent = 'Select address to copy';
    }
    clearTimeout(resetLabel);
    resetLabel = setTimeout(() => { copyToken.textContent = 'Copy address'; }, 2500);
  });
}

document.addEventListener('click', (event) => {
  document.querySelectorAll('.mobile-nav[open]').forEach((menu) => {
    if (!menu.contains(event.target)) menu.open = false;
  });
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') document.querySelectorAll('.mobile-nav[open]').forEach((menu) => { menu.open = false; });
});
document.querySelectorAll('.mobile-nav a').forEach((link) => link.addEventListener('click', () => { link.closest('details').open = false; }));

if ('IntersectionObserver' in window && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
  const revealTargets = document.querySelectorAll('.platform-heading, .showcase, .dark-heading, .dark-steps article, .quantum-text, .quantum-art, .developer-section > div, .closing-new');
  revealTargets.forEach((element) => { element.dataset.reveal = ''; });
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('is-visible');
      observer.unobserve(entry.target);
    });
  }, { threshold: 0.08, rootMargin: '0px 0px -32px 0px' });
  document.body.classList.add('motion-ready');
  revealTargets.forEach((element) => observer.observe(element));
}
