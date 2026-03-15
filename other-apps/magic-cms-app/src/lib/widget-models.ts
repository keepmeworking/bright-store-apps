import { AttributeInputTypeEnum, AttributeEntityTypeEnum } from "../../generated/graphql";

export const WIDGET_MODEL_PAGE_TYPE_PREFIX = "magiccms-widget-";
export const LEGACY_WIDGET_MODEL_PAGE_TYPE_PREFIX = "magic-widget-module-";
export const WIDGET_MODEL_ATTRIBUTE_PREFIX = "magic-widget-attr-";
export const WIDGET_JSON_ATTRIBUTE_PREFIX = "magic-json-";
export const WIDGET_MODEL_REPEATER_SUFFIX = "-repeater-items";
export const WIDGET_REPEATER_SETTING_TOKEN = "-setting-";
export const MODULE_PAGE_TYPE_PREFIX = "magiccms-module-";

export type WidgetModelMode = "single" | "repeater";
export type WidgetFieldStorage = "item" | "setting";

export type WidgetFieldType =
  | "text"
  | "rich_text"
  | "number"
  | "boolean"
  | "file"
  | "product_reference"
  | "page_reference";

export type WidgetFieldDraft = {
  id: string;
  label: string;
  slug: string;
  manualSlug?: boolean;
  type: WidgetFieldType;
  storage?: WidgetFieldStorage;
};

export const WIDGET_FIELD_TYPE_OPTIONS: Array<{ value: WidgetFieldType; label: string }> = [
  { value: "text", label: "Text" },
  { value: "rich_text", label: "Rich text" },
  { value: "number", label: "Number" },
  { value: "boolean", label: "Boolean" },
  { value: "file", label: "File" },
  { value: "product_reference", label: "Product reference" },
  { value: "page_reference", label: "Page reference" },
];

export const sanitizeSlugPart = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);

export const createShortToken = () => Math.random().toString(36).slice(2, 8);

export const buildWidgetModelSlug = (name: string) => {
  const base = sanitizeSlugPart(name) || "model";
  return `${WIDGET_MODEL_PAGE_TYPE_PREFIX}${base}-${createShortToken()}`;
};

export const isWidgetModelPageType = (slug: string) =>
  slug.startsWith(WIDGET_MODEL_PAGE_TYPE_PREFIX) || slug.startsWith(LEGACY_WIDGET_MODEL_PAGE_TYPE_PREFIX);
export const isModulePageType = (slug: string) => slug.startsWith(MODULE_PAGE_TYPE_PREFIX);
export const isWidgetOrModulePageType = (slug: string) =>
  isWidgetModelPageType(slug) || isModulePageType(slug);

export const stripWidgetModelPrefix = (slug: string) =>
  slug
    .replace(WIDGET_MODEL_PAGE_TYPE_PREFIX, "")
    .replace(LEGACY_WIDGET_MODEL_PAGE_TYPE_PREFIX, "");

export const buildWidgetAttributeSlug = ({
  modelKey,
  fieldSlug,
  storage = "item",
}: {
  modelKey: string;
  fieldSlug: string;
  storage?: WidgetFieldStorage;
}) =>
  storage === "setting"
    ? `${WIDGET_MODEL_ATTRIBUTE_PREFIX}${modelKey}${WIDGET_REPEATER_SETTING_TOKEN}${fieldSlug}`
    : `${WIDGET_MODEL_ATTRIBUTE_PREFIX}${modelKey}-${fieldSlug}`;

export const isRepeaterDataAttributeSlug = (slug: string) =>
  slug.startsWith(WIDGET_JSON_ATTRIBUTE_PREFIX) || slug.endsWith(WIDGET_MODEL_REPEATER_SUFFIX);

export const isRepeaterSettingAttributeSlug = (slug: string) =>
  slug.includes(WIDGET_REPEATER_SETTING_TOKEN);

export const isRepeaterModelByAttributes = (attributes: ReadonlyArray<{ slug?: string | null }> = []) =>
  attributes.some((attribute) => isRepeaterDataAttributeSlug(attribute.slug || ""));

export const mapWidgetFieldTypeToSaleor = (type: WidgetFieldType) => {
  switch (type) {
    case "rich_text":
      return { inputType: AttributeInputTypeEnum.RichText };
    case "number":
      return { inputType: AttributeInputTypeEnum.Numeric };
    case "boolean":
      return { inputType: AttributeInputTypeEnum.Boolean };
    case "file":
      return { inputType: AttributeInputTypeEnum.File };
    case "product_reference":
      return {
        inputType: AttributeInputTypeEnum.Reference,
        entityType: AttributeEntityTypeEnum.Product,
      };
    case "page_reference":
      return {
        inputType: AttributeInputTypeEnum.Reference,
        entityType: AttributeEntityTypeEnum.Page,
      };
    case "text":
    default:
      return { inputType: AttributeInputTypeEnum.PlainText };
  }
};
