import fs from 'node:fs/promises';
import path from 'node:path';

const HTML_FILES = new Set(['index.html', 'iframe.html']);

function validateOptions({ passcodeHash, sessionHours }) {
  if (!/^[a-f0-9]{64}$/i.test(passcodeHash || '')) {
    throw new Error('passcode_hash must be a 64-character SHA-256 hexadecimal hash');
  }
  if (!Number.isFinite(sessionHours) || sessionHours <= 0) {
    throw new Error('passcode_session_hours must be a positive number');
  }
}

function gateMarkup(passcodeHash, sessionHours) {
  const config = JSON.stringify({ hash: passcodeHash.toLowerCase(), sessionMs: sessionHours * 60 * 60 * 1000 });
  return `<style id="storybook-passcode-gate-style">
body > *:not(#storybook-passcode-gate) { visibility: hidden !important; }
#storybook-passcode-gate { position: fixed; inset: 0; z-index: 2147483647; display: grid; place-items: center; background: #111827; color: #f9fafb; font: 16px system-ui, sans-serif; }
#storybook-passcode-gate form { width: min(90vw, 20rem); padding: 2rem; border-radius: .75rem; background: #1f2937; box-shadow: 0 1rem 3rem #0008; }
#storybook-passcode-gate h1 { margin: 0 0 .5rem; font-size: 1.25rem; }
#storybook-passcode-gate p { margin: 0 0 1rem; color: #d1d5db; }
#storybook-passcode-gate input, #storybook-passcode-gate button { box-sizing: border-box; width: 100%; min-height: 2.75rem; margin-top: .75rem; padding: .5rem .75rem; border: 1px solid #6b7280; border-radius: .375rem; font: inherit; }
#storybook-passcode-gate button { border: 0; background: #2563eb; color: white; cursor: pointer; }
#storybook-passcode-gate [role="alert"] { min-height: 1.25rem; margin-top: .75rem; color: #fca5a5; }
</style>
<div id="storybook-passcode-gate">
  <form>
    <h1>Private Storybook</h1>
    <p>Enter the passcode to continue.</p>
    <input type="text" name="username" autocomplete="username" value="storybook" hidden aria-hidden="true" tabindex="-1">
    <input type="password" name="password" autocomplete="current-password" aria-label="Passcode" required>
    <button type="submit">Continue</button>
    <div role="alert" aria-live="polite"></div>
  </form>
</div>
<script id="storybook-passcode-gate-script">
(() => {
  const config = ${config};
  // Scope the unlock to this passcode so other gated Storybooks on the same origin stay locked.
  const key = 'storybook-passcode-authenticated:' + config.hash.slice(0, 16);
  const gate = document.getElementById('storybook-passcode-gate');
  const form = gate.querySelector('form');
  const input = form.querySelector('input[type="password"]');
  const unlockMessage = 'storybook-passcode-unlocked';
  const alert = form.querySelector('[role="alert"]');
  const now = () => Date.now();
  const isValid = () => {
    try {
      return Number(localStorage.getItem(key)) > now();
    } catch {
      return false;
    }
  };
  const reveal = () => { gate.remove(); document.querySelector('#storybook-passcode-gate-style')?.remove(); };
  const digest = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))).map(byte => byte.toString(16).padStart(2, '0')).join('');
  if (isValid()) reveal();
  // The manager and its same-origin preview iframe gate independently; reveal the iframe once the manager unlocks.
  window.addEventListener('storage', event => {
    if (event.key === key && isValid()) reveal();
  });
  window.addEventListener('message', event => {
    if (event.source === window.parent && event.source !== window && event.origin === location.origin && event.data === unlockMessage) reveal();
  });
  const notifyFrames = () => {
    for (const frame of document.querySelectorAll('iframe')) {
      try {
        frame.contentWindow?.postMessage(unlockMessage, location.origin);
      } catch {
        // Ignore frames that cannot receive messages.
      }
    }
  };
  form.addEventListener('submit', async event => {
    event.preventDefault();
    alert.textContent = '';
    try {
      if ((await digest(input.value)) !== config.hash) {
        alert.textContent = 'Incorrect passcode.';
        input.select();
        return;
      }
      try {
        localStorage.setItem(key, String(now() + config.sessionMs));
      } catch {
        // Reveal this page even when browser storage is blocked.
      }
      reveal();
      notifyFrames();
    } catch {
      alert.textContent = 'Passcode validation is unavailable in this browser.';
    }
  });
})();
</script>`;
}

const ROBOTS_TXT = 'User-agent: *\nDisallow: /\n';
const NO_INDEX_META = '<meta name="robots" content="noindex, nofollow, noarchive">\n';

async function findHtmlFiles(staticDir) {
  const files = [];
  for (const entry of await fs.readdir(staticDir, { withFileTypes: true })) {
    const entryPath = path.join(staticDir, entry.name);
    if (entry.isDirectory()) files.push(...(await findHtmlFiles(entryPath)));
    else if (HTML_FILES.has(entry.name)) files.push(entryPath);
  }
  return files;
}

export async function injectAuthGate(staticDir, { passcodeHash, sessionHours = 24 }) {
  validateOptions({ passcodeHash, sessionHours });
  const files = await findHtmlFiles(staticDir);
  if (files.length === 0) throw new Error(`No index.html or iframe.html found in ${staticDir}`);
  const markup = gateMarkup(passcodeHash, sessionHours);
  await fs.writeFile(path.join(staticDir, 'robots.txt'), ROBOTS_TXT, 'utf8');
  for (const file of files) {
    const html = await fs.readFile(file, 'utf8');
    if (html.includes('storybook-passcode-gate-script')) continue;
    let withMeta = html;
    const robotsMeta = /<meta\b(?=[^>]*\bname\s*=\s*(['"])robots\1)[^>]*>/i;
    if (robotsMeta.test(withMeta)) {
      withMeta = withMeta.replace(robotsMeta, NO_INDEX_META);
    } else {
      if (/<head\b[^>]*>/i.test(withMeta)) {
        withMeta = withMeta.replace(/<head\b[^>]*>/i, match => `${match}\n${NO_INDEX_META}`);
      } else if (/<body\b/i.test(withMeta)) {
        withMeta = withMeta.replace(/<body\b/i, `<head>\n${NO_INDEX_META}</head>\n<body`);
      } else {
        withMeta = `${NO_INDEX_META}${withMeta}`;
      }
    }
    const marker = /<\/body>/i;
    const updated = marker.test(withMeta)
      ? withMeta.replace(marker, `${markup}</body>`)
      : /<\/html>/i.test(withMeta)
        ? withMeta.replace(/<\/html>/i, `${markup}</html>`)
        : `${withMeta}${markup}`;
    await fs.writeFile(file, updated);
  }
  return files;
}

if (process.argv[1]?.endsWith('inject-auth-gate.js')) {
  injectAuthGate(process.argv[2] || process.env.SB_PATH, {
    passcodeHash: process.env.PASSCODE_HASH,
    sessionHours: Number(process.env.PASSCODE_SESSION_HOURS || 24)
  }).catch(error => {
    console.error(error.message);
    process.exit(1);
  });
}
