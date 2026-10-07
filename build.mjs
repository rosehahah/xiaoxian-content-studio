import {build} from 'esbuild';
import fs from 'node:fs/promises';
await import('./scripts/build-icons.mjs');
await build({entryPoints:['vendor-entry.js'],outfile:'dist/vendor.js',bundle:true,format:'esm',minify:true,target:'es2022'});
await fs.copyFile('model.mjs','dist/model.mjs');
await fs.copyFile('creative.mjs','dist/creative.mjs');
await fs.copyFile('icon-library.mjs','dist/icon-library.mjs');
console.log('Static website ready in dist/. Local server: npm start');
