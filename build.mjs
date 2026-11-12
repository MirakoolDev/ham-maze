// Dev:   node build.mjs --dev   -> serves www/ on http://localhost:5173 with rebuild on save
// Build: node build.mjs         -> dist/index.html, one self-contained file (JS + CSS inlined)
import * as esbuild from 'esbuild';
import fs from 'node:fs';

const dev = process.argv.includes('--dev');
const tpl = fs.readFileSync('src/index.html', 'utf8');
const loader = { '.jpg': 'dataurl', '.png': 'dataurl', '.otf': 'dataurl', '.mp3': 'dataurl' };
const fill = (html, css, js) => html.replace('<!--CSS-->', () => css).replace('<!--JS-->', () => js);

if (dev) {
  fs.mkdirSync('www', { recursive: true });
  const writeHtml = () => fs.writeFileSync('www/index.html',
    fill(fs.readFileSync('src/index.html', 'utf8'), '<link rel="stylesheet" href="ui.css">', '<script src="main.js"></script>'));
  writeHtml();
  const ctx = await esbuild.context({
    entryPoints: ['src/main.js', 'src/ui.css'], bundle: true, outdir: 'www', format: 'iife', sourcemap: true, logLevel: 'info', loader,
    plugins: [{ name: 'html', setup(b) { b.onEnd(writeHtml); } }],
  });
  await ctx.watch();
  const { port } = await ctx.serve({ servedir: 'www', port: 5173 });
  console.log(`dev server on http://localhost:${port}`);
} else {
  const r = await esbuild.build({
    entryPoints: ['src/main.js'], bundle: true, minify: true, format: 'iife', write: false, legalComments: 'none', target: 'es2020', loader,
  });
  const js = r.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
  const css = fs.readFileSync('src/ui.css', 'utf8');
  fs.mkdirSync('dist', { recursive: true });
  const full = fill(tpl, `<style>\n${css}\n</style>`, `<script>\n${js}\n</script>`);
  fs.writeFileSync('dist/index.html', full); // self-hosting (your own site)
  // claude.ai artifact: the host supplies the document skeleton, so drop ours.
  const artifact = full
    .replace(/<!doctype html>\s*|<\/?html[^>]*>\s*|<\/?head>\s*|<\/?body>\s*/gi, '')
    .replace(/<meta charset[^>]*>\s*|<meta name="viewport"[^>]*>\s*/gi, '')
    .replace(/<title>[^<]*<\/title>/, (t) => `${t}\n<meta name="claude:viewport-fit-sides" content="cover">`);
  fs.writeFileSync('dist/artifact.html', artifact);
  for (const f of ['dist/index.html', 'dist/artifact.html']) console.log(`${f}  ${(fs.statSync(f).size / 1024).toFixed(0)} KB`);
}
