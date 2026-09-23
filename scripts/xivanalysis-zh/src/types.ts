// 只建模两样东西:拦截层用的 `Package`,以及被拦截的 xivapi.com 响应(`XIVAPI*`)。
// 数据源(Garland / 国服 xivapi)的类型一律来自 `xiv-api-provider`,这里不再手写。

export interface Package<T = object> {
  url: string;
  response: Response;
  json: T;
}

export type PackageInjector = (pkg: Package) => Promise<Response>;

// XIVAPI types

export interface XIVAPIResponse<T> {
  schema: string;
  rows: T[];
}

// Action, Item, and Status are all the same structure
export interface XIVAPIObject {
  row_id: number;
  fields: {
    Icon: {
      id: number;
      path: string;
      path_hr1: string;
    };
    Name: string;
    'Description@as(html)'?: string;
  };
}

export interface XIVAPIObjectResponse extends XIVAPIResponse<XIVAPIObject> {}

export interface XIVAPIActionField {
  value: number;
  sheet: string;
  row_id: number;
  fields: {
    [key: string]: string;
  };
}

// Rich Action data
export interface XIVAPIActionRich {
  row_id: number;
  fields: {
    ActionCategory: XIVAPIActionField;
    Cast100ms: number;
    ClassJob: XIVAPIActionField;
    ClassJobCategory: XIVAPIActionField;
    ClassJobLevel: number;
    EffectRange: number;
    Icon: {
      id: number;
      path: string;
      path_hr1: string;
    };
    Name: string;
    PrimaryCostType: number;
    PrimaryCostValue: number;
    Range: number;
    Recast100ms: number;
  };
  transient: {
    'Description@as(html)': string;
  };
}

export interface XIVAPIAddon {
  row_id: number;
  fields: {
    Text: string;
  };
}
