import { Context, Effect } from "effect";

import type {
  AddressBookEntry,
  AddressBookAccessDenied,
  AddressBookChange,
  AddressBookEntryNotFound,
  AddressBookGetError,
  AddressBookProviderFailure,
  AddressBookReadError,
  AddressBookReference,
  AddressBookWriteOutcomeUnknown,
  AddressBookMutationRejected,
  SaveAddressBookEntryInput,
} from "../domain/address-book";
import type { CommerceRequestContextNotFound } from "../domain/commerce-request-context";

export type AddressBookListFailure =
  | AddressBookReadError
  | CommerceRequestContextNotFound;

export type AddressBookGetFailure =
  | AddressBookGetError
  | CommerceRequestContextNotFound;

export type AddressBookSaveFailure =
  | AddressBookAccessDenied
  | AddressBookProviderFailure
  | AddressBookWriteOutcomeUnknown
  | AddressBookMutationRejected
  | CommerceRequestContextNotFound;

export class AddressBook extends Context.Service<
  AddressBook,
  {
    readonly list: () => Effect.Effect<
      readonly AddressBookEntry[],
      AddressBookListFailure
    >;
    readonly get: (
      reference: AddressBookReference
    ) => Effect.Effect<AddressBookEntry, AddressBookGetFailure>;
    readonly save: (
      input: SaveAddressBookEntryInput
    ) => Effect.Effect<AddressBookEntry, AddressBookSaveFailure>;
    readonly change: (
      reference: AddressBookReference,
      change: AddressBookChange
    ) => Effect.Effect<void, AddressBookSaveFailure | AddressBookEntryNotFound>;
  }
>()("@repo/commerce-core/AddressBook") {
  static readonly list = Effect.fn("AddressBook.list")(function* () {
    const addressBook = yield* AddressBook;
    return yield* addressBook.list();
  });

  static readonly get = Effect.fn("AddressBook.get")(function* (
    reference: AddressBookReference
  ) {
    const addressBook = yield* AddressBook;
    return yield* addressBook.get(reference);
  });

  static readonly save = Effect.fn("AddressBook.save")(function* (
    input: SaveAddressBookEntryInput
  ) {
    const addressBook = yield* AddressBook;
    return yield* addressBook.save(input);
  });

  static readonly change = Effect.fn("AddressBook.change")(function* (
    reference: AddressBookReference,
    change: AddressBookChange
  ) {
    const addressBook = yield* AddressBook;
    yield* addressBook.change(reference, change);
  });
}
