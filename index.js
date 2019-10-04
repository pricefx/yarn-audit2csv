#!/usr/bin/env node

const { promisify } = require('util')
const { pipeline, Transform } = require('stream')
const es = require('event-stream')

const pipe = promisify(pipeline)

class Parser extends Transform {
  constructor() {
    super({ objectMode: true })
    this.inside = false
    this.block = []
  }
  _transform (chunk, _, done) {
    const line = chunk.toString()

    if (line.indexOf('└') > -1) {
      this.push(this.block)
      this.block = []
      this.inside = false
    }

    if (this.inside) this.block.push(line)

    if (line.indexOf('┌') > -1) {
      this.inside = true
    }

    done()
  }
}

class UniqueBy extends Transform {
  constructor(by) {
    super({ objectMode: true })
    this.by = by
    this.seen = new Set()
  }
  _transform (chunk, _, done) {
    const hash = this.by(chunk)
    if (!this.seen.has(hash)) {
      this.seen.add(hash)
      this.push(chunk)
    }
    done()
  }
}

const removeColors = (s) =>
  s.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '')

const parseLine = (s) => {
  const [, key, value] = s.split('│')
  return [key, value].map((s) => s.trim())
}

async function run(cwd) {
  const { dependencies = {} } = require(`${cwd}/package.json`)
  const dependenciesToCheck = new Set(Object.keys(dependencies))
  await pipe(
    process.stdin,
    es.split(),
    es.mapSync(removeColors),
    new Parser(),
    es.mapSync(([reasonLine,, packageLine,, patchedInLine,, dependencyLine]) => {
      const [severity, reason] = parseLine(reasonLine)
      const [, package] = parseLine(packageLine)
      const [, patchedIn] = parseLine(patchedInLine)
      const [, dependency] = parseLine(dependencyLine)
      return { severity, reason, package, patchedIn, dependency }
    }),
    es.filterSync(({ dependency }) => dependenciesToCheck.has(dependency)),
    new UniqueBy(({ package, reason }) => `${package}/${reason}`),
    es.mapSync(({ package, severity, reason, patchedIn }) => 
      [package, severity, reason, patchedIn].join('; ') + '\n'
    ),
    process.stdout
  )
}

run(process.cwd())
