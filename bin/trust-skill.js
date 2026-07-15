#!/usr/bin/env node
import { cli } from '../dist/src/cli.js'

cli(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(`error: ${err?.message ?? err}\n`)
    process.exit(1)
  },
)
