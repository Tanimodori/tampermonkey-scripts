/// <reference types="node" />

import fs from "fs";
import { resolve } from "path";
import { PluginOption } from "vite";
import pkg from "../package.json";

const metadata = `// ==UserScript==
// @name         universalis-zh-data
// @name:zh      Universalis 中文数据
// @namespace    http://tanimodori.com/
// @version      ${pkg.version}
// @description  Universalis Chinese data localization script
// @description:zh Universalis 中文数据引入脚本
// @author       ${pkg.author}
// @match        https://universalis.app/*
// @include      https://universalis.app/*
// @grant        none
// @run-at       document-start
// @license      ${pkg.license}
// ==/UserScript==
`;

const plugin: PluginOption = {
  name: "vite-plugin-greasyfork-metadata",
  writeBundle(options, bundle) {
    // get entry file name
    let entryFileNames = options.entryFileNames;
    if (typeof entryFileNames === "function") {
      console.log(
        `[greasyfork-metadata] cannot resolve entryFileNames, using 'index.js'`,
      );
      entryFileNames = "index.js";
    }

    // get entry file code
    if (!(entryFileNames in bundle)) {
      console.log(`[greasyfork-metadata] cannot resolve entryFileNames code`);
      return;
    }
    const chunk = bundle[entryFileNames];
    if (!("code" in chunk)) {
      console.log(`[greasyfork-metadata] cannot resolve entryFileNames code`);
      return;
    }

    // get output file name
    const outputFileName = options.dir
      ? resolve(options.dir, entryFileNames)
      : entryFileNames;

    // overwrite bundle
    fs.writeFileSync(outputFileName, metadata + chunk.code);
  },
};

export default plugin;
