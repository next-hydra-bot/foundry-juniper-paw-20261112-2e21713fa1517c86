import type { Catalog } from "@repo/commerce-core/catalog";
import { Effect, Schema } from "effect";
import { DestinationError } from "migrate-sdk";

import type { CatalogAdmin } from "./admin";
import { catalogTranslationLocales, shopifyLocale } from "./mapping";

const ShopLocale = Schema.Struct({
  locale: Schema.String,
  primary: Schema.Boolean,
  published: Schema.Boolean,
});
const fail = (message: string) => new DestinationError({ message });

/** Reconcile only the catalog's languages; the shop's primary language stays unchanged. */
export const provisionCatalogLocales = Effect.fn(
  "ShopifyCatalog.provisionLocales"
)(function* <R>(
  admin: CatalogAdmin<R>,
  catalog: Catalog,
  options: {
    readonly dryRun?: boolean;
    readonly sourceLocale?: string;
    readonly canPublishExisting?: boolean;
  } = {}
) {
  const data = yield* admin.request(
    "catalogLocales",
    "query CatalogLocales { shopLocales { locale primary published } availableLocales { isoCode } }"
  );
  const state = yield* Schema.decodeUnknownEffect(
    Schema.Struct({
      availableLocales: Schema.Array(Schema.Struct({ isoCode: Schema.String })),
      shopLocales: Schema.Array(ShopLocale),
    })
  )(data).pipe(
    Effect.mapError(() => fail("Unable to read Shopify locale configuration"))
  );
  const nativeLocale = (locale: string) =>
    Effect.try({
      catch: () => fail(`Shopify does not support catalog locale ${locale}`),
      try: () => {
        const [language] = locale.split("-");
        const enabled =
          state.shopLocales.find((item) => item.locale === locale) ??
          state.shopLocales.find((item) => item.locale === language);
        return (
          enabled?.locale ??
          shopifyLocale(
            locale,
            state.availableLocales.map(({ isoCode }) => isoCode)
          )
        );
      },
    });
  const base = yield* nativeLocale(catalog.defaultLocale);
  const primary = state.shopLocales.find((locale) => locale.primary);
  if (primary === undefined || base !== primary.locale || !primary.published) {
    return yield* fail(
      "Catalog default locale must match the published Shopify primary locale"
    );
  }
  // Validate all mappings before enabling or publishing any language.
  const required = new Set([base]);
  const translations: { readonly source: string; readonly locale: string }[] =
    [];
  for (const locale of catalogTranslationLocales(catalog)) {
    const native = yield* nativeLocale(locale);
    if (required.has(native)) {
      return yield* fail(
        `Shopify locale collision for ${locale}; regional variants require an explicit Market translation strategy`
      );
    }
    required.add(native);
    translations.push({ source: locale, locale: native });
  }
  const changes: {
    readonly locale: string;
    readonly action: "enable-and-publish" | "publish";
  }[] = [];
  for (const { locale, source } of translations) {
    if (options.sourceLocale !== undefined && options.sourceLocale !== source) {
      continue;
    }
    let current = state.shopLocales.find((item) => item.locale === locale);
    if (current?.published) {
      continue;
    }
    changes.push({
      action: current === undefined ? "enable-and-publish" : "publish",
      locale,
    });
    if (options.dryRun) {
      continue;
    }
    if (current !== undefined && options.canPublishExisting !== true) {
      return yield* fail(
        `Shopify locale ${locale} was enabled outside this migration. Publish it explicitly before importing translations.`
      );
    }
    if (current === undefined) {
      const enabled = yield* admin.mutation(
        "shopLocaleEnable",
        "mutation CatalogLocaleEnable($locale:String!) { shopLocaleEnable(locale:$locale) { shopLocale { locale primary published } userErrors { message } } }",
        { locale }
      );
      current = yield* Schema.decodeUnknownEffect(ShopLocale)(
        enabled.shopLocale
      ).pipe(
        Effect.mapError(() =>
          fail(
            `Shopify did not confirm enabling locale ${locale}; inspect locale settings before retrying`
          )
        )
      );
      if (current.locale !== locale || current.primary) {
        return yield* fail(
          `Shopify returned an unexpected enabled locale for ${locale}`
        );
      }
    }
    if (!current.published) {
      const published = yield* admin.mutation(
        "shopLocaleUpdate",
        "mutation CatalogLocalePublish($locale:String!,$shopLocale:ShopLocaleInput!) { shopLocaleUpdate(locale:$locale,shopLocale:$shopLocale) { shopLocale { locale primary published } userErrors { message } } }",
        { locale, shopLocale: { published: true } }
      );
      const confirmed = yield* Schema.decodeUnknownEffect(ShopLocale)(
        published.shopLocale
      ).pipe(
        Effect.mapError(() =>
          fail(
            `Shopify did not confirm publishing locale ${locale}; inspect locale settings before retrying`
          )
        )
      );
      if (
        confirmed.locale !== locale ||
        !confirmed.published ||
        confirmed.primary
      ) {
        return yield* fail(
          `Shopify did not publish the requested translation locale ${locale}`
        );
      }
    }
  }
  return changes;
});
