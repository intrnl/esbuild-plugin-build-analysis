import * as fs from 'fs/promises';
import * as path from 'path';

import * as esbuild from 'esbuild';
import * as lexer from 'es-module-lexer';


/**
 * @returns {esbuild.Plugin}
 */
export default function buildAnalysisPlugin () {
	return {
		name: '@intrnl/esbuild-plugin-build-analysis',
		async setup (build) {
			const shouldWrite = build.initialOptions.write ?? true;

			// Make sure metafile is always generated
			build.initialOptions.metafile = true;

			// Retrieve normalized output and public path
			let outDir = path.normalize(build.initialOptions.outdir);
			let publicPath = path.normalize(build.initialOptions.publicPath || '.');

			if (publicPath === '.') {
				console.warn('[build-analysis]', 'unable to optimize because public path is not set correctly');
				return;
			}

			if (!publicPath.endsWith('/')) {
				publicPath += '/';
			}
			if (!outDir.endsWith('/')) {
				outDir += '/';
			}

			// Initialize lexer ahead of time
			await lexer.init;

			build.onEnd(async (result) => {
				const outputs = result.metafile.outputs;

				for (const id in outputs) {
					if (!id.endsWith('.js')) {
						continue;
					}

					const chunk = outputs[id];

					if (!chunk.imports.find((mod) => mod.kind === 'dynamic-import')) {
						continue;
					}

					const staticImports = chunk.imports.filter((mod) => mod.kind === 'import-statement');
					const staticSet = new Set(staticImports.map((mod) => mod.path));

					let source = await fs.readFile(id, 'utf-8');
					const [imports] = lexer.parse(source, id);

					const preloadKey = findAvailableName(source, '_p');
					let preloadInject = false;

					for (const stmt of imports.reverse()) {
						if (stmt.d < 0) {
							continue;
						}

						const file = stmt.n.replace(publicPath, outDir);
						const importedChunk = outputs[file];

						if (!importedChunk) {
							console.warn(`cannot find '${file}' from '${id}'`);
							continue;
						}

						const assets = [
							stmt.n,
							...importedChunk.imports
								.filter((mod) => (
									// We don't need to preload already loaded modules
									!staticSet.has(mod.path) &&
									// Only direct imports should be preloaded
									mod.kind === 'import-statement'
								))
								.map((mod) => mod.path.replace(outDir, publicPath)),
						];

						if (!assets.length) {
							continue;
						}

						preloadInject = true;

						const statement = source.substring(stmt.d, stmt.se + 1);
						const replacement = `${preloadKey}(() => ${statement}, ${JSON.stringify(assets)})`;

						source = substr(source, stmt.d, stmt.se + 1, replacement);
					}

					if (preloadInject) {
						source += generatePreload(preloadKey);
					}

					if (shouldWrite && preloadInject) {
						await fs.writeFile(id, source);
					}
				}
			});
		},
	};
}

function findAvailableName (source, name) {
	let count = 0;
	let result = name;

	while (source.includes(result)) {
		result = name + '$' + (++count);
	}

	return result;
}

function substr (string, start, end, replacement = '') {
	return string.slice(0, start) + replacement + string.slice(end);
}


const preloadCode = ';function __preload(r,c){const d=document,t=__preload.s||(__preload.s={}),o=[];for(const e of c){if(e in t)continue;t[e]=!0;const s=e.endsWith(".css"),i=e.endsWith(".js"),l=s?\'[rel="stylesheet"]\':"";if(d.querySelector(`link[href="${e}"]${l}`))continue;const n=document.createElement("link");if(n.rel=s?"stylesheet":i?"modulepreload":"preload",n.href=e,document.head.appendChild(n),s){const u=new Promise((a,h)=>{n.addEventListener("load",a),n.addEventListener("error",h)});o.push(u)}}return Promise.all(o).then(r)};';

function generatePreload (name) {
	return preloadCode.replace(/__preload/g, name);
}
