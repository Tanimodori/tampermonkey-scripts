import { injectFetch } from './hooks';
import { SearchCategory, UICategory } from './ItemCategory';
import type {
  GarlandItem,
  GarlandItemResponse,
  GarlandSearchItem,
  ItemCategory,
  Package,
  PackageInjector,
  XIVAPIItemResponse,
  XIVAPIItemResult,
} from './types';

const isCafeMakerPackage = (pkg: Package) => {
  const url = new URL(pkg.url);

  // https://cafemaker.wakingsands.com/search?string=%E5%B0%A4%E6%8B%89%E7%B2%BE%E5%8D%8E&indexes=item&language=chs&filters=ItemSearchCategory.ID%3E=1&columns=ID,Icon,Name,LevelItem,Rarity,ItemSearchCategory.Name,ItemSearchCategory.ID,ItemKind.Name&limit=100&sort_field=LevelItem&sort_order=desc
  if (url.hostname === 'cafemaker.wakingsands.com' && url.pathname === '/search') {
    return true;
  }
  return false;
};

const getIconUrl = (iconId: number): string => {
  const padded = iconId.toString().padStart(6, '0');
  return `/i/${padded.substring(0, 3)}000/${padded}.png`;
};

/**
 * 分类取数的现状与一次实测结论（2026-10）。
 *
 * universalis 那行两级分类，第一段是 `ItemSearchCategory.Name`、第二段是 `ItemKind.Name`（即 ItemUICategory
 * 名），两段都由这里填。ItemUICategory 的 id 是可信的：garland 文档的 `category` 就是它，与 xivapi 逐条核对过
 * （19890 → 44 药品）。ItemSearchCategory 的 id 则没有来源——garland 的 item 文档里根本没有这一档。
 *
 * 文档里另有一个 `patchCategory`，看着像但它不是：实测是 garland 自己的索引分组，值域 0…17。
 *
 * | 物品 | `category` | `patchCategory` | xivapi 权威 `ItemSearchCategory.ID` |
 * | --- | --- | --- | --- |
 * | 19890 意力之药汤 | 44 | 4 | 43 |
 * | 4213 白银耳环 | 41 | 2 | 40 |
 * | 4700 玉米面包 | 46 | 6 | 45 |
 * | 8000 直线踏脚木 | 76 | 9 | 67 |
 * | 2157 以太山羊革魔导书 | 10 | 0 | 空 |
 * | 36000 永暗猞猁魔笛 | 63 | 17 | 空 |
 *
 * 前三行的真 id 恰为 `category − 1`，是容易认错的地方；但同一个 `category=63` 既给 5（神典石）又给 17（魔笛），
 * 说明 `patchCategory` 不是物品分类的函数，也不能拿来当 id 用。
 *
 * 所以下面只能继续按 Icon 猜，而这一层本身也不可靠：循环没有 `break`，取的是**最后**一个同 Icon 的行，室外家具
 * 这类批量复用 Icon 的分组会成批错配。原先用两份已提交 CSV 逐行证明这件事的测试（xiv-datamine-polyfill 的
 * `test/acceptance.spec.ts`）已删除，结论只剩这里。
 *
 * 真正的修法是不要猜：被拦截的 cafemaker 搜索响应本来就带权威 id——上面那条示例 URL 的 `columns` 里有
 * `ItemSearchCategory.ID`，`filters` 又是 `ItemSearchCategory.ID>=1`，可见交给 universalis 的每一行都有搜索分类。
 * 现在这段把原响应的行整条丢掉、用 garland 重建 `Results`，才只能靠 Icon 反推。迁移时按 item id 把原响应的 id
 * 接回来，名称仍按 id 查 `ItemCategory.ts` 换中文，下面这段 Icon 匹配整段删掉。cafemaker 目前已失效（本机请求返回
 * `error code: 1016`），迁移另开一次做。
 */
const getItemCategory = (UICategoryId: number): ItemCategory => {
  const category: ItemCategory = {
    Icon: -1,
    UICategory: UICategoryId,
    UICategoryName: '',
    SearchCategory: -1,
    SearchCategoryName: '',
    ParentCategory: -1,
    ParentCategoryName: '',
  };

  // Search in UICategory
  const target = UICategory[UICategoryId];
  if (target) {
    category.Icon = target.Icon;
    category.UICategoryName = target.UICategoryName;
  }

  // Search in SearchCategory
  if (category.Icon !== 0) {
    for (const target of Object.values(SearchCategory)) {
      // match by Icon
      if (target.Icon === category.Icon) {
        category.SearchCategory = target.SearchCategory;
        category.SearchCategoryName = target.SearchCategoryName;
        category.ParentCategory = target.ParentCategory;
        const parent = SearchCategory[category.ParentCategory];
        if (parent) {
          category.ParentCategoryName = parent.SearchCategoryName;
        }
      }
    }
  }

  return category;
};

const getGarlandItem = async (itemId: number): Promise<GarlandItem> => {
  const GARLAND_API_ITEM_ENDPOINT = `https://www.garlandtools.cn/db/doc/item/chs/3/${itemId}.json`;
  const response = await fetch(GARLAND_API_ITEM_ENDPOINT);
  const json: GarlandItemResponse = await response.json();
  return json.item;
};

const searchGarlandItem = async (item: GarlandSearchItem): Promise<XIVAPIItemResult | null> => {
  const result: XIVAPIItemResult = {
    ID: item.id,
    Icon: '',
    ItemKind: {
      Name: '',
    },
    ItemSearchCategory: {
      ID: -1,
      Name: '',
    },
    LevelItem: item.obj.l,
    Name: item.obj.n,
    Rarity: item.obj.r ?? 0,
  };

  try {
    const itemDetail = await getGarlandItem(item.id);
    if (itemDetail.tradeable !== 1) {
      return null;
    }

    // set fields
    result.Icon = getIconUrl(itemDetail.icon);
    result.Rarity = itemDetail.rarity;

    // category mapping
    const category = getItemCategory(itemDetail.category);
    result.ItemKind.Name = category.UICategoryName;
    result.ItemSearchCategory.ID = category.SearchCategory;
    result.ItemSearchCategory.Name = category.SearchCategoryName;
  } catch (e) {
    console.error('Failed to parse Garland API response:', e);
  }

  return result;
};

const searchGarland = async (searchString: string) => {
  const newParams = new URLSearchParams({
    text: searchString,
    lang: 'chs',
    type: 'item',
  });

  const GARLAND_API_SEARCH_ENDPOINT = 'https://www.garlandtools.cn/api/search.php';

  const response = await fetch(`${GARLAND_API_SEARCH_ENDPOINT}?${newParams.toString()}`);
  const data: GarlandSearchItem[] = await response.json();

  const result = await Promise.all(data.map(async (item) => await searchGarlandItem(item)));

  return result.filter((item) => item) as XIVAPIItemResult[];
};

const processPackage: PackageInjector = async (pkg) => {
  if (!isCafeMakerPackage(pkg)) {
    return pkg.response;
  }

  const json = pkg.json as XIVAPIItemResponse;
  const searchParams = new URL(pkg.url).searchParams;
  const searchString = searchParams.get('string') || '';

  // fetch item IDs from Garland API
  const result = await searchGarland(searchString);
  if (result.length > 0) {
    const resultJson: XIVAPIItemResponse = {
      ...json,
      Pagination: {
        ...json.Pagination,
        Results: result.length,
        ResultsTotal: result.length,
      },
      Results: result,
    };
    return new Response(JSON.stringify(resultJson));
  }

  // fallback
  return pkg.response;
};

injectFetch(processPackage);

const getIconElement = (): HTMLImageElement | null => {
  return document.querySelector<HTMLImageElement>('img.item-icon');
};

const injectItemImage = () => {
  document.addEventListener('DOMContentLoaded', async () => {
    let iconUrl = '';
    let threshold = 100;

    const getIconUrl = async () => {
      if (iconUrl) {
        return;
      }
      // https://universalis.app/market/46246
      const id = parseInt(document.location.pathname.split('/').pop() || '0');
      const itemDetail = await getGarlandItem(id);
      iconUrl = `https://www.garlandtools.cn/files/icons/item/${itemDetail.icon}.png`;
    };

    const check = async () => {
      const currentImg = getIconElement();
      // no img, keep checking
      if (!currentImg) {
        requestAnimationFrame(check);
        return;
      }
      // wrong img, replace and keep checking
      const url = new URL(currentImg.src);
      if (url.pathname === '/i/universalis/error.png') {
        await getIconUrl();
        currentImg.src = iconUrl;
        requestAnimationFrame(check);
        return;
      }
      // not loaded yet, keep checking
      if (currentImg.complete === false) {
        requestAnimationFrame(check);
        return;
      }
      // wait until threshold expires
      --threshold;
      if (threshold) {
        requestAnimationFrame(check);
        return;
      }
    };

    requestAnimationFrame(check);
  });
};

injectItemImage();
