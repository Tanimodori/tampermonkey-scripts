import { injectFetch } from "./hooks";
import { SearchCategory, UICategory } from "./ItemCategory";
import type {
  GarlandItem,
  GarlandItemResponse,
  GarlandSearchItem,
  ItemCategory,
  Package,
  PackageInjector,
  XIVAPIItemResponse,
  XIVAPIItemResult,
} from "./types";

const isCafeMakerPackage = (pkg: Package) => {
  const url = new URL(pkg.url);

  // https://cafemaker.wakingsands.com/search?string=%E5%B0%A4%E6%8B%89%E7%B2%BE%E5%8D%8E&indexes=item&language=chs&filters=ItemSearchCategory.ID%3E=1&columns=ID,Icon,Name,LevelItem,Rarity,ItemSearchCategory.Name,ItemSearchCategory.ID,ItemKind.Name&limit=100&sort_field=LevelItem&sort_order=desc
  if (
    url.hostname === "cafemaker.wakingsands.com" &&
    url.pathname === "/search"
  ) {
    return true;
  }
  return false;
};

const getIconUrl = (iconId: number): string => {
  const padded = iconId.toString().padStart(6, "0");
  return `/i/${padded.substring(0, 3)}000/${padded}.png`;
};

const getItemCategory = (UICategoryId: number): ItemCategory => {
  const category: ItemCategory = {
    Icon: -1,
    UICategory: UICategoryId,
    UICategoryName: "",
    SearchCategory: -1,
    SearchCategoryName: "",
    ParentCategory: -1,
    ParentCategoryName: "",
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

const searchGarlandItem = async (
  item: GarlandSearchItem,
): Promise<XIVAPIItemResult | null> => {
  const result: XIVAPIItemResult = {
    ID: item.id,
    Icon: "",
    ItemKind: {
      Name: "",
    },
    ItemSearchCategory: {
      ID: -1,
      Name: "",
    },
    LevelItem: item.obj.l,
    Name: item.obj.n,
    Rarity: item.obj.r ?? 0,
  };

  try {
    const GARLAND_API_ITEM_ENDPOINT = `https://www.garlandtools.cn/db/doc/item/chs/3/${item.id}.json`;
    const response = await fetch(GARLAND_API_ITEM_ENDPOINT);
    const json: GarlandItemResponse = await response.json();
    const itemDetail: GarlandItem = json.item;

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
    console.error("Failed to parse Garland API response:", e);
  }

  return result;
};

const searchGarland = async (searchString: string) => {
  const newParams = new URLSearchParams({
    text: searchString,
    lang: "chs",
    type: "item",
  });

  const GARLAND_API_SEARCH_ENDPOINT =
    "https://www.garlandtools.cn/api/search.php";

  const response = await fetch(
    `${GARLAND_API_SEARCH_ENDPOINT}?${newParams.toString()}`,
  );
  const data: GarlandSearchItem[] = await response.json();

  const result = await Promise.all(
    data.map(async (item) => await searchGarlandItem(item)),
  );

  return result.filter((item) => item) as XIVAPIItemResult[];
};

const processPackage: PackageInjector = async (pkg) => {
  if (!isCafeMakerPackage(pkg)) {
    return pkg.response;
  }

  const json = pkg.json as XIVAPIItemResponse;
  const searchParams = new URL(pkg.url).searchParams;
  const searchString = searchParams.get("string") || "";

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
