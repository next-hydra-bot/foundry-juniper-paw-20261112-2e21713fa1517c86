import { readFileSync } from "node:fs";

import { Effect, Schema } from "effect";
import { DestinationError } from "migrate-sdk";

import { CountryCode } from "../domain/address";
import { Money } from "../domain/money";

const ShippingKey = Schema.String.check(
  Schema.isPattern(/^[a-z][a-z0-9-]{1,63}$/u)
);

export const ShippingZone = Schema.Struct({
  key: ShippingKey,
  countries: Schema.NonEmptyArray(CountryCode),
});
export type ShippingZone = typeof ShippingZone.Type;

const FlatShippingRate = Schema.Struct({
  zoneKey: ShippingKey,
  price: Schema.Struct({
    ...Money.fields,
    centAmount: Schema.Int.check(
      Schema.isGreaterThanOrEqualTo(0),
      Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER)
    ),
  }),
});

export const ShippingService = Schema.Struct({
  key: ShippingKey,
  name: Schema.Trim.check(Schema.isNonEmpty()),
  rates: Schema.NonEmptyArray(FlatShippingRate),
});
export type ShippingService = typeof ShippingService.Type;

export const ShippingSetup = Schema.Struct({
  zones: Schema.NonEmptyArray(ShippingZone),
  services: Schema.NonEmptyArray(ShippingService),
}).check(
  Schema.makeFilter(({ zones, services }) => {
    const zoneKeys = new Set(zones.map(({ key }) => key));
    if (zoneKeys.size !== zones.length) {
      return "Shipping Zone keys must be unique.";
    }
    const countries = zones.flatMap((zone) => zone.countries);
    if (new Set(countries).size !== countries.length) {
      return "A country must occur only once in the Shipping Zones.";
    }
    if (
      new Set(services.map(({ key }) => key)).size !== services.length ||
      new Set(services.map(({ name }) => name)).size !== services.length
    ) {
      return "Shipping Service keys and names must be unique.";
    }
    for (const { key, rates } of services) {
      const rateZones = new Set(rates.map(({ zoneKey }) => zoneKey));
      if (rateZones.size !== rates.length) {
        return `Shipping Service ${key} has more than one rate for a zone.`;
      }
      for (const zoneKey of rateZones) {
        if (!zoneKeys.has(zoneKey)) {
          return `Shipping Service ${key} refers to unknown Shipping Zone ${zoneKey}.`;
        }
      }
    }
    return undefined;
  })
);
export type ShippingSetup = typeof ShippingSetup.Type;

export const readShippingSetup = (file: string | URL) =>
  Effect.try({
    try: () => readFileSync(file, "utf-8"),
    catch: (cause) =>
      new DestinationError({ cause, message: `Unable to read ${file}` }),
  }).pipe(
    Effect.flatMap((json) =>
      Schema.decodeUnknownEffect(Schema.fromJsonString(ShippingSetup))(json, {
        onExcessProperty: "error",
      })
    )
  );
