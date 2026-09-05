// Audit for the /admin page: every tab fragment (editor_page.js,
// content_page.js, ai_page.js, stats_page.js, comments_tab.js) embeds its
// inline <script> inside ONE outer template literal. A backslash escape like
// \" in the page script is eaten by that literal (\" -> ") and the whole
// inline script dies with a SyntaxError — every button on the tab goes dead
// while the page still renders fine. This tool reconstructs each script
// exactly as the browser sees it (evaluate the outer literal once, with the
// tab placeholders blank) and syntax-checks it with node --check.
//
// Run after editing any admin tab fragment:  node tools/check_admin_scripts.mjs
import { readFileSync, writeFileSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'workers');
const files = ['admin_page.js', 'editor_page.js', 'content_page.js', 'music_page.js', 'ai_page.js', 'stats_page.js', 'comments_tab.js'];
const TABS = ['EDITOR_TAB_HTML', 'CONTENT_TAB_HTML', 'MUSIC_TAB_HTML', 'AI_TAB_HTML', 'STATS_TAB_HTML', 'COMMENTS_TAB_HTML'];
const outDir = mkdtempSync(join(tmpdir(), 'npadmin-'));
let failures = 0;

for (const f of files) {
  const src = readFileSync(join(root, f), 'utf8');
  const literals = [...src.matchAll(/=\s*`([\s\S]*?)`;\s*(?:$|export|\/\/|<)/gm)];
  let idx = 0;
  for (const match of literals) {
    let html;
    try {
      html = new Function(...TABS, 'return `' + match[1] + '`')('', '', '', '', '', '');
    } catch (error) {
      console.log('EVAL-FAIL  ', f, String(error.message).split('\n')[0]);
      failures++;
      continue;
    }
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
    for (const s of scripts) {
      const p = join(outDir, f.replace(/\.js$/, '') + '-' + idx + '.js');
      writeFileSync(p, s[1]);
      try {
        execFileSync(process.execPath, ['--check', p], { stdio: 'pipe' });
        console.log('OK          ', f, 'script #' + idx, '(' + s[1].length + ' chars)');
      } catch (error) {
        const msg = String(error.stderr).split('\n').filter(Boolean).slice(0, 3).join(' | ');
        console.log('SYNTAX-FAIL ', f, 'script #' + idx, '->', msg);
        failures++;
      }
      idx++;
    }
  }
}
console.log(failures ? '\n' + failures + ' problem(s) found' : '\nall inline scripts parse clean');
process.exit(failures ? 1 : 0);
