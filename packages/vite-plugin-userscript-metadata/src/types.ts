/** One line's worth of metadata value: a string, a number, or a boolean flag. */
export type MetaScalar = string | number | boolean;

/**
 * A meta key's value: a scalar, a list of scalars (one line each), or a locale table. In a locale
 * table every key is a language tag, and the reserved `default` key is the value that gets no language
 * suffix.
 */
export type MetaValue = MetaScalar | readonly MetaScalar[] | Readonly<Record<string, MetaScalar | readonly MetaScalar[]>>;

/** The metadata block. Keys may be written with or without their leading `@`. */
export type UserscriptMeta = Readonly<Record<string, MetaValue>>;

/** A `package.json`, as far as the injected keys are concerned. */
export type PackageJsonLike = Record<string, unknown>;

/** Options of the `userscriptMetadata` plugin. */
export interface UserscriptMetadataOptions {
  /** The metadata block to render. */
  meta: UserscriptMeta;
  /**
   * Whether keys outside the built-in set are rendered. An unknown key always renders when it is named
   * in `metaOrder`.
   *
   * @default true
   */
  allowUnknown?: boolean;
  /**
   * Keys to place first, in the order given. The keys not listed keep the built-in order, and unknown
   * keys follow at the end.
   */
  metaOrder?: readonly string[];
  /**
   * Languages to place right after the un-suffixed line, in the order given. The remaining languages
   * follow alphabetically.
   *
   * @default ['en']
   */
  languageOrder?: readonly string[];
  /**
   * Where the values of the keys the metadata does not spell out come from: `true` searches upwards
   * from the Vite project root, a string is the path of the package file, and an object is used as it
   * is.
   *
   * @default undefined
   */
  injectPackageJson?: boolean | string | PackageJsonLike;
}
