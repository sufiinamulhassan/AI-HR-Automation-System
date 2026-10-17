import { createWriteStream } from 'node:fs'
import { cp, mkdir, stat } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import { Readable } from 'node:stream'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const WASM_SRC = resolve(ROOT, 'node_modules/@mediapipe/tasks-vision/wasm')
const WASM_DEST = resolve(ROOT, 'public/mediapipe/wasm')
const FACE_MODEL_DEST = resolve(ROOT, 'public/models/face_landmarker.task')
const FACE_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'
const OBJECT_MODEL_DEST = resolve(ROOT, 'public/models/object_detector.tflite')
const OBJECT_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite2/int8/1/efficientdet_lite2.tflite'

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
    throw new Error(`@mediapipe/tasks-vision wasm assets not found at ${WASM_SRC}, run npm install first`)
  }
  await mkdir(WASM_DEST, { recursive: true })
  await cp(WASM_SRC, WASM_DEST, { recursive: true })
  console.log('[mediapipe] wasm runtime to public/mediapipe/wasm')
}

async function fetchAsset(dest, url, label) {
  if (await exists(dest)) {
    console.log(`[mediapipe] ${label} already present, skipping download`)
    return
  }
  await mkdir(dirname(dest), { recursive: true })
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to download ${label}: HTTP ${res.status}`)
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest))
  console.log(`[mediapipe] ${label} to public/models`)
}

await copyWasm()
await fetchAsset(FACE_MODEL_DEST, FACE_MODEL_URL, 'face_landmarker.task')
await fetchAsset(OBJECT_MODEL_DEST, OBJECT_MODEL_URL, 'object_detector.tflite')
