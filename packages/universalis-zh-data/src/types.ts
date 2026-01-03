// Major types

export interface Package<T = object> {
  url: string;
  response: Response;
  json: T;
}

export type PackageInjector = (pkg: Package) => Promise<Response>;

export interface ItemCategory {
  Icon: number;
  UICategory: number;
  UICategoryName: string;
  SearchCategory: number;
  SearchCategoryName: string;
  ParentCategory: number;
  ParentCategoryName: string;
}

// Garland API types
export interface GarlandSearchItem {
  id: number;
  type: string;
  obj: {
    i: number;
    n: string;
    c: number;
    j?: number | null;
    t: number;
    l: number;
    r?: number;
    g?: number;
  };
}

export interface NameDescObject {
  name: string;
  description: string;
}

export interface GarlandItem {
  name: string;
  description: string;
  jobCategories: string;
  id: number;
  en: NameDescObject;
  ja: NameDescObject;
  fr: NameDescObject;
  de: NameDescObject;
  patch: number;
  category: number;
  price: number;
  ilvl: number;
  dyecount: number;
  tradeable?: number;
  sell_price: number;
  rarity: number;
  stackSize: number;
  repair: number;
  equip: number;
  repair_item: number;
  glamourous: number;
  slot: number;
  elvl: number;
  jobs: number;
  models: string[];
  attr: Record<string, number>;
  icon: number;
  vendors: number[];
  upgrades: number[];
}

export interface GarlandItemResponse {
  item: GarlandItem;
  partials: GarlandSearchItem[];
}

// XIVAPI types
export interface XIVAPIPagination {
  Page: number;
  PageNext: number | null;
  PagePrev: number | null;
  PageTotal: number;
  Results: number;
  ResultsPerPage: number;
  ResultsTotal: number;
}

export interface XIVAPIItemResult {
  ID: number;
  Icon: string;
  ItemKind: {
    Name: string;
  };
  ItemSearchCategory: {
    ID: number;
    Name: string;
  };
  LevelItem: number;
  Name: string;
  Rarity: number;
}

export interface XIVAPIItemResponse {
  Pagination: XIVAPIPagination;
  Results: XIVAPIItemResult[];
  SpeedMs: number;
}
