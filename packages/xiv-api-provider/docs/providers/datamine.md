# datamine

在线读取 [`InfSein/ffxiv-datamining-mixed`](https://github.com/InfSein/ffxiv-datamining-mixed) 的解包 CSV。这个 provider 不认识任何一张具体的表:它回答"给我这个文件",并把这个文件的网格交出去。要把某张表在构建期就固化进产物,用 `xiv-datamine-polyfill`,它调的就是这里的这几个函数。

## 路线

```
https://raw.githubusercontent.com/InfSein/ffxiv-datamining-mixed/<ref>/<locale>/<Sheet>.csv
```

`ref` 默认 `HEAD`,即分支头。这是"远程更新了下游就能拿到"的落点:数据的新旧由构建时刻决定,而不是由这个包发版时刻决定,也不需要先问 GitHub"最新 release 是哪个"——raw 主机直接按 ref 名服务,同一个 commit sha、一个分支名、或一个 release tag(`v7.56-hf2`)都能填进去,要复现就在配置里写死。

之所以逐文件走 raw 而不是下载 release:release 按 patch 打 tag,但 assets 为空,只有整仓 tarball。

404 在这条路线上是正常答案:`chs` 目录里没有 `DataCenter.csv`(`ItemGroupSpace`、`HouseBirdBanner` 同样缺),某些表只存在于别的语种。因此 `fetchSheetCsv` 把 404 抛成 `NotFoundError` 而不是 `ProviderError` —— "这个语种没这张表"和"请求失败"是两种处理路径。响应正文为空则按 `shape` 失败抛出:空表与"没有这张表"不能长一样。

## CSV 形状

每个 locale 目录扁平放 `<Sheet>.csv`,UTF-8 BOM,前三行是表头:

- 第一行 `key,0,1,…`,列下标(N 列就是 `key` 加 N−1 个下标)。
- 第二行 `#,Name,Icon,Order{Minor},…`,列名。
- 第三行 `int32,str,Image,byte,…`,类型。
- 其后是数据行,主键列 `#`。

三行宽度必须一致,解析时三行都比:只比后两行会放过 `key,0,1` 配 `#,Name` 这种不一致,而那种不一致会让 shortfall 之后的每一列读成"没有这列"而不是"错位"。校验发生在取数的当口,所以一份坏文件不会先被缓存下来、再到某一步读列名时才炸。

三个真实陷阱:

- 带换行的引号值。`Addon.csv` 从第 6 行起有跨行文本与 `<Switch(...)>` 标记,一条记录可以占数十行。分词交给 `csv-parse` 走 RFC 4180,不按行 split;引号未闭合会抛错而不是把文件余下部分吞掉——被静默截断的表看起来跟一次成功的构建一模一样。
- 匿名列与重复列。`ClassJob.csv` 52 列里 16 列没有名字(数组子列),`ClassJobCategory.csv` 末尾也有三个匿名 `bool` 列。列一律按**第二行的下标**寻址,名字只是给人看的。
- `{SubKey}`。`Order{Minor}`、`Modifier{HitPoints}`、`Level{Item}` 是同一列在 API 里的抹平写法(`OrderMinor`),CSV 只保留带大括号的那一种,寻址也就只认那一种。`Name{English}` 的类型是 `byte`,即一个本地化索引——它不是英文名,API 的字符串 `NameEnglish` 在 CSV 里没有对应物,按名字当英文名取会静默产出无意义值。

## 交出去的是数据,读它的是视图

`readSheet` 与 `parseSheetCsv` 的答案是一份纯数据,可以直接 JSON 序列化、缓存、写进产物:

```ts
interface SheetRawData {
  readonly origin: string; // 'ItemUICategory.csv@HEAD'
  readonly data: readonly (readonly string[])[]; // 整张网格,三行表头在内
}
```

`data` 就是文件本身:`data[0]` 是下标行,`data[1]` 是列名,`data[2]` 是类型,其后是数据行。不改名、不换算、不猜语义:列名就是文件里写的(`#`、`Order{Minor}`、空名),值全是字符串(`True` 还是 `'True'`,`60101` 还是 `'60101'`)。理由与体积无关,与诚实有关:上千张表的类型行各有各的拼法,provider 一旦开始"认识"某几张,第二个白名单就种回来了。

要读它就先建视图:

```ts
const sheet = useSheetTable(await readSheet('ItemUICategory'));
sheet.columns; // ['#', 'Name', 'Icon', 'Order{Minor}', 'Order{Major}']
sheet.types; // ['int32', 'str', 'Image', 'byte', 'byte']
sheet.rowCount; // 行数:只有这一个来源,`#` 不保证递增也不保证连续
sheet.cell(1, 'Name'); // 格斗武器 —— 第 1 行,按位置
sheet.row(1); // 那一行的副本
sheet.column('Icon'); // 整列;也可以给下标
```

- 行一律按位置。`#` 有洞(退役的行留洞),位置与键之间没有任何保证,所以行数只有 `rowCount` 一个来源;要按 `#` 查就自己建索引,三行的事:`new Map([...sheet.rows].map((row) => [row[0], row]))`。
- 列可以是下标,也可以是 `columns` 里的原样字符串。重复列名解析到第一次出现,匿名列只能按下标或空串取。
- 找不到就答"没有":`row(i)` 越界给 `undefined`,`cell` 在行或列缺失时给 `undefined`,`column` 给 `[]`。
- 把行变成 `{Name, Icon}` 这一步在调用方:列名与列序都从 `columns` 读,不需要这个包替你决定。

`sheet.trim(rules)` 是唯一会改变表的动作,而它的结果又是 `SheetRawData`:`columns`(顺序即输出顺序)、`onlyRowKeys`(按 `#` 的值选,不是位置)、`dropEmptyIn`(该列为 `''` 的行丢掉,占位行就是这么来的)。列不存在直接抛错并列出该表实际列名;`onlyRowKeys` 里的未知键给空结果,因为"这版没有"本来就有这个形状。裁完仍是合法文件:下标行按留下的列重排(`key` 之后从 `0` 数起),名字行与类型行按同一批列切出。

## 依赖与体积

`csv-parse` 是这个包唯一的运行时依赖,并且**外部化**:`dist/datamine.js` 里只有 `import { parse } from "csv-parse/sync"`,由消费者的打包器自己解析。把它内联进来曾经是 47,423 B(占当时单入口产物的 33.6%),所以 `test/dist-budget.spec.ts` 现在盯着两件事:任何产物都不得内联依赖,且 `csv-parse` 只能被 `datamine` 这一个入口 import。

只导入在线 API 的消费方闭包不含任何 CSV 代码;`datamine` 入口自身加上共享 chunk 的闭包、以及各入口的预算判定见 [数据来源：体积](README.md#体积)。

宽表是真实的体积来源:`ClassJobCategory.csv` 48 列、`ClassJob.csv` 52 列。网格形式已经省掉每行重复的键名(实测:同一批数据 `ClassJob` 前三列是 1,230 B,写成每行一个对象是 2,322 B),进一步缩只有一条路——`trim` 选列,或者在 `xiv-datamine-polyfill` 的构建配置里选。

## 相关链接

- [InfSein/ffxiv-datamining-mixed](https://github.com/InfSein/ffxiv-datamining-mixed)
