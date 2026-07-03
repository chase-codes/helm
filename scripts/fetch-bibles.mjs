// Fetches the bundled KJV bible from getbible.net and writes it to
// resources/bibles/kjv.json. Run with: node scripts/fetch-bibles.mjs
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const KJV_URL = 'https://api.getbible.net/v2/kjv.json'
const OUT_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'resources',
  'bibles',
  'kjv.json'
)

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- plain JS script
async function main() {
  console.log(`Fetching ${KJV_URL} ...`)
  const res = await fetch(KJV_URL, { signal: AbortSignal.timeout(60_000) })
  if (!res.ok) {
    throw new Error(`Failed to fetch ${KJV_URL}: ${res.status} ${res.statusText}`)
  }
  const text = await res.text()
  const data = JSON.parse(text)

  if (!Array.isArray(data.books) || data.books.length !== 66) {
    throw new Error(`Sanity check failed: expected 66 books, got ${data.books?.length}`)
  }

  writeFileSync(OUT_PATH, text)
  console.log(`Wrote ${OUT_PATH} (${data.books.length} books)`)
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
