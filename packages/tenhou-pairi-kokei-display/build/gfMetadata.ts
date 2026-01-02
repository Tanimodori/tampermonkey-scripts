/// <reference types="node" />

import fs from 'fs';
import { resolve } from 'path';
import { PluginOption } from 'vite';
import pkg from '../package.json';

const metadata = `// ==UserScript==
// @name         天鳳牌理好形表示
// @name:zh      天凤牌理好形表示
// @name:zh-CN   天凤牌理好形表示
// @name:zh-TW   天鳳牌理好形表示
// @name:en      Tenhou-Pairi Kokei display
// @namespace    http://tanimodori.com/
// @version      ${pkg.version}
// @description  天鳳牌理で一向聴の好形率を表示する
// @description:zh  在天凤牌理中显示好形率
// @description:zh-CN  在天凤牌理中显示好形率
// @description:zh-TW  在天鳳牌理中顯示好形率
// @description:en  Display Kokei percentage of ii-shan-ten in Tenhou-Pairi
// @author       ${pkg.author}
// @match        http://tenhou.net/2/*
// @match        https://tenhou.net/2/*
// @include      http://tenhou.net/2/*
// @include      https://tenhou.net/2/*
// @grant        none
// @license      ${pkg.license}
// ==/UserScript==
`;

const plugin: PluginOption = {
  name: 'vite-plugin-greasyfork-metadata',
  writeBundle(options, bundle) {
    // get entry file name
    let entryFileNames = options.entryFileNames;
    if (typeof entryFileNames === 'function') {
      console.log(`[greasyfork-metadata] cannot resolve entryFileNames, using 'index.js'`);
      entryFileNames = 'index.js';
    }

    // get entry file code
    if (!(entryFileNames in bundle)) {
      console.log(`[greasyfork-metadata] cannot resolve entryFileNames code`);
      return;
    }
    const chunk = bundle[entryFileNames];
    if (!('code' in chunk)) {
      console.log(`[greasyfork-metadata] cannot resolve entryFileNames code`);
      return;
    }

    // get output file name
    const outputFileName = options.dir ? resolve(options.dir, entryFileNames) : entryFileNames;

    // overwrite bundle
    fs.writeFileSync(outputFileName, metadata + chunk.code);
  },
};

export default plugin;
