# tampermonkey-scripts

Javascript userscripts for various websites, plus the occasional backend service.

## Userscripts

| Package | Description |
| --- | --- |
| [fflogs-scripts](scripts/fflogs-scripts/README.md) | FFLogs scripts for personal use |
| [tenhou-pairi-kokei-display](scripts/tenhou-pairi-kokei-display/README.md) | Display Kokei percentage of ii-shan-ten in Tenhou-Pairi |
| [universalis-zh-data](scripts/universalis-zh-data/README.md) | Universalis Chinese data redirection script |
| [xivanalysis-zh](scripts/xivanalysis-zh/README.md) | Display actions and status of xivanalysis report in Chinese |
| [feishu-download](scripts/feishu-download/README.md) | Download audio and image resources from Feishu pages |

## Libraries

| Package | Description |
| --- | --- |
| [xiv-api-provider](packages/xiv-api-provider/README.md) | Online access to xivapi, the Garland Tools mirror and the datamining CSV dumps |
| [xiv-datamine-polyfill](packages/xiv-datamine-polyfill/README.md) | Vite plugin turning a datamining sheet import into a build-time generated module |
| [vite-plugin-userscript-metadata](packages/vite-plugin-userscript-metadata/README.md) | Vite plugin generating the userscript metadata block in front of each entry bundle |
| [tencent-doc-sdk](packages/tencent-doc-sdk/README.md) | Client for the Tencent Docs Open API smartsheet endpoints |

## Services

| Package | Description |
| --- | --- |
| [occult-pot-server](packages/occult-pot-server/README.md) | Express API proxying the Tencent Docs smartsheet of occult pot refresh times |

## Tests

- [xiv-datamine-polyfill-e2e-test](tests/xiv-datamine-polyfill-e2e-test/README.md) — Consumer-side example project and Vite end-to-end checks for `xiv-api-provider` and `xiv-datamine-polyfill`

## Build

`rush build`
