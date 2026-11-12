/* oxlint-disable typescript/no-unsafe-argument, typescript/no-unsafe-assignment, typescript/no-unsafe-call, typescript/no-unsafe-member-access, typescript/no-unsafe-return, unicorn/prefer-module -- CSDX injects an untyped CommonJS migration DSL. */

const text = (uid, displayName, mandatory = false) => ({
  data_type: "text",
  display_name: displayName,
  field_metadata: {},
  mandatory,
  multiple: false,
  non_localizable: false,
  uid,
  unique: false,
});

const group = (uid, displayName, schema) => ({
  data_type: "group",
  display_name: displayName,
  field_metadata: {},
  mandatory: false,
  multiple: true,
  non_localizable: false,
  schema,
  uid,
  unique: false,
});

const link = () => [text("label", "Label", true), text("external_url", "URL")];

module.exports = async function addNavigationBrandAndFooter({
  migration,
  stackSDKInstance,
}) {
  const native = await stackSDKInstance.contentType("navigation").fetch();
  const existing = new Set(native.schema.map((field) => field.uid));
  const missing = [
    text("brand_name", "Brand name"),
    text("footer_description", "Footer description"),
    group("footer_links", "Footer links", [
      ...link(),
      group("children", "Children", link()),
    ]),
  ].filter((field) => !existing.has(field.uid));

  if (missing.length === 0) {
    return;
  }

  const navigation = migration.editContentType("navigation");
  for (const { uid, ...definition } of missing) {
    navigation.createField(uid, definition);
  }
  migration.addTask(navigation.getTaskDefinition());
};
