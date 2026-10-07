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

// Garland 的形状（GarlandSearchItem / GarlandItem 等）现在从 xiv-garland-provider 取，本文件不再重复声明。

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
