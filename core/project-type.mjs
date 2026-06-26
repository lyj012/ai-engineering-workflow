// Canonical project-type classifier — pure, deterministic, unit-tested.
//
// Decides whether a target repo is a browser-verifiable web/fullstack app (so the delivery pipeline
// should run real-browser verification) or not (skip it). Classification is based on OBJECTIVE repo
// structure signals — never on the requirement text. A subagent gathers the raw signals (package.json
// deps/scripts, presence of index.html, server entry); this pure function decides. The decision feeds
// the plan artifact so the downstream delivery engine knows whether browser verification applies.
//
// Why core/: see core/README. The Claude Workflow script keeps an INLINE copy under PROJECT-TYPE
// markers; scripts/self-check.mjs behaviour-diffs the inline copy against this canonical one.
// Unit tests: scripts/project-type.test.mjs.
//
// input = {
//   hasPackageJson,   // bool
//   deps,             // string[]: names from dependencies + devDependencies
//   scripts,          // object: package.json "scripts" map { name: command }
//   hasIndexHtml,     // bool: an index.html at repo root or in public/ / src/
//   hasServerEntry,   // bool: a server entry like server.js / app.py / main.go that serves HTTP
// }
// returns { type: 'web'|'fullstack'|'non-web'|'unknown', isWeb, signals, startCommand, baseUrlGuess }

const FRONTEND = ['react', 'react-dom', 'vue', 'svelte', '@sveltejs/kit', '@angular/core', 'solid-js', 'preact', 'astro', 'next', 'nuxt', 'remix', '@remix-run/react', 'gatsby', 'vite', 'webpack', 'parcel', '@vitejs/plugin-react']
const SERVER = ['express', 'koa', 'fastify', '@nestjs/core', 'hapi', '@hapi/hapi', 'next', 'nuxt', 'remix', '@remix-run/node', 'gatsby']
// frameworks that are full-stack on their own (serve both a UI and a server)
const FULLSTACK_FRAMEWORKS = ['next', 'nuxt', 'remix', '@remix-run/react', '@remix-run/node', 'gatsby', '@sveltejs/kit']
// default dev-server port guesses per framework (best-effort; runtime should read the actual port)
const PORT_GUESS = [['next', 3000], ['nuxt', 3000], ['gatsby', 8000], ['vite', 5173], ['@vitejs/plugin-react', 5173], ['react-scripts', 3000], ['@sveltejs/kit', 5173], ['astro', 4321]]

export function classifyProjectType(input) {
  const i = input || {}
  const deps = (Array.isArray(i.deps) ? i.deps : []).map(d => String(d).toLowerCase())
  const scripts = (i.scripts && typeof i.scripts === 'object') ? i.scripts : {}
  const depSet = new Set(deps)
  const signals = []

  const matched = list => list.filter(x => depSet.has(x))
  const frontendHits = matched(FRONTEND)
  const serverHits = matched(SERVER)
  const fullstackHits = matched(FULLSTACK_FRAMEWORKS)

  if (frontendHits.length) signals.push('frontend deps: ' + frontendHits.join(', '))
  if (serverHits.length) signals.push('server deps: ' + serverHits.join(', '))
  if (i.hasIndexHtml) signals.push('index.html present')
  if (i.hasServerEntry) signals.push('server entry present')

  const hasFrontend = frontendHits.length > 0 || !!i.hasIndexHtml
  const hasServer = serverHits.length > 0 || !!i.hasServerEntry
  const hasFullstackFramework = fullstackHits.length > 0

  // startCommand: prefer an explicit dev server script, then start
  let startCommand = null
  if (scripts.dev) startCommand = 'npm run dev'
  else if (scripts.start) startCommand = 'npm start'
  else if (scripts.serve) startCommand = 'npm run serve'
  if (startCommand) signals.push('start via "' + startCommand + '"')

  // baseUrlGuess: best-effort by framework; runtime must confirm the real port
  let baseUrlGuess = null
  for (const [name, port] of PORT_GUESS) {
    if (depSet.has(name)) { baseUrlGuess = 'http://localhost:' + port; break }
  }

  let type
  if (!i.hasPackageJson && !i.hasIndexHtml) {
    type = 'non-web'                                   // shell / python / go / etc. — no browser UI
  } else if (hasFullstackFramework || (hasFrontend && hasServer)) {
    type = 'fullstack'
  } else if (hasFrontend) {
    type = 'web'
  } else if (i.hasPackageJson) {
    // has package.json but no detected frontend: backend API / library / CLI — no browser UI to verify
    type = hasServer ? 'non-web' : 'unknown'
  } else {
    type = 'unknown'
  }

  const isWeb = type === 'web' || type === 'fullstack'
  return { type, isWeb, signals, startCommand: isWeb ? startCommand : null, baseUrlGuess: isWeb ? baseUrlGuess : null }
}
