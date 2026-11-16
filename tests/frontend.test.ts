import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Window, type HTMLButtonElement, type HTMLFormElement, type HTMLInputElement } from 'happy-dom';

async function openPage(fetcher: (input: string, init?: RequestInit) => Promise<Response>) {
  const html = await readFile('index.html', 'utf8');
  const window = new Window({ url: 'https://example.test/' });
  window.document.write(html.replace(/<script>[\s\S]*?<\/script>/g, ''));
  Object.defineProperty(window, 'fetch', { value: fetcher });
  Object.defineProperty(window, 'confirm', { value: () => true });
  for (const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) window.eval(match[1]);
  await new Promise(resolve => setTimeout(resolve, 20));
  return window;
}

test('all names and edit buttons remain visible when the API is unavailable', async () => {
  const window = await openPage(async () => { throw new Error('offline'); });
  try {
    const document = window.document;
    assert.equal(document.querySelectorAll('[data-edit-member]').length, 27);
    assert.equal(document.querySelector('.join-form'), null);
    assert.equal(document.querySelector('#members')?.classList.contains('on'), true);
    document.querySelector<HTMLButtonElement>('[data-edit-member="7"]')!.click();
    assert.match(document.querySelector('#editor')!.textContent, /Ali Nategh Fasihi/);
    assert.ok(document.querySelector('#profileForm'));
  } finally { await window.happyDOM.close(); }
});

test('profile editing saves directly without a join request', async () => {
  const calls: string[] = [];
  const profiles = Array.from({ length: 27 }, (_, i) => ({ id: i + 1, name: `Member ${i + 1}`, role: 'member', active: true, room: '', version: 0, profile: {} as Record<string, unknown> }));
  const window = await openPage(async (path, init) => {
    calls.push(path);
    if (path === '/api/profile') {
      const data = JSON.parse(String(init?.body));
      profiles[data.id - 1].profile = data.profile;
      profiles[data.id - 1].version++;
      return Response.json({ ok: true });
    }
    return Response.json({ me: null, members: profiles, announcement: '', audit: [] });
  });
  try {
    const document = window.document;
    document.querySelector<HTMLButtonElement>('[data-edit-member="2"]')!.click();
    const form = document.querySelector<HTMLFormElement>('#profileForm')!;
    (form.elements.namedItem('display_name') as HTMLInputElement).value = 'نام همسفر';
    form.dispatchEvent(new window.Event('submit', { cancelable: true }));
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.ok(calls.includes('/api/profile'));
    assert.equal(calls.includes('/api/join'), false);
    assert.equal(profiles[1].profile.display_name, 'نام همسفر');
    assert.equal(document.querySelector('.join-form'), null);
  } finally { await window.happyDOM.close(); }
});
