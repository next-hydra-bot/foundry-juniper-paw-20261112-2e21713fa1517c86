import type { ContentBlock } from "@repo/cms-core";
import { Schema } from "effect";

const BlockMetadata = Schema.Struct({ uid: Schema.NonEmptyString });

/** Preserve the master block UID when updating localized blocks. */
export function localizedBlockMetadata(
  input: unknown,
  _block: ContentBlock | undefined
) {
  const { uid } = Schema.decodeUnknownSync(BlockMetadata)(input);
  return { uid };
}
