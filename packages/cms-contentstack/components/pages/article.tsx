import { ArticlePage as ArticlePageView } from "@repo/design-system/components/cms/pages/article";
import type { Locale } from "@repo/i18n";
import { draftMode, headers } from "next/headers";
import { notFound } from "next/navigation";

import { graphqlClient } from "../../client";
import { graphql } from "../../graphql";
import { renderRichText } from "../../lib/utils/rich-text-utils";
import { transformLocale } from "../../lib/utils/transform-locale";

const query = graphql(`
  query ContentArticle($url: String!, $locale: String!) {
    all_article(
      locale: $locale
      fallback_locale: true
      limit: 1
      where: { url: $url }
    ) {
      items {
        title
        summary
        body {
          json
        }
        image_alt
        imageConnection {
          edges {
            node {
              url
            }
          }
        }
      }
    }
  }
`);

async function load(url: string, locale: Locale, preview?: string) {
  const result = await graphqlClient(preview).query(query, {
    url,
    locale: transformLocale(locale),
  });
  if (result.error) throw result.error;
  return result.data?.all_article?.items?.[0];
}
async function cached(url: string, locale: Locale) {
  "use cache";
  return load(url, locale);
}
export async function ArticlePage({
  url,
  locale,
}: {
  url: string;
  locale: Locale;
}) {
  const { isEnabled } = await draftMode();
  const article = isEnabled
    ? await load(url, locale, (await headers()).get("x-live-preview") ?? "")
    : await cached(url, locale);
  if (!article) notFound();
  const image = article.imageConnection?.edges?.[0]?.node?.url;
  return (
    <ArticlePageView
      body={renderRichText(article.body?.json)}
      image={
        image ? { altText: article.image_alt ?? "", url: image } : undefined
      }
      summary={article.summary ?? ""}
      title={article.title ?? ""}
    />
  );
}
