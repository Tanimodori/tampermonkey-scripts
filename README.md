# tampermonkey-scripts

Javascript userscripts for various websites, plus the occasional backend service.

## Packages

| Package | Description |
| --- | --- |
| [fflogs-scripts](packages/fflogs-scripts/README.md) | FFLogs scripts for personal use |
| [tenhou-pairi-kokei-display](packages/tenhou-pairi-kokei-display/README.md) | Display Kokei percentage of ii-shan-ten in Tenhou-Pairi |
| [universalis-zh-data](packages/universalis-zh-data/README.md) | Universalis Chinese data redirection script |
| [xivanalysis-zh](packages/xivanalysis-zh/README.md) | Display actions and status of xivanalysis report in Chinese |
| [feishu-download](packages/feishu-download/README.md) | Download audio and image resources from Feishu pages |
| [occult-pot-server](packages/occult-pot-server/README.md) | Express API proxying the Tencent Docs smartsheet of occult pot refresh times |
| [xiv-api-provider](packages/xiv-api-provider/README.md) | Online access to xivapi, the Garland Tools mirror and the datamining CSV dumps |
| [xiv-datamine-polyfill](packages/xiv-datamine-polyfill/README.md) | Vite plugin turning a datamining sheet import into a build-time generated module |
| [vite-plugin-userscript-metadata](packages/vite-plugin-userscript-metadata/README.md) | Vite plugin generating the userscript metadata block in front of each entry bundle |
| [tencent-doc-sdk](packages/tencent-doc-sdk/README.md) | Client for the Tencent Docs Open API smartsheet endpoints |

## Tests

- [xiv-datamine-polyfill-e2e-test](tests/xiv-datamine-polyfill-e2e-test/README.md) — Consumer-side example project and Vite end-to-end checks for `xiv-api-provider` and `xiv-datamine-polyfill`

## Build

`rush build`
