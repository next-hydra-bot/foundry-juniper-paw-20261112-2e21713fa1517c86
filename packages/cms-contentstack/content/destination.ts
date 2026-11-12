import { readFileSync, existsSync } from "node:fs";
import { basename } from "node:path";

import { getContentstackEndpoint } from "@contentstack/utils";
import { installedContentModel } from "@repo/cms-core";
import type {
  ContentProfile,
  ContentEntry,
  ContentLink,
  ContentDependencies,
} from "@repo/cms-core";
import type { ContentDestination } from "@repo/cms-core/migrations";
import { assetPath, linkPath } from "@repo/cms-core/profile";
import { Effect, Redacted, Schema } from "effect";
import { DestinationError } from "migrate-sdk";

import { ContentstackCli } from "../cli/provisioning/contentstack-cli";
import { requireSupportedContentstackCliVersion } from "../cli/provisioning/require-cli-version";
import { localizedBlockMetadata } from "./localized-blocks";
import { richTextContentstack } from "./rich-text";

type Native = Record<string, unknown>;
const object = (input: unknown) =>
  Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Unknown))(input);
const uid = (input: unknown) =>
  Schema.decodeUnknownSync(Schema.Struct({ uid: Schema.NonEmptyString }))(input)
    .uid;
export const contentstackContentModel = () =>
  installedContentModel(
    existsSync(
      new URL("../recipe/recipes/product-collection.json", import.meta.url)
    )
  );
export function contentstackBlocks(
  entry: Extract<ContentEntry, { type: "page" }>,
  profile: ContentProfile,
  dependencies: ContentDependencies
) {
  const { assets } = dependencies;
  const link = (value: ContentLink) => ({
    external_url: linkPath(profile, value, entry.locale),
    label: value.label,
  });
  return entry.blocks.map((block) => {
    switch (block.type) {
      case "hero": {
        return {
          hero_section: {
            cta: (block.links ?? []).map(link),
            description: richTextContentstack(block.body ?? [], block.key),
            tagline: block.tagline ?? "",
            title: block.title,
            ...(block.imageKey
              ? {
                  image: assets[block.imageKey],
                  image_alt: profile.assets.find(
                    (asset) => asset.key === block.imageKey
                  )!.alt[entry.locale],
                }
              : {}),
          },
        };
      }
      case "rich-text": {
        return { rich_text: { body: richTextContentstack(block.body, block.key) } };
      }
      case "product-collection": {
        return {
          dynamic_product_collection: {
            description: richTextContentstack(block.body ?? [], block.key),
            heading: block.title,
            limit: block.limit,
            product_category: dependencies.categories[block.categoryKey],
          },
        };
      }
    }
  });
}
export const prepareContentstackContent = (options: {
  alias: string;
  branch: string;
  environment: string;
  directory: string;
}) =>
  Effect.gen(function* () {
    const cli = yield* ContentstackCli;
    yield* requireSupportedContentstackCliVersion();
    const stack = yield* cli.resolveStack(options.alias);
    const endpoints = yield* cli.runtimeEndpoints();
    const rawHost = String(
      getContentstackEndpoint(endpoints.region, "contentManagement", true)
    );
    const base = `${(rawHost.startsWith("http")
      ? rawHost
      : `https://${rawHost}`
    ).replace(/\/$/u, "")}/v3`;
    const request = async (
      method: string,
      path: string,
      data?: unknown,
      allowMissing = false
    ): Promise<Native> => {
      const multipart = data instanceof FormData;
      const response = await fetch(base + path, {
        body:
          data === undefined
            ? undefined
            : multipart
              ? data
              : JSON.stringify(data),
        headers: {
          api_key: stack.apiKey,
          authorization: Redacted.value(stack.managementToken),
          branch: options.branch,
          ...(multipart ? {} : { "content-type": "application/json" }),
        },
        method,
        redirect: "error",
        signal: AbortSignal.timeout(60_000),
      });
      if (allowMissing && response.status === 404) {
        return {};
      }
      const result = object(await response.json());
      if (!response.ok) {
        throw new Error(
          `Contentstack HTTP ${response.status}: ${String(
            result.error_message ?? "content operation failed"
          )}`
        );
      }
      return result;
    };
    const locale = (value: string) => value.toLowerCase();
    const list = async (type: string, query: Native, language: string) => {
      const result = await request(
        "GET",
        `/content_types/${type}/entries?locale=${locale(
          language
        )}&query=${encodeURIComponent(JSON.stringify(query))}&limit=2`
      );
      return Schema.decodeUnknownSync(
        Schema.Array(Schema.Record(Schema.String, Schema.Unknown))
      )(result.entries);
    };
    const find = async (
      type: string,
      key: string,
      language: string,
      path?: string
    ) => {
      const found = await list(type, { source_key: key }, language);
      if (found.length > 1) {
        throw new Error(`Ambiguous Contentstack source key: ${key}`);
      }
      if (found[0]) {
        return found[0];
      }
      if (path !== undefined) {
        return (await list(type, { url: path }, language))[0];
      }
      if (type === "navigation" || type === "announcement") {
        return (await list(type, {}, language))[0];
      }
      return undefined;
    };
    const upsert = async (
      type: string,
      key: string,
      language: string,
      body: Native,
      existing?: Native
    ) => {
      const result = existing
        ? await request(
            "PUT",
            `/content_types/${type}/entries/${uid(existing)}?locale=${locale(
              language
            )}`,
            { entry: { ...body, source_key: key } }
          )
        : await request(
            "POST",
            `/content_types/${type}/entries?locale=${locale(language)}`,
            { entry: { ...body, source_key: key } }
          );
      return object(result.entry);
    };
    const getEntry = async (entry: ContentEntry, profile: ContentProfile) => {
      const type = entry.type === "page" ? "landing_page" : "article";
      const base = profile.entries.find(
        (row) =>
          row.key === entry.key && row.locale === profile.model.defaultLocale
      )!;
      return {
        entry: await find(
          type,
          `${profile.model.key}:${entry.key}`,
          profile.model.defaultLocale,
          base.path
        ),
        type,
      };
    };
    const publish = async (
      type: string,
      id: string,
      language: string,
      published: boolean
    ) =>
      await request(
        "POST",
        `/content_types/${type}/entries/${id}${
          published ? "/publish" : "/unpublish"
        }?locale=${locale(language)}`,
        {
          entry: {
            environments: [options.environment],
            locales: [locale(language)],
          },
          locale: locale(language),
        }
      );
    const destination: ContentDestination = {
      publicationTarget: options.environment,
      target: `contentstack:${stack.apiKey}:${options.branch}`,
      write: (
        task,
        profile,
        _previous,
        dependencies = { assets: {}, categories: {} }
      ) =>
        Effect.tryPromise({
          catch: (cause) =>
            new DestinationError({
              message:
                cause instanceof Error
                  ? cause.message
                  : "Contentstack content operation failed.",
            }),
          try: async () => {
            const key = `${profile.model.key}:${task.sourceKey}`;
            if (task.phase === "assets") {
              const asset = profile.assets.find(
                (item) => item.key === task.sourceKey
              )!;
              const title = `${profile.model.key}:${asset.key}`;
              const found = await request(
                "GET",
                `/assets?query=${encodeURIComponent(
                  JSON.stringify({ title })
                )}&limit=2`
              );
              const existing = Schema.decodeUnknownSync(
                Schema.Array(Schema.Record(Schema.String, Schema.Unknown))
              )(found.assets);
              if (existing.length > 1) {
                throw new Error(`Ambiguous Contentstack asset: ${title}`);
              }
              const source = assetPath(options.directory, asset.source);
              const bytes = /^https?:\/\//u.test(source)
                ? await (async () => {
                    const response = await fetch(source, {
                      signal: AbortSignal.timeout(60_000),
                    });
                    if (!response.ok) {
                      throw new Error(`Asset download HTTP ${response.status}`);
                    }
                    return new Uint8Array(await response.arrayBuffer());
                  })()
                : new Uint8Array(readFileSync(source));
              const form = new FormData();
              form.set(
                "asset[upload]",
                new Blob([bytes]),
                basename(new URL(source, "file:///").pathname)
              );
              form.set("asset[title]", title);
              const result = await request(
                existing[0] ? "PUT" : "POST",
                `/assets${existing[0] ? `/${uid(existing[0])}` : ""}`,
                form
              );
              const id = uid(result.asset);
              await request("POST", `/assets/${id}/publish`, {
                asset: {
                  environments: [options.environment],
                  locales: profile.model.locales.map(locale),
                },
              });
              return { id, key: task.key };
            }
            if (task.phase === "navigation" || task.phase === "announcements") {
              const type =
                task.phase === "navigation" ? "navigation" : "announcement";
              const existing = await find(
                type,
                key,
                profile.model.defaultLocale
              );
              const body: Native = {
                title:
                  task.phase === "navigation"
                    ? "Main navigation"
                    : task.sourceKey,
              };
              if (task.phase === "navigation") {
                const menu = profile.navigation.find(
                  (item) => item.locale === task.locale
                )!;
                const link = (value: ContentLink) => ({
                  external_url: linkPath(profile, value, task.locale!),
                  label: value.label,
                });
                const links = (items: typeof menu.items) =>
                  items.map((item) => ({
                    ...link(item.link),
                    children: (item.children ?? []).map(link),
                  }));
                body.main_navigation = { items: links(menu.items) };
                if (menu.brandName !== undefined) {
                  body.brand_name = menu.brandName;
                }
                if (menu.footerDescription !== undefined) {
                  body.footer_description = menu.footerDescription;
                }
                if (menu.footerItems !== undefined) {
                  body.footer_links = links(menu.footerItems);
                }
              } else {
                const item = profile.announcements.find(
                  (item) => item.locale === task.locale
                )!;
                Object.assign(body, {
                  enabled: item.enabled,
                  link_label: item.link.label,
                  link_url: linkPath(profile, item.link, item.locale),
                  message: item.message,
                });
              }
              const result = await upsert(
                type,
                key,
                task.locale!,
                body,
                existing
              );
              await publish(type, uid(result), task.locale!, true);
              return { id: uid(result), key: task.key };
            }
            const entry = profile.entries.find(
              (item) =>
                item.key === task.sourceKey && item.locale === task.locale
            )!;
            const found = await getEntry(entry, profile);
            if (task.phase === "publication") {
              if (!found.entry) {
                throw new Error(`Missing imported entry: ${entry.key}`);
              }
              // A fresh draft has never been published and requires no unpublish call.
              if (entry.published) {
                await publish(found.type, uid(found.entry), entry.locale, true);
              } else {
                const current = object(
                  (
                    await request(
                      "GET",
                      `/content_types/${found.type}/entries/${uid(
                        found.entry
                      )}?locale=${locale(
                        entry.locale
                      )}&include_publish_details=true`
                    )
                  ).entry
                );
                if (
                  Array.isArray(current.publish_details) &&
                  current.publish_details.length
                ) {
                  await publish(
                    found.type,
                    uid(found.entry),
                    entry.locale,
                    false
                  );
                }
              }
              return { id: uid(found.entry), key: task.key };
            }
            let body: Native = { title: entry.title, url: entry.path };
            if (entry.type === "article") {
              body = {
                ...body,
                body: richTextContentstack(entry.body),
                summary: entry.summary,
              };
            } else {
              body = {
                ...body,
                components: [],
                display_title: "",
                hide_display_title: true,
              };
            }
            if (task.phase === "content") {
              const { assets } = dependencies;
              if (entry.type === "page") {
                body.components = contentstackBlocks(
                  entry,
                  profile,
                  dependencies
                );
                if (
                  entry.locale !== profile.model.defaultLocale &&
                  found.entry
                ) {
                  const master = profile.entries.find(
                    (item) =>
                      item.key === entry.key &&
                      item.locale === profile.model.defaultLocale
                  );
                  const remote = found.entry.components;
                  if (
                    master?.type === "page" &&
                    Array.isArray(remote) &&
                    Array.isArray(body.components)
                  ) {
                    body.components = body.components.map(
                      (raw: unknown, index: number) => {
                        const block = object(raw),
                          name = Object.keys(block)[0]!;
                        const masterIndex = master.blocks.findIndex(
                          (item) => item.key === entry.blocks[index]?.key
                        );
                        const remoteBlock = remote[masterIndex];
                        if (!remoteBlock || typeof remoteBlock !== "object") {
                          return block;
                        }
                        const value = object(object(remoteBlock)[name]);
                        return value._metadata
                          ? {
                              [name]: {
                                ...object(block[name]),
                                _metadata: localizedBlockMetadata(
                                  value._metadata,
                                  entry.blocks[index]
                                ),
                              },
                            }
                          : block;
                      }
                    );
                  }
                }
              } else if (entry.imageKey) {
                body.image = assets[entry.imageKey];
                body.image_alt = profile.assets.find(
                  (asset) => asset.key === entry.imageKey
                )!.alt[entry.locale];
              }
            }
            const result = await upsert(
              found.type,
              key,
              entry.locale,
              body,
              found.entry
            );
            return { id: uid(result), key: task.key };
          },
        }),
    };
    return destination;
  });
