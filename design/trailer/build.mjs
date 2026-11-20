// Bundle the trailer page (the game's modules import their textures and music as files, like build.mjs).
// node design/trailer/build.mjs  ->  design/trailer/trailer.bundle.js, then open design/trailer/index.html
import * as esbuild from 'esbuild';

await esbuild.build({
  entryPoints: ['design/trailer/trailer.js'], outfile: 'design/trailer/trailer.bundle.js',
  bundle: true, format: 'esm', target: 'es2022', sourcemap: false, logLevel: 'info',
  loader: { '.jpg': 'dataurl', '.png': 'dataurl', '.otf': 'dataurl', '.mp3': 'dataurl' },
});
