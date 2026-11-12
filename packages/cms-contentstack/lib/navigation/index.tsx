import type {
  NavigationItem,
  NavigationItemIcon,
} from "@repo/design-system/components/layout/navigation";
import type { Locale } from "@repo/i18n";
import { cacheLife, cacheTag } from "next/cache";
import { draftMode, headers } from "next/headers";

import { graphqlClient } from "../../client";
import getLinkProps from "../../components/link";
import { TAGS } from "../../constants";
import { graphql } from "../../graphql";
import { transformLocale } from "../utils/transform-locale";

export const getMenuQuery = graphql(`
  query getMenu($locale: String!) {
    all_navigation(locale: $locale, fallback_locale: true) {
      items {
        system {
          uid
          content_type_uid
        }
        title
        brand_name
        footer_description
        footer_links {
          label
          external_url
          children {
            label
            external_url
          }
        }
        main_navigation {
          items {
            label
            external_url
            internal_contentConnection {
              edges {
                node {
                  ... on LandingPage {
                    url
                  }
                }
              }
            }
            children {
              label
              description
              icon
              external_url
              internal_contentConnection {
                edges {
                  node {
                    ... on LandingPage {
                      url
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`);

async function loadNavigation(locale: Locale, livePreviewHash?: string) {
  const res = await graphqlClient(livePreviewHash).query(getMenuQuery, {
    locale: transformLocale(locale),
  });

  if (res.error) {
    throw new Error("Failed to load Contentstack navigation", {
      cause: res.error,
    });
  }

  const navigation = res.data?.all_navigation?.items?.[0];
  const navigationItems: NavigationItem[] =
    navigation?.main_navigation?.items?.flatMap((item) => {
      const link = getLinkProps(item);
      if (!link.label) {
        return [];
      }
      return [
        {
          children:
            item?.children?.flatMap((child) => {
              const childLink = getLinkProps(child);
              return childLink.label && childLink.url
                ? [
                    {
                      description: child?.description ?? "",
                      href: childLink.url,
                      // Assume the icon is a valid Lucide icon name.
                      icon: child?.icon
                        ? (child.icon as NavigationItemIcon)
                        : undefined,
                      title: childLink.label,
                    },
                  ]
                : [];
            }) ?? [],
          href: link.url || undefined,
          title: link.label,
        },
      ];
    }) ?? [];

  const footerItems: NavigationItem[] =
    navigation?.footer_links?.flatMap((item) => {
      if (!item?.label) {
        return [];
      }
      const children =
        item.children?.flatMap((child) =>
          child?.label && child.external_url
            ? [{ href: child.external_url, title: child.label }]
            : []
        ) ?? [];
      return item.external_url || children.length
        ? [
            {
              children,
              href:
                item.external_url === ""
                  ? undefined
                  : (item.external_url ?? undefined),
              title: item.label,
            },
          ]
        : [];
    }) ?? [];

  return {
    brandName: navigation?.brand_name ?? undefined,
    footerDescription: navigation?.footer_description ?? undefined,
    footerItems,
    navigationItems,
  };
}

async function getCachedNavigation(locale: Locale) {
  "use cache";
  cacheTag(TAGS.menu);
  cacheLife("days");

  return await loadNavigation(locale);
}

export async function getNavigation(locale: Locale) {
  const { isEnabled: preview } = await draftMode();

  if (!preview) {
    return await getCachedNavigation(locale);
  }

  const requestHeaders = await headers();
  const livePreviewHash = requestHeaders.get("x-live-preview") ?? "";
  return await loadNavigation(locale, livePreviewHash);
}
