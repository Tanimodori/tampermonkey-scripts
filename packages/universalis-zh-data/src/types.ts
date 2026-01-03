// Major types

export interface Package<T = object> {
  url: string;
  response: Response;
  json: T;
}

export type PackageInjector = (pkg: Package) => Promise<Response>;

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
  };
}

// XIVAPI types
