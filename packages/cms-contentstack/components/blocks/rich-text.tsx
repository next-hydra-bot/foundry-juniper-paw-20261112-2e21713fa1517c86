import type { ResultOf } from "../../graphql";
import { renderRichText } from "../../lib/utils/rich-text-utils";
import type { ComponentBaseProps } from "../../types";
import { RichTextBlock } from "./rich-text-fragment";

type RichTextData = NonNullable<
  Extract<ResultOf<typeof RichTextBlock>, { RichText: unknown }>["RichText"]
>;
export function RichText(props: { data: RichTextData } & ComponentBaseProps) {
  const { data } = props;
  return (
    <div
      className="container py-4 md:py-6"
      {...props.livePreviewHelper?.getUIProps({ body: "body" })}
    >
      <div className="prose">{renderRichText(data.body?.json)}</div>
    </div>
  );
}
RichText.fragment = RichTextBlock;
RichText.contentField = "rich_text";
