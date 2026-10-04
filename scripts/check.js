// Syntax-checks every JavaScript file in the app. Files under public/ are ES modules (public/package.json).
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const files = ['server.js']
const walk = dir => {
  for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const relative = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(relative)
    else if (entry.name.endsWith('.js')) files.push(relative)
  }
}
for (const dir of ['lib', 'scripts', 'public']) walk(dir)

let failed = 0
for (const file of files) {
  try { execFileSync(process.execPath, ['--check', path.join(root, file)], { stdio: 'pipe' }) } catch (error) {
    failed++
    process.stderr.write(`${file}\n${error.stderr}\n`)
  }
}
console.log(`${files.length - failed}/${files.length} files passed.`)
process.exitCode = failed ? 1 : 0
