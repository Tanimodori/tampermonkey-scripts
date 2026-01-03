import { injectFetch } from "./hooks";
import { Package, PackageInjector } from "./types";

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

const processPackage: PackageInjector = async (pkg) => {
  if (!isCafeMakerPackage(pkg)) {
    return pkg.response;
  }

  const searchParams = new URL(pkg.url).searchParams;
  const searchString = searchParams.get("string") || "";

  console.log(
    `[universalis-zh-data] processing CafeMaker package: ${searchString}`,
  );

  // fallback
  return pkg.response;
};

injectFetch(processPackage);
