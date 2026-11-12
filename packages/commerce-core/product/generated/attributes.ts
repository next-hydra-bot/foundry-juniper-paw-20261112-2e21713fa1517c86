// Generated from catalog/product-model.json. Do not edit manually.
// Run pnpm --filter @repo/commerce-core catalog generate to regenerate.
import { Schema } from "effect";
import { makeProductAttributeEnumValueSchema } from "../attributes";
import { ProductId } from "../identity";
import { hasCompleteProductOptionSelection, hasDefaultProductVariant, hasUniqueProductVariantIds, makeProductDetailSchema, makeProductVariantSchema } from "../model";

export const productModelSignature = "9fada6f7459ef0a18ccc2526e7150f746a1b73017359e6ee53566cefa6eb10fe";
const GenericProductTypeKey = Schema.Literal("generic-product").pipe(Schema.brand("ProductTypeKey"));
type GenericProductTypeKey = typeof GenericProductTypeKey.Type;
const HeavyEarthmovingAndConstructionEquipmentProductTypeKey = Schema.Literal("heavy-earthmoving-and-construction-equipment").pipe(Schema.brand("ProductTypeKey"));
type HeavyEarthmovingAndConstructionEquipmentProductTypeKey = typeof HeavyEarthmovingAndConstructionEquipmentProductTypeKey.Type;
const HeavyLiftingAndSpecializedEquipmentProductTypeKey = Schema.Literal("heavy-lifting-and-specialized-equipment").pipe(Schema.brand("ProductTypeKey"));
type HeavyLiftingAndSpecializedEquipmentProductTypeKey = typeof HeavyLiftingAndSpecializedEquipmentProductTypeKey.Type;
const OutdoorProductTypeKey = Schema.Literal("outdoor-product").pipe(Schema.brand("ProductTypeKey"));
type OutdoorProductTypeKey = typeof OutdoorProductTypeKey.Type;
export const ProductTypeKey = Schema.Union([GenericProductTypeKey, HeavyEarthmovingAndConstructionEquipmentProductTypeKey, HeavyLiftingAndSpecializedEquipmentProductTypeKey, OutdoorProductTypeKey]);
export type ProductTypeKey = typeof ProductTypeKey.Type;
export const GenericProductAttributes = Schema.Record(Schema.String, Schema.Never);
export type GenericProductAttributes = typeof GenericProductAttributes.Type;
export const HeavyEarthmovingAndConstructionEquipmentAttributes = Schema.Struct({
"capacity": Schema.optional(Schema.Finite),
"iso45001": Schema.optional(Schema.Boolean),
"relatedProducts": Schema.optional(Schema.Array(ProductId)),
"mobility": Schema.optional(makeProductAttributeEnumValueSchema(["tracked","wheeled","fixed","marine"])),
"model": Schema.Finite,
});
export type HeavyEarthmovingAndConstructionEquipmentAttributes = typeof HeavyEarthmovingAndConstructionEquipmentAttributes.Type;
export const HeavyLiftingAndSpecializedEquipmentAttributes = Schema.Struct({
"capacity": Schema.optional(Schema.Finite),
"iso45001": Schema.optional(Schema.Boolean),
"relatedProducts": Schema.optional(Schema.Array(ProductId)),
"mobility": Schema.optional(makeProductAttributeEnumValueSchema(["tracked","wheeled","fixed","marine"])),
"color": makeProductAttributeEnumValueSchema(["RED","BLUE","GREEN"]),
});
export type HeavyLiftingAndSpecializedEquipmentAttributes = typeof HeavyLiftingAndSpecializedEquipmentAttributes.Type;
export const OutdoorProductAttributes = Schema.Struct({
"material": Schema.String,
"weightGrams": Schema.Finite,
"volumeMl": Schema.optional(Schema.Finite),
"care": Schema.optional(Schema.String),
"insulated": Schema.optional(Schema.Boolean),
"relatedProducts": Schema.optional(Schema.Array(ProductId)),
"size": Schema.optional(makeProductAttributeEnumValueSchema(["S","M","L"])),
"color": Schema.optional(makeProductAttributeEnumValueSchema(["RED","BLUE","GREEN","BLACK"])),
});
export type OutdoorProductAttributes = typeof OutdoorProductAttributes.Type;
export const ProductAttributesSchemaByProductType = {
"generic-product": GenericProductAttributes,
"heavy-earthmoving-and-construction-equipment": HeavyEarthmovingAndConstructionEquipmentAttributes,
"heavy-lifting-and-specialized-equipment": HeavyLiftingAndSpecializedEquipmentAttributes,
"outdoor-product": OutdoorProductAttributes,
} as const;
export type ProductAttributesByProductType = {
readonly "generic-product": GenericProductAttributes;
readonly "heavy-earthmoving-and-construction-equipment": HeavyEarthmovingAndConstructionEquipmentAttributes;
readonly "heavy-lifting-and-specialized-equipment": HeavyLiftingAndSpecializedEquipmentAttributes;
readonly "outdoor-product": OutdoorProductAttributes;
};
export type ProductAttributes<TKey extends ProductTypeKey = ProductTypeKey> = TKey extends GenericProductTypeKey ? GenericProductAttributes : TKey extends HeavyEarthmovingAndConstructionEquipmentProductTypeKey ? HeavyEarthmovingAndConstructionEquipmentAttributes : TKey extends HeavyLiftingAndSpecializedEquipmentProductTypeKey ? HeavyLiftingAndSpecializedEquipmentAttributes : TKey extends OutdoorProductTypeKey ? OutdoorProductAttributes : never;
const GenericProductVariant = makeProductVariantSchema(GenericProductAttributes);
const HeavyEarthmovingAndConstructionEquipmentVariant = makeProductVariantSchema(HeavyEarthmovingAndConstructionEquipmentAttributes);
const HeavyLiftingAndSpecializedEquipmentVariant = makeProductVariantSchema(HeavyLiftingAndSpecializedEquipmentAttributes);
const OutdoorProductVariant = makeProductVariantSchema(OutdoorProductAttributes);
export const ProductVariant = Schema.Union([GenericProductVariant, HeavyEarthmovingAndConstructionEquipmentVariant, HeavyLiftingAndSpecializedEquipmentVariant, OutdoorProductVariant]);
const ProductDetailSchema = Schema.Union([makeProductDetailSchema(GenericProductTypeKey, GenericProductVariant), makeProductDetailSchema(HeavyEarthmovingAndConstructionEquipmentProductTypeKey, HeavyEarthmovingAndConstructionEquipmentVariant), makeProductDetailSchema(HeavyLiftingAndSpecializedEquipmentProductTypeKey, HeavyLiftingAndSpecializedEquipmentVariant), makeProductDetailSchema(OutdoorProductTypeKey, OutdoorProductVariant)]);
export const ProductDetail = ProductDetailSchema.check(
Schema.makeFilter(hasDefaultProductVariant, { expected: "defaultVariantId to identify a Product Variant" }),
Schema.makeFilter(hasUniqueProductVariantIds, { expected: "unique Product Variant IDs" }),
Schema.makeFilter(hasCompleteProductOptionSelection, { expected: "every Product Variant to select one defined value for every Product Option" })
);
type ProductDetailForKey<Detail, TKey extends ProductTypeKey> = Detail extends { readonly productType: TKey } ? Detail : never;
export type ProductDetail<TKey extends ProductTypeKey = ProductTypeKey> = ProductDetailForKey<typeof ProductDetail.Type, TKey>;
export type ProductVariant<TKey extends ProductTypeKey = ProductTypeKey> = ProductDetail<TKey>["variants"][number];
