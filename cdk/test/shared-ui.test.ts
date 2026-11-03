import * as fs from 'fs';
import * as path from 'path';

const SRC = path.join(__dirname, '..', '..', 'src');
const read = (file: string) => fs.readFileSync(path.join(SRC, file), 'utf8');
const DL_CSS = '<link rel="stylesheet" href="https://files.dliu.com/dliu.com/ui/v1/dl.css">';
const DL_ICON = 'https://files.dliu.com/dliu.com/favicon.png';
const pages = fs.readdirSync(SRC).filter((file) => file.endsWith('.html'));
const navOf = (page: string) => page.match(/<nav class="dl-nav" aria-label="Site">[\s\S]*?<\/nav>/)?.[0]
  .replace(/ aria-current="page"/g, '');

test('every page loads the shared dliu.com stylesheet before its own and uses the DL icon', () => {
  expect(pages.sort()).toEqual([
    '404.html', 'docs.html', 'guinea-pigs.html', 'hang-clothes.html', 'index.html', 'kaka-teeth.html', 'laundry.html',
    'rules.html',
  ]);
  for (const file of pages) {
    const page = read(file);
    expect(page).toContain(DL_CSS);
    expect(page.indexOf(DL_CSS)).toBeLessThan(page.indexOf('<link rel="stylesheet" href="/styles.css">'));
    expect(page).toContain(`<link rel="icon" type="image/png" href="${DL_ICON}">`);
    expect(page).not.toMatch(/w3\.css|w3-/);
  }
});

test('every page has the shared header, the same menu, and the shared footer', () => {
  const menu = navOf(read('index.html'));
  expect(menu).toBeDefined();
  for (const file of pages) {
    const page = read(file);
    expect(page).toContain('<body class="dl-page">');
    expect(page).toContain(`<a class="dl-brand" href="/"><img class="dl-logo" src="${DL_ICON}" alt="" width="32" height="32">Home Tasks</a>`);
    expect(navOf(page)).toBe(menu);
    expect(page).toMatch(/<main class="dl-main[" ]/);
    expect(page).toMatch(new RegExp(`<footer class="dl-footer">\\s*<a class="dl-footer-logo" href="https://dliu.com" aria-label="dliu.com"><img src="${DL_ICON}" alt="" width="24" height="24"></a>\\s*<a href="https://dliu.com">dliu.com</a> · <a href="/docs">Docs</a>`));
  }
  expect(menu).toMatch(/<a class="dl-nav-link" href="\/rules.html">Rules<\/a>\s*<a class="dl-button" href="\/docs">Docs<\/a>\s*<\/nav>/);
  expect(read('laundry.html')).toContain('<a class="dl-nav-link" href="/laundry.html" aria-current="page">');
  expect(read('docs.html')).toContain('<a class="dl-button" href="/docs" aria-current="page">Docs</a>');
});

test('/docs uses the shared docs stylesheet, tabs and article, and links to the rules', () => {
  const page = read('docs.html');
  const DL_DOCS_CSS = '<link rel="stylesheet" href="https://files.dliu.com/dliu.com/ui/v1/dl-docs.css">';
  expect(page.indexOf(DL_CSS)).toBeLessThan(page.indexOf(DL_DOCS_CSS));
  expect(page.indexOf(DL_DOCS_CSS)).toBeLessThan(page.indexOf('<link rel="stylesheet" href="/styles.css">'));
  expect(page).toContain('<main class="dl-main dl-docs-main">');
  expect(page).toContain('<nav class="dl-tabs" aria-label="Docs sections">');
  for (const id of ['architecture', 'tasks', 'cost', 'security']) {
    expect(page).toContain(`<a href="/docs#${id}"`);
    expect(page).toContain(`<article class="dl-docs" id="${id}">`);
  }
  expect(page).toContain('href="/rules.html">Rules</a> page');
  for (const file of pages.filter((name) => name !== 'docs.html')) {
    expect(read(file)).not.toContain('dl-docs');
  }
});

test('the app stylesheet and script leave the header, buttons and palette to the shared stylesheet', () => {
  const css = read('styles.css');
  expect(css).not.toMatch(/^\s*(header|footer|button)\b|\.dl-(header|button|footer)|--[a-z-]+\s*:/m);
  expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
  expect(read('app.js')).not.toContain('w3-');
  expect(fs.existsSync(path.join(SRC, 'menu.js'))).toBe(false);
});
