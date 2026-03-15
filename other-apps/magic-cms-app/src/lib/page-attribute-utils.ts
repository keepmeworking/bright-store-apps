import {
  AttributeInputTypeEnum,
  AttributeValueInput,
  GetWidgetQuery,
} from "../../generated/graphql";

type PageAttribute = NonNullable<NonNullable<GetWidgetQuery["page"]>["attributes"]>[number];
type PageAttributeValue = PageAttribute["values"][number] & {
  date?: string | null;
};

const createEditorJsDocument = (text: string) =>
  JSON.stringify({
    time: Date.now(),
    blocks: text
      ? [
          {
            id: "magic-cms-text",
            type: "paragraph",
            data: { text },
          },
        ]
      : [],
    version: "2.30.7",
  });

const decodeBase64 = (value: string) => {
  if (typeof atob === "function") {
    return atob(value);
  }

  if (typeof Buffer !== "undefined") {
    return Buffer.from(value, "base64").toString("utf8");
  }

  return "";
};

const isGlobalId = (value: string) => {
  if (!/^[A-Za-z0-9+/=]+$/.test(value)) {
    return false;
  }

  try {
    return decodeBase64(value).includes(":");
  } catch {
    return false;
  }
};

const extractRichText = (value: string) => {
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed?.blocks)) {
      return value;
    }

    return parsed.blocks
      .map((block: { data?: { text?: string } }) => block?.data?.text || "")
      .filter(Boolean)
      .join("\n");
  } catch {
    return value;
  }
};

export const readAttributeValue = (attribute: PageAttribute) => {
  const firstValue = attribute.values[0] as PageAttributeValue | undefined;

  if (!firstValue) {
    return "";
  }

  if (firstValue.file?.url) {
    return firstValue.file.url;
  }

  if (firstValue.reference) {
    return firstValue.reference;
  }

  if (firstValue.date) {
    return firstValue.date;
  }

  if (firstValue.richText) {
    return extractRichText(firstValue.richText);
  }

  return firstValue.value || firstValue.name || firstValue.slug || "";
};

export const buildAttributeUpdateInput = (
  attribute: PageAttribute,
  rawValue: string
): AttributeValueInput => {
  const attributeId = attribute.attribute.id;
  const trimmedValue = rawValue.trim();

  if (!trimmedValue) {
    return { id: attributeId, values: [] };
  }

  switch (attribute.attribute.inputType) {
    case AttributeInputTypeEnum.Boolean:
      return {
        id: attributeId,
        boolean:
          trimmedValue.toLowerCase() === "true" ||
          trimmedValue === "1" ||
          trimmedValue.toLowerCase() === "yes" ||
          trimmedValue.toLowerCase() === "on",
      };
    case AttributeInputTypeEnum.Numeric:
      return { id: attributeId, numeric: trimmedValue };
    case AttributeInputTypeEnum.Date:
      return { id: attributeId, date: trimmedValue };
    case AttributeInputTypeEnum.File:
      return { id: attributeId, file: trimmedValue };
    case AttributeInputTypeEnum.RichText:
      return { id: attributeId, richText: createEditorJsDocument(trimmedValue) };
    case AttributeInputTypeEnum.Dropdown:
      return { id: attributeId, dropdown: { value: trimmedValue } };
    case AttributeInputTypeEnum.Reference: {
      const referenceIds = trimmedValue
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);

      if (referenceIds.length > 1 && referenceIds.every(isGlobalId)) {
        return { id: attributeId, references: referenceIds };
      }

      if (referenceIds.length === 1 && isGlobalId(referenceIds[0])) {
        return { id: attributeId, reference: referenceIds[0] };
      }

      return { id: attributeId, values: referenceIds };
    }
    default:
      return { id: attributeId, plainText: rawValue };
  }
};
