#!/usr/bin/env node

const { promisify } = require("util");
const { pipeline, Transform } = require("stream");
const es = require("event-stream");

const pipe = promisify(pipeline);

const parseLine = (s) => {
  const [, key, value] = s.split("│");
  return [key, value].map((s) => s.trim());
};

const parseBlock = (block) =>
  block
    .map((row) => row.flatMap(parseLine))
    .map(([key, ...vals]) => [key, vals.join(" ")]);

class Parser extends Transform {
  constructor() {
    super({ objectMode: true });
    this.row = [];
    this.block = [];
  }
  _transform(chunk, _, done) {
    const line = chunk.toString();

    if (line.indexOf("┌") > -1) {
      this.block = [];
      this.row = [];
    }

    if (line.indexOf("└") > -1) {
      this.block.push(this.row);
      this.push(parseBlock(this.block));
    }

    if (line.indexOf("├") > -1) {
      this.block.push([...this.row]);
      this.row = [];
    }

    if (line.indexOf("│") > -1) {
      this.row.push(line);
    }

    done();
  }
}

class UniqueBy extends Transform {
  constructor(by) {
    super({ objectMode: true });
    this.by = by;
    this.seen = new Set();
  }
  _transform(chunk, _, done) {
    const hash = this.by(chunk);
    if (!this.seen.has(hash)) {
      this.seen.add(hash);
      this.push(chunk);
    }
    done();
  }
}

const removeColors = (s) =>
  s.replace(
    /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g,
    ""
  );

const csvRow = (...cols) => cols.join(";");

async function run(cwd) {
  const { dependencies = {} } = require(`${cwd}/package.json`);
  const dependenciesToCheck = new Set(Object.keys(dependencies));
  console.log(csvRow("package", "severity", "reason", "patchedIn"));
  await pipe(
    process.stdin,
    es.split(),
    es.mapSync(removeColors),
    new Parser(),
    es.mapSync(
      ([[severity, reason], [, package], [, patchedIn], [, dependency]]) => ({
        severity,
        reason,
        package,
        patchedIn,
        dependency,
      })
    ),
    es.filterSync(({ dependency }) => dependenciesToCheck.has(dependency)),
    new UniqueBy(({ package, reason }) => `${package}/${reason}`),
    es.mapSync(
      ({ package, severity, reason, patchedIn }) =>
        `${csvRow(package, severity, reason, patchedIn)}\n`
    ),
    process.stdout
  );
}

run(process.cwd());
