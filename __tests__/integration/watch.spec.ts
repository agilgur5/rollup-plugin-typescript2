import { jest, beforeAll, afterAll, test, expect } from "@jest/globals";
import { Mock } from "jest-mock";
import * as path from "path";
import * as fs from "fs-extra";

import { RPT2Options } from "../../src/index";
import * as helpers from "./helpers";

// increase timeout to 15s for whole file since CI occassionally timed out -- these are integration and cache tests, so longer timeout is warranted
jest.setTimeout(15000);

const local = (x: string) => path.resolve(__dirname, x);
const testDir = local("__temp/watch");
const fixtureDir = `${testDir}/fixtures`;

beforeAll(async () => {
  await fs.ensureDir(fixtureDir);
  // copy the dir to not interfere with other parallel tests since we need to change files for watch mode
  // note we're copying the root fixture dir bc we need the _base_ tsconfig too. we also use the error fixture here as well
  await fs.copy(local("fixtures"), fixtureDir);
});
afterAll(() => fs.remove(testDir));

async function watchBundle(input: string, extraOpts?: RPT2Options, onwarn?: Mock) {
  const dir = path.dirname(input);
  return helpers.watchBundle({
    input,
    tsconfig: `${dir}/tsconfig.json`, // use the tsconfig of whatever fixture we're in
    testDir: `${testDir}/${path.basename(dir)}`, // append the fixture's name
    extraOpts,
    onwarn,
  });
}

test("integration - watch", async () => {
  const onwarn = jest.fn();
  const srcPath = `${fixtureDir}/no-errors/index.ts`;
  const importPath = `${fixtureDir}/no-errors/some-import.ts`;
  const distDir = `${testDir}/no-errors/dist`;
  const distPath = `${distDir}/index.js`;
  const decPath = `${distDir}/index.d.ts`;
  const decMapPath = `${decPath}.map`;
  const filesArr = [
    "index.js",
    "index.d.ts",
    "index.d.ts.map",
    "some-import.d.ts",
    "some-import.d.ts.map",
    "type-only-import.d.ts",
    "type-only-import.d.ts.map",
  ];

  const watcher = await watchBundle(srcPath, {}, onwarn);
  expect(onwarn).toBeCalledTimes(0);

  const files = await fs.readdir(distDir);
  expect(files).toEqual(expect.arrayContaining(filesArr));
  expect(files.length).toBe(filesArr.length); // no other files

  // save content to test against later
  const dist = await fs.readFile(distPath, "utf8");
  const dec = await fs.readFile(decPath, "utf8");
  const decMap = await fs.readFile(decMapPath, "utf8");

  // modify an imported file -- this should cause it and index to change
  await fs.writeFile(importPath, "export const difference = 2", "utf8");
  await helpers.watchEnd(watcher);
  expect(onwarn).toBeCalledTimes(0);

  // should have same structure, since names haven't changed and dist hasn't been cleaned
  const files2 = await fs.readdir(distDir);
  expect(files2).toEqual(expect.arrayContaining(filesArr));
  expect(files2.length).toBe(filesArr.length); // no other files

  // should have different content now though
  expect(dist).not.toEqual(await fs.readFile(distPath, "utf8"));
  expect(dec).not.toEqual(await fs.readFile(decPath, "utf8"));
  expect(decMap).not.toEqual(await fs.readFile(decMapPath, "utf8"));

  // modify an imported file to cause a semantic error
  await fs.writeFile(importPath, "export const difference = nonexistent", "utf8")
  await expect(helpers.watchEnd(watcher)).rejects.toThrow("Cannot find name 'nonexistent'.");
  expect(onwarn).toBeCalledTimes(0);

  await watcher.close();
});

test("integration - watch - abortOnError: false / check: false", async () => {
  const onwarn = jest.fn();
  const srcPath = `${fixtureDir}/errors/semantic.ts`;

  const watcher = await watchBundle(srcPath, {
    include: srcPath,
    abortOnError: false,
  }, onwarn);
  expect(onwarn).toBeCalledTimes(1);

  // either warning or not type-checking should result in the same bundle
  // const { output: output2 } = await genBundle("semantic.ts", { check: false }, onwarn);
  // expect(output).toEqual(output2);

  // expect(output[0].fileName).toEqual("index.js");
  // expect(output[1].fileName).toEqual("semantic.d.ts");
  // expect(output[2].fileName).toEqual("semantic.d.ts.map");
  // expect(output.length).toEqual(3); // no other files
  // expect(onwarn).toBeCalledTimes(1);

  await watcher.close();
});
