/**
 * Vendors the MediaPipe proctoring assets into public/ so the interview page
 * never depends on a third-party CDN at runtime.
 *
 * A live interview cannot tolerate a remote asset host being slow, blocked by
 * a corporate proxy, or simply down - the previous face-api implementation
 * pulled its model weights from a maintainer's GitHub Pages site on every
 * session. These assets are ~15 MB, so they are fetched/copied at build time
 * and gitignored rather than committed.
 *
 * Runs automatically via the `predev` / `prebuild` npm scripts.
 */
import { createWriteStream } from 'node:fs'
import { cp, mkdir, stat } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import { Readable } from 'node:stream'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const WASM_SRC = resolve(ROOT, 'node_modules/@mediapipe/tasks-vision/wasm')
const WASM_DEST = resolve(ROOT, 'public/mediapipe/wasm')
const MODEL_DEST = resolve(ROOT, 'public/models/face_landmarker.task')
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'

async function exists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function copyWasm() {
  if (!(await exists(WASM_SRC))) {
    throw new Error(`@mediapipe/tasks-vision wasm assets not found at ${WASM_SRC} - run npm install first`)
  }
  await mkdir(WASM_DEST, { recursive: true })
  await cp(WASM_SRC, WASM_DEST, { recursive: true })
  console.log('[mediapipe] wasm runtime → public/mediapipe/wasm')
}

async function fetchModel() {
  if (await exists(MODEL_DEST)) {
    console.log('[mediapipe] face_landmarker.task already present - skipping download')
    return
  }
  await mkdir(dirname(MODEL_DEST), { recursive: true })
  const res = await fetch(MODEL_URL)
  if (!res.ok) throw new Error(`Failed to download face landmarker model: HTTP ${res.status}`)
  await pipeline(Readable.fromWeb(res.body), createWriteStream(MODEL_DEST))
  console.log('[mediapipe] face_landmarker.task → public/models')
}

await copyWasm()
await fetchModel()
