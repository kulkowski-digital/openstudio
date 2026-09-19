#!/usr/bin/env node
import net from 'node:net'
import { serve } from '@hono/node-server'
import { createApp, diagnostics } from '../server/app.js'
import { getOrCreateSessionToken, resetSessionToken } from '../server/security.js'
import { loadModels } from '../server/models.js'
import { DATA_DIR, ensureDataDir } from '../server/paths.js'
import { log } from '../server/log.js'

const HOST = '127.0.0.1'
const DEFAULT_PORT = Number(process.env.OPENSTUDIO_PORT || 4321)

const command = process.argv[2]

if (command === 'doctor') {
  const { models, problems } = loadModels()
  ensureDataDir()
  const { KieProvider } = await import('../server/providers/kie.js')
  const { readConfig } = await import('../server/store.js')
  const cfg = readConfig()
  const report = await diagnostics({
    port: DEFAULT_PORT,
    models,
    problems,
    provider: cfg.apiKey ? new KieProvider({ apiKey: cfg.apiKey }) : null,
  })
  console.log(JSON.stringify(report, null, 2))
  console.log('\nTen raport nie zawiera klucza API — możesz go wkleić w zgłoszeniu na GitHubie.')
  process.exit(report.dataDirWritable && report.manifestProblems.length === 0 ? 0 : 1)
}

if (command === 'reset-token') {
  const { readConfig, writeConfig } = await import('../server/store.js')
  ensureDataDir()
  readConfig()
  const token = resetSessionToken(writeConfig)
  console.log('Nowy token sesji ustawiony. Stare adresy przestały działać.')
  console.log(`Uruchom aplikację i użyj adresu, który wypisze (kończy się na ?t=${token.slice(0, 6)}…).`)
  process.exit(0)
}

if (command === '--help' || command === 'help') {
  console.log(`OpenStudio — Twoje studio AI na własnym kluczu.

  npx openstudio            uruchamia aplikację i otwiera przeglądarkę
  npx openstudio doctor     raport diagnostyczny (bez klucza API)
  npx openstudio reset-token  nadaje nowy token sesji (stare linki przestają działać)
  npx openstudio --help     ta pomoc

Dane: ${DATA_DIR}`)
  process.exit(0)
}

const port = await freePort(DEFAULT_PORT)
const { readConfig, writeConfig } = await import('../server/store.js')
ensureDataDir()
const token = getOrCreateSessionToken(readConfig, writeConfig)
const app = createApp({ token, port })
app.bootQueue()

serve({ fetch: app.fetch, hostname: HOST, port }, () => {
  const url = `http://${HOST}:${port}/?t=${token}`
  console.log(`\n  OpenStudio działa: ${url}`)
  console.log(`  Twoje pliki: ${DATA_DIR}`)
  console.log('  Zatrzymanie: Ctrl+C\n')
  if (!process.env.OPENSTUDIO_NO_OPEN) {
    import('open').then(({ default: open }) => open(url)).catch(() => {
      console.log('  (Nie udało się otworzyć przeglądarki — skopiuj adres powyżej.)')
    })
  }
})

/** Szuka wolnego portu, żeby „port zajęty” nigdy nie zatrzymało laika. */
async function freePort(start) {
  for (let p = start; p < start + 20; p++) {
    if (await isFree(p)) return p
  }
  return start
}

function isFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once('error', () => resolve(false))
    server.once('listening', () => server.close(() => resolve(true)))
    server.listen(port, HOST)
  })
}
