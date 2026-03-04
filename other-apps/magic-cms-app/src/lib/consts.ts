export type CmsAttributeType =
  | "NUMERIC"
  | "PLAIN_TEXT"
  | "BOOLEAN"
  | "DROPDOWN"
  | "REFERENCE"
  | "FILE"
  | "RICH_TEXT";

export type CmsAttributeEntity = "PRODUCT" | "PAGE" | "PRODUCT_VARIANT" | "CATEGORY" | "COLLECTION";

export type CmsAttributeDefinition = {
  slug: string;
  name: string;
  type: CmsAttributeType;
  entity?: CmsAttributeEntity;
  scope?: "PAGE_TYPE" | "PRODUCT_TYPE";
  referencePageTypeSlugs?: string[];
  valueRequired?: boolean;
  visibleInStorefront?: boolean;
  filterableInDashboard?: boolean;
};

export type CmsPageTypeDefinition = {
  slug: string;
  name: string;
  attributes: string[];
};

export type CmsDefaultPageDefinition = {
  title: string;
  slug: string;
  pageTypeSlug: string;
  isPublished: boolean;
  content?: string;
  attributeValues?: Record<string, string | number | boolean | string[]>;
};

export type CmsMenuItemDefinition = {
  name: string;
  url?: string;
  children?: CmsMenuItemDefinition[];
};

export type CmsMenuDefinition = {
  slug: string;
  name: string;
  items?: CmsMenuItemDefinition[];
};

const MAGIC_WIDGET_REFERENCE_PAGE_TYPE_SLUGS = [
  "magiccms-widget-slider",
  "magiccms-widget-section",
  "magiccms-widget-repeatable",
  "magiccms-widget-banner",
  "magiccms-widget-product-grid",
  "magic-widget-shoppable",
] as const;

export const CMS_ATTRIBUTES: CmsAttributeDefinition[] = [
  { slug: "magic-priority", name: "Magic Priority", type: "NUMERIC" },
  { slug: "magic-rating", name: "Magic Rating", type: "NUMERIC" },
  { slug: "magic-position", name: "Magic Position", type: "PLAIN_TEXT" },
  { slug: "magic-status", name: "Magic Status", type: "DROPDOWN" }, // choices: pending, approved, rejected
  { slug: "magic-linked-products", name: "Magic Linked Products", type: "REFERENCE", entity: "PRODUCT" },
  { slug: "magic-media", name: "Magic Media", type: "FILE" },
  { slug: "magic-widget-data", name: "Magic Widget Data", type: "RICH_TEXT" },
  { slug: "magic-display-rules", name: "Magic Display Rules", type: "PLAIN_TEXT" }, // JSON string
  { slug: "magic-shoppable-video-file", name: "Magic Shoppable Video File", type: "FILE" },
  { slug: "magic-shoppable-video-thumbnail", name: "Magic Shoppable Video Thumbnail", type: "FILE" },
  { slug: "magic-shoppable-products", name: "Magic Shoppable Products", type: "REFERENCE", entity: "PRODUCT" },
  { slug: "magic-shoppable-file-info", name: "Magic Shoppable File Info", type: "PLAIN_TEXT" },
  { slug: "magic-shoppable-widget-name", name: "Magic Shoppable Widget Name", type: "PLAIN_TEXT" },
  { slug: "magic-shoppable-video-refs", name: "Magic Shoppable Video Refs", type: "REFERENCE", entity: "PAGE" },
  { slug: "magic-module-attr-heading", name: "Magic Module Heading", type: "RICH_TEXT" },
  { slug: "magic-module-attr-title", name: "Magic Module Attr Title", type: "PLAIN_TEXT" },
  { slug: "magic-module-attr-content", name: "Magic Module Attr Content", type: "RICH_TEXT" },
  { slug: "magic-module-attr-excerpt", name: "Magic Module Excerpt", type: "PLAIN_TEXT" },
  { slug: "magic-module-attr-badge", name: "Magic Module Badge", type: "PLAIN_TEXT" },
  { slug: "magic-module-attr-author", name: "Magic Module Author", type: "PLAIN_TEXT" },
  { slug: "magic-module-attr-categories", name: "Magic Module Categories", type: "PLAIN_TEXT" },
  { slug: "magic-module-attr-link", name: "Magic Module Attr Link", type: "PLAIN_TEXT" },
  { slug: "magic-module-attr-link-text", name: "Magic Module Attr Link Text", type: "PLAIN_TEXT" },
  { slug: "magic-module-attr-image-desktop", name: "Magic Module Image Desktop", type: "FILE" },
  { slug: "magic-module-attr-image-mobile", name: "Magic Module Image Mobile", type: "FILE" },
  { slug: "magic-module-attr-image", name: "Magic Module Image", type: "FILE" },
  { slug: "magic-module-attr-featured-image", name: "Magic Module Featured Image", type: "FILE" },
  { slug: "magic-module-attr-thumbnail", name: "Magic Module Thumbnail", type: "FILE" },
  { slug: "magic-module-attr-video-url", name: "Magic Module Video URL", type: "PLAIN_TEXT" },
  { slug: "magic-module-attr-video-file", name: "Magic Module Video File", type: "FILE" },
  { slug: "magic-module-attr-address", name: "Magic Module Address", type: "RICH_TEXT" },
  { slug: "magic-module-attr-phone", name: "Magic Module Phone", type: "PLAIN_TEXT" },
  { slug: "magic-module-attr-email", name: "Magic Module Email", type: "PLAIN_TEXT" },
  { slug: "magic-module-attr-map-embed", name: "Magic Module Map Embed", type: "PLAIN_TEXT" },
  { slug: "magic-module-attr-working-hours", name: "Magic Module Working Hours", type: "RICH_TEXT" },
  { slug: "magic-module-attr-social-facebook", name: "Magic Module Social Facebook", type: "PLAIN_TEXT" },
  { slug: "magic-module-attr-social-instagram", name: "Magic Module Social Instagram", type: "PLAIN_TEXT" },
  { slug: "magic-module-attr-social-twitter", name: "Magic Module Social Twitter", type: "PLAIN_TEXT" },
  { slug: "magic-module-attr-social-youtube", name: "Magic Module Social YouTube", type: "PLAIN_TEXT" },
  { slug: "magic-module-attr-social-whatsapp", name: "Magic Module Social WhatsApp", type: "PLAIN_TEXT" },
  { slug: "magic-module-attr-usp-content", name: "Magic Module USP Content", type: "RICH_TEXT" },
  { slug: "magic-module-attr-faq-content", name: "Magic Module FAQ Content", type: "RICH_TEXT" },
  { slug: "magic-module-attr-seo-content", name: "Magic Module SEO Content", type: "RICH_TEXT" },
  { slug: "magic-module-attr-product", name: "Magic Module Product", type: "REFERENCE", entity: "PRODUCT" },
  {
    slug: "magic-ref-widget",
    name: "Magic Ref Widget",
    type: "REFERENCE",
    entity: "PAGE",
    referencePageTypeSlugs: [...MAGIC_WIDGET_REFERENCE_PAGE_TYPE_SLUGS],
  },
  { slug: "magic-settings-header-code", name: "Magic Settings Header Code", type: "PLAIN_TEXT" },
  { slug: "magic-settings-body-code", name: "Magic Settings Body Code", type: "PLAIN_TEXT" },
  { slug: "magic-settings-footer-code", name: "Magic Settings Footer Code", type: "PLAIN_TEXT" },
  { slug: "magic-settings-extra-fields", name: "Magic Settings Extra Fields", type: "PLAIN_TEXT" },
  {
    slug: "magic-product-short-description",
    name: "Magic Product Short Description",
    type: "RICH_TEXT",
    scope: "PRODUCT_TYPE",
  },
  {
    slug: "magic-product-tabs",
    name: "Magic Product Tabs",
    type: "RICH_TEXT",
    scope: "PRODUCT_TYPE",
  },
  {
    slug: "magic-product-video",
    name: "Magic Product Video",
    type: "RICH_TEXT",
    scope: "PRODUCT_TYPE",
  },
  {
    slug: "magic-product-faqs",
    name: "Magic Product FAQs",
    type: "RICH_TEXT",
    scope: "PRODUCT_TYPE",
  },
  {
    slug: "magic-product-cross-selling-products",
    name: "Magic Product Cross Selling Products",
    type: "REFERENCE",
    entity: "PRODUCT",
    scope: "PRODUCT_TYPE",
  },
];

export const CMS_PAGE_TYPES: CmsPageTypeDefinition[] = [
  { 
    slug: "magiccms-review", 
    name: "MagicCMS: Review", 
    attributes: ["magic-rating", "magic-status", "magic-linked-products", "magic-media"] 
  },
  { 
    slug: "magiccms-shoppable-video", 
    name: "MagicCMS: Shoppable Video", 
    attributes: [
      "magic-priority",
      "magic-shoppable-video-file",
      "magic-shoppable-video-thumbnail",
      "magic-shoppable-products",
      "magic-shoppable-file-info",
      // legacy compatibility
      "magic-linked-products",
      "magic-media",
      "magic-display-rules",
    ] 
  },
  { 
    slug: "magiccms-widget-slider", 
    name: "MagicCMS: Widget Slider", 
    attributes: [
      "magic-priority",
      "magic-position",
      "magic-media",
      "magic-widget-data",
      "magic-display-rules",
      "magic-shoppable-video-refs",
    ] 
  },
  { 
    slug: "magiccms-widget-section", 
    name: "MagicCMS: Widget Section", 
    attributes: ["magic-priority", "magic-position", "magic-media", "magic-widget-data", "magic-shoppable-video-refs"] 
  },
  { 
    slug: "magiccms-widget-repeatable", 
    name: "MagicCMS: Widget Repeatable", 
    attributes: ["magic-priority", "magic-position", "magic-widget-data", "magic-shoppable-video-refs"] 
  },
  { 
    slug: "magiccms-widget-banner", 
    name: "MagicCMS: Widget Banner", 
    attributes: ["magic-priority", "magic-position", "magic-widget-data", "magic-shoppable-video-refs"] 
  },
  { 
    slug: "magiccms-widget-product-grid", 
    name: "MagicCMS: Widget Product Grid", 
    attributes: ["magic-priority", "magic-position", "magic-linked-products", "magic-shoppable-video-refs"] 
  },
  {
    slug: "magic-widget-shoppable",
    name: "MagicCMS: Shoppable Widget",
    attributes: ["magic-shoppable-widget-name", "magic-shoppable-video-refs"],
  },
  {
    slug: "magiccms-module-ty-home",
    name: "MagicCMS: Module Type Home",
    attributes: [
      "magic-module-attr-usp-content",
      "magic-module-attr-faq-content",
      "magic-ref-widget",
    ],
  },
  {
    slug: "magiccms-module-ty-about",
    name: "MagicCMS: Module Type About",
    attributes: [
      "magic-module-attr-heading",
      "magic-module-attr-image",
      "magic-ref-widget",
    ],
  },
  {
    slug: "magiccms-module-ty-contact",
    name: "MagicCMS: Module Type Contact",
    attributes: [
      "magic-module-attr-address",
      "magic-module-attr-phone",
      "magic-module-attr-email",
      "magic-module-attr-working-hours",
      "magic-module-attr-map-embed",
      "magic-module-attr-social-facebook",
      "magic-module-attr-social-instagram",
      "magic-module-attr-social-twitter",
      "magic-module-attr-social-youtube",
      "magic-module-attr-social-whatsapp",
      "magic-ref-widget",
    ],
  },
  {
    slug: "magiccms-module-ty-faq",
    name: "MagicCMS: Module Type FAQ",
    attributes: [
      "magic-ref-widget",
    ],
  },
  {
    slug: "magiccms-module-ty-blog",
    name: "MagicCMS: Module Type Blog",
    attributes: [
      "magic-module-attr-featured-image",
      "magic-module-attr-author",
      "magic-module-attr-categories",
      "magic-ref-widget",
    ],
  },
  {
    slug: "magiccms-module-ty-policy",
    name: "MagicCMS: Module Type Policy",
    attributes: ["magic-ref-widget"],
  },
  {
    slug: "magiccms-storefront-settings",
    name: "MagicCMS: Storefront Settings",
    attributes: [
      "magic-settings-header-code",
      "magic-settings-body-code",
      "magic-settings-footer-code",
      "magic-settings-extra-fields",
    ],
  },
];

export const CMS_DEFAULT_PAGES: CmsDefaultPageDefinition[] = [
  {
    title: "Home",
    slug: "home",
    pageTypeSlug: "magiccms-module-ty-home",
    isPublished: true,
  },
  {
    title: "About Us",
    slug: "about-us",
    pageTypeSlug: "magiccms-module-ty-about",
    isPublished: true,
  },
  {
    title: "FAQs",
    slug: "faqs",
    pageTypeSlug: "magiccms-module-ty-faq",
    isPublished: true,
  },
  {
    title: "Contact",
    slug: "contact",
    pageTypeSlug: "magiccms-module-ty-contact",
    isPublished: true,
    content:
      "{\"blocks\":[{\"type\":\"paragraph\",\"data\":{\"text\":\"We'd love to hear from you. Whether you have a question about our products, pricing, or anything else, our team is ready to answer all your questions.\"}}]}",
    attributeValues: {
      "magic-module-attr-address":
        "{\"blocks\":[{\"type\":\"paragraph\",\"data\":{\"text\":\"123 Main Street, New Delhi, India\"}}]}",
      "magic-module-attr-phone": "+91 98765 43210",
      "magic-module-attr-email": "hello@daikcell.com",
      "magic-module-attr-working-hours": "Mo-Fr 09:00-18:00\nSa 10:00-16:00\nSu Closed",
      "magic-module-attr-map-embed":
        "https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d112085.32405538032!2d77.28131779726559!3d28.609783800000017!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x390ce56269c425c9%3A0x62ad22ea71db25d!2sDaikcell%20India%20Private%20Limited!5e0!3m2!1sen!2sin!4v1769743929138!5m2!1sen!2sin",
    },
  },
  {
    title: "Terms & Conditions",
    slug: "terms-conditions",
    pageTypeSlug: "magiccms-module-ty-policy",
    isPublished: true,
  },
  {
    title: "Privacy Policy",
    slug: "privacy-policy",
    pageTypeSlug: "magiccms-module-ty-policy",
    isPublished: true,
  },
  {
    title: "Shipping Policy",
    slug: "shipping-policy",
    pageTypeSlug: "magiccms-module-ty-policy",
    isPublished: true,
  },
  {
    title: "Return & Refund",
    slug: "return-refund",
    pageTypeSlug: "magiccms-module-ty-policy",
    isPublished: true,
  },
  {
    title: "Magic Storefront Settings",
    slug: "magic-settings",
    pageTypeSlug: "magiccms-storefront-settings",
    isPublished: false,
  },
];

export const CMS_MENU_STRUCTURES: CmsMenuDefinition[] = [
  {
    slug: "magic-navbar-top-header",
    name: "Magic Navbar Top Header",
    items: [
      { name: "Order Tracking", url: "/order-tracking" },
      { name: "Support", url: "/support" },
      { name: "Distribution", url: "/distribution" },
    ],
  },
  {
    slug: "magic-navbar-main-header",
    name: "Magic Navbar Main Header",
    items: [
      { name: "Home", url: "/" },
      { name: "Shop", url: "/shop" },
    ],
  },
  {
    slug: "magic-navbar-footer-links1",
    name: "Magic Navbar Footer Links 1",
    items: [
      {
        name: "Information",
        children: [
          { name: "About Us", url: "/pages/about-us" },
          { name: "FAQs", url: "/pages/faqs" },
          { name: "Shipping Policy", url: "/pages/shipping-policy" },
        ],
      },
    ],
  },
  {
    slug: "magic-navbar-footer-links2",
    name: "Magic Navbar Footer Links 2",
    items: [
      {
        name: "Support",
        children: [
          { name: "Contact", url: "/pages/contact" },
          { name: "Privacy Policy", url: "/pages/privacy-policy" },
          { name: "Return & Refund", url: "/pages/return-refund" },
        ],
      },
    ],
  },
  {
    slug: "magic-navbar-search-popular",
    name: "Magic Navbar Search Popular",
    items: [{ name: "Inverter" }, { name: "Stabilizer" }, { name: "Lithium Battery" }],
  },
  {
    slug: "magic-navbar-most-searched",
    name: "Magic Navbar Most Searched",
    items: [
      { name: "5kVA Stabilizer", url: "/search?q=5kva+stabilizer" },
      { name: "Home Inverter", url: "/search?q=home+inverter" },
      { name: "Servo Stabilizer", url: "/search?q=servo+stabilizer" },
    ],
  },
];
