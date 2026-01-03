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

const getGarlandItem = async (itemId: number): Promise<GarlandItem> => {
  const GARLAND_API_ITEM_ENDPOINT = `https://www.garlandtools.cn/db/doc/item/chs/3/${itemId}.json`;
  const response = await fetch(GARLAND_API_ITEM_ENDPOINT);
  const json: GarlandItemResponse = await response.json();
  return json.item;
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

const getIconElement = (): HTMLImageElement | null => {
  return document.querySelector<HTMLImageElement>("img.item-icon");
};

const injectItemImage = () => {
  document.addEventListener("DOMContentLoaded", async () => {
    let iconUrl = "";
    let threshold = 100;

    const getIconUrl = async () => {
      if (iconUrl) {
        return;
      }
      // https://universalis.app/market/46246
      const id = parseInt(document.location.pathname.split("/").pop() || "0");
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
      if (url.pathname === "/i/universalis/error.png") {
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
