import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'

/** Katalog danych użytkownika: wszystko, co robi aplikacja, leży tutaj. */
export const DATA_DIR = process.env.OPENSTUDIO_HOME
  ? path.resolve(process.env.OPENSTUDIO_HOME)
  : path.join(os.homedir(), 'OpenStudio')

export const CONFIG_FILE = path.join(DATA_DIR, 'config.json')
export const JOBS_FILE = path.join(DATA_DIR, 'jobs.json')
export const LEDGER_FILE = path.join(DATA_DIR, 'ledger.json')
export const LIBRARY_DIR = path.join(DATA_DIR, 'library')
export const BOARDS_DIR = path.join(DATA_DIR, 'boards')
export const BOARDS_FILE = path.join(DATA_DIR, 'boards.json')
export const UPLOADS_FILE = path.join(DATA_DIR, 'uploads.json')

export function ensureDataDir() {
  fs.mkdirSync(LIBRARY_DIR, { recursive: true })
  fs.mkdirSync(BOARDS_DIR, { recursive: true })
  return DATA_DIR
}

/** Folder z inspiracjami jednej tablicy. */
export function boardDir(boardId) {
  const dir = path.join(BOARDS_DIR, boardId)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

/** Pliki, które wolno pokazać w przeglądarce: biblioteka i tablice. */
export const SERVABLE_DIRS = [LIBRARY_DIR, BOARDS_DIR]

/** Folder biblioteki na dany miesiąc: library/2026-09/ */
export function monthDir(date = new Date()) {
  const m = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
  const dir = path.join(LIBRARY_DIR, m)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}
