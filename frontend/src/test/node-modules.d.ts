declare module 'node:fs' {
  interface Dirent {
    name: string
    isDirectory(): boolean
  }
  export function readFileSync(path: string, encoding: 'utf8'): string
  export function readdirSync(path: string, options: { withFileTypes: true }): Dirent[]
}
