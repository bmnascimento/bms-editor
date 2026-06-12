const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadCurrentCore() {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const script = html.match(/<script type="text\/babel">([\s\S]*?)<\/script>/)[1];
  const start = script.indexOf("const ROWS");
  const end = script.indexOf("function fColor");
  const source = `${script.slice(start, end)}
    globalThis.BMSCore = {
      parseBMS, genBMS, parseTimestamp,
      normalizeField, validateSymbol, sanitizeSymbol, validateMapset, clampGroupDelta
    };`;
  const context = { console };
  vm.createContext(context);
  vm.runInContext(source, context);
  return context.BMSCore;
}

const core = loadCurrentCore();

const SOURCE_WITH_EXTRAS = [
  "MS1      DFHMSD TYPE=&SYSPARM,MAPATTS=(COLOR,HILIGHT),",
  "               DSATTS=(COLOR),TERM=3270",
  "MAP1     DFHMDI SIZE=(24,80),JUSTIFY=LEFT",
  "F1       DFHMDF POS=(01,01),LENGTH=005,ATTRB=(UNPROT),OUTLINE=BOX",
  "MS1      DFHMSD TYPE=FINAL",
  "         END",
].join("\n");

test("preserves supported and unknown operands during round trip", () => {
  const generated = core.genBMS(core.parseBMS(SOURCE_WITH_EXTRAS));
  assert.match(generated, /MAPATTS=\(COLOR,HILIGHT\)/);
  assert.match(generated, /DSATTS=\(COLOR\)/);
  assert.match(generated, /TERM=3270/);
  assert.match(generated, /JUSTIFY=LEFT/);
  assert.match(generated, /OUTLINE=BOX/);
});

test("rejects input that does not contain an editable BMS map", () => {
  assert.throws(() => core.parseBMS("hello world"), /BMS|DFHMDI/i);
  assert.throws(() => core.parseBMS(""), /BMS|DFHMDI/i);
});

test("escapes and restores apostrophes in quoted operands", () => {
  const mapset = core.parseBMS(SOURCE_WITH_EXTRAS);
  mapset.maps[0].fields[0].initial = "DON'T";
  mapset.maps[0].fields[0].picin = "X'X";
  const generated = core.genBMS(mapset);
  assert.match(generated, /INITIAL='DON''T'/);
  assert.match(generated, /PICIN='X''X'/);
  const reparsed = core.parseBMS(generated);
  assert.equal(reparsed.maps[0].fields[0].initial, "DON'T");
  assert.equal(reparsed.maps[0].fields[0].picin, "X'X");
});

test("accepts macros regardless of case", () => {
  const parsed = core.parseBMS(SOURCE_WITH_EXTRAS.toLowerCase());
  assert.equal(parsed.name, "ms1");
  assert.equal(parsed.maps[0].name, "map1");
  assert.equal(parsed.maps[0].fields[0].name, "f1");
});

test("formats only valid 14-digit timestamps", () => {
  assert.equal(core.parseTimestamp("* TIMESTAMP=12345620260612").display, "12/06/2026 12:34:56");
  assert.equal(core.parseTimestamp("* TIMESTAMP=123456202606"), null);
});

test("normalizes fields so they remain inside the 24x80 grid", () => {
  assert.equal(typeof core.normalizeField, "function");
  assert.deepEqual(
    { ...core.normalizeField({ row: 30, col: 80, length: 40, initial: "X".repeat(100) }) },
    { row: 24, col: 80, length: 1, initial: "X" }
  );
});

test("validates assembler symbols", () => {
  assert.equal(typeof core.validateSymbol, "function");
  assert.equal(core.validateSymbol("CAMPO001"), true);
  assert.equal(core.validateSymbol("@FIELD"), true);
  assert.equal(core.validateSymbol("1FIELD"), false);
  assert.equal(core.validateSymbol("TOO_LONG_1"), false);
  assert.equal(core.sanitizeSymbol("123-field_name"), "FIELDNAM");
});

test("rejects duplicate named fields", () => {
  const duplicate = SOURCE_WITH_EXTRAS.replace(
    "MS1      DFHMSD TYPE=FINAL",
    "F1       DFHMDF POS=(02,01),LENGTH=005\nMS1      DFHMSD TYPE=FINAL"
  );
  assert.throws(() => core.parseBMS(duplicate), /duplicado/i);
});

test("clamps group movement while preserving relative spacing", () => {
  assert.equal(typeof core.clampGroupDelta, "function");
  const fields = [
    { row: 1, col: 70, length: 5 },
    { row: 2, col: 75, length: 5 },
  ];
  assert.deepEqual({ ...core.clampGroupDelta(fields, 20, -5) }, { dC: 1, dR: 0 });
});
