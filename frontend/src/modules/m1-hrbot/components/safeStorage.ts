export function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

export function writeStored(key: string, value: string): boolean {
  try {
    window.localStorage.setItem(key, value)
    return true
  } catch {
    return false
  }
}

export function removeStored(key: string): void {
  try {
    window.localStorage.removeItem(key)
  } catch {
  }
}

export function readStoredJson(key: string): unknown {
  const text = readStored(key)
  if (text === null) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

export function writeStoredJson(key: string, value: unknown): boolean {
  try {
    return writeStored(key, JSON.stringify(value))
  } catch {
    return false
  }
}
